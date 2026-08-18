import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { NewAppointmentClient } from './NewAppointmentClient'
import { NOT_HOUSE, CAT_NOT_HOUSE } from '@/lib/cat-stock'

// Booking is split into two lanes — grooming and boarding — so only the fields
// that lane actually needs are on screen. Price and end time are derived from
// the service (and nights stayed), never typed.
export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; catId?: string }>
}) {
  await requireAuth()
  const { customerId, catId } = await searchParams

  const [customers, cats, services, staff] = await Promise.all([
    db.customer.findMany({ where: NOT_HOUSE, select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } }),
    db.cat.findMany({ where: CAT_NOT_HOUSE, select: { id: true, name: true, customerId: true }, orderBy: { name: 'asc' } }),
    db.service.findMany({
      where: { active: true },
      select: { id: true, name: true, category: true, price: true, durationMin: true },
      orderBy: { sortOrder: 'asc' },
    }),
    db.staff.findMany({
      where: { active: true, role: { in: ['Groomer', 'Boarding'] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <NewAppointmentClient
      customers={customers}
      cats={cats}
      services={services}
      staff={staff}
      preselectCustomerId={customerId ?? null}
      preselectCatId={catId ?? null}
    />
  )
}
