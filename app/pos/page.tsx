import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveApptCharge } from '@/lib/appointment-charge'
import { PosClient } from './PosClient'

const DAY = 24 * 60 * 60 * 1000

// POS checkout — closes a visit in one flow. A customer's finished appointments
// load into the basket automatically (priced from the service / boarding nights);
// retail and ad-hoc services are one tap away.
export default async function PosPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  await requireAuth()
  const { customerId } = await searchParams
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + DAY)

  const [customers, openAppts, products, services] = await Promise.all([
    db.customer.findMany({
      select: {
        id: true, name: true, phone: true, walletBalance: true, pointsBalance: true,
        memberships: {
          where: { status: 'Active' },
          select: { tier: { select: { name: true, pointsMultiplier: true } } },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    }),
    // Everything that could be owed now — surfaced so a finished visit never
    // silently disappears (missing price / never advanced on the board included).
    db.appointment.findMany({
      where: {
        paid: false,
        status: { notIn: ['Cancelled', 'NoShow'] },
        OR: [
          { status: { in: ['Ready', 'Completed'] } },          // grooming finished on the board
          { type: 'Boarding', status: 'CheckedIn' },            // boarding still in-house
          { scheduledAt: { gte: todayStart, lte: now } },       // today's visits, even without the board
        ],
      },
      select: {
        id: true, customerId: true, catId: true, type: true, price: true, depositRM: true,
        scheduledAt: true, endsAt: true, status: true,
        cat: { select: { name: true } },
        service: { select: { name: true, price: true, category: true } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    }),
    db.product.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    db.service.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ])

  // "Billable" = clearly finished → auto-adds to the basket on customer pick.
  // The rest (in-progress today) are offered as one-tap chips so nothing is
  // charged before the service is actually done.
  const isBillable = (a: (typeof openAppts)[number]) =>
    a.status === 'Ready' || a.status === 'Completed' ||
    (a.type === 'Boarding' && a.status === 'CheckedIn' && a.endsAt != null && a.endsAt < todayEnd)

  const appointments = openAppts.map(a => {
    const charge = resolveApptCharge(a, now)
    const base = a.service?.name ?? a.type
    const nightsLabel = charge.nights ? ` · ${charge.nights} night${charge.nights === 1 ? '' : 's'}` : ''
    return {
      id: a.id, customerId: a.customerId, catId: a.catId, type: a.type,
      gross: charge.gross, deposit: charge.deposit, net: charge.net,
      needsPrice: charge.needsPrice,
      billable: isBillable(a),
      label: `${base}${nightsLabel} — ${a.cat.name} (${a.scheduledAt.toLocaleDateString('en-MY')})`,
    }
  })

  return (
    <PosClient
      preselectCustomerId={customerId ?? null}
      customers={customers.map(c => ({
        id: c.id, name: c.name, phone: c.phone,
        walletBalance: c.walletBalance, pointsBalance: c.pointsBalance,
        tierName: c.memberships[0]?.tier.name ?? null,
        multiplier: c.memberships[0]?.tier.pointsMultiplier ?? 1,
      }))}
      appointments={appointments}
      products={products.map(p => ({ id: p.id, name: p.name, price: p.price, stockQty: p.stockQty }))}
      services={services.map(s => ({ id: s.id, name: s.name, price: s.price, category: s.category }))}
    />
  )
}
