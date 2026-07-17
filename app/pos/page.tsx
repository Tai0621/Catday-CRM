import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { PosClient } from './PosClient'

// POS checkout — closes a visit in one flow. Unpaid appointments load into the
// basket automatically; retail and ad-hoc services are one tap away.
export default async function PosPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  await requireAuth()
  const { customerId } = await searchParams

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
    db.appointment.findMany({
      where: {
        paid: false,
        price: { not: null },
        status: { in: ['CheckedIn', 'InService', 'QualityCheck', 'Ready', 'Completed'] },
      },
      select: {
        id: true, customerId: true, catId: true, type: true, price: true, depositRM: true,
        scheduledAt: true,
        cat: { select: { name: true } },
        service: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    }),
    db.product.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    db.service.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ])

  return (
    <PosClient
      preselectCustomerId={customerId ?? null}
      customers={customers.map(c => ({
        id: c.id, name: c.name, phone: c.phone,
        walletBalance: c.walletBalance, pointsBalance: c.pointsBalance,
        tierName: c.memberships[0]?.tier.name ?? null,
        multiplier: c.memberships[0]?.tier.pointsMultiplier ?? 1,
      }))}
      appointments={openAppts.map(a => ({
        id: a.id, customerId: a.customerId, catId: a.catId, type: a.type,
        price: a.price!, deposit: a.depositRM ?? 0,
        label: `${a.service?.name ?? a.type} — ${a.cat.name} (${a.scheduledAt.toLocaleDateString('en-MY')})`,
      }))}
      products={products.map(p => ({ id: p.id, name: p.name, price: p.price, stockQty: p.stockQty }))}
      services={services.map(s => ({ id: s.id, name: s.name, price: s.price, category: s.category }))}
    />
  )
}
