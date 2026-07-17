import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { predictNextGrooming } from '@/lib/grooming-reminder'

export default async function CatsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAuth()
  const { q } = await searchParams

  const cats = await db.cat.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { breed: { contains: q } }, { customer: { name: { contains: q } } }] } : {},
    // select (not include): keeps the base64 photo blobs out of the list query
    select: {
      id: true, name: true, breed: true, gender: true, lifeStage: true,
      coatType: true, groomingInterval: true, customerId: true,
      customer: { select: { name: true, phone: true } },
      appointments: { where: { type: 'Grooming', status: 'Completed' }, orderBy: { scheduledAt: 'desc' }, take: 1, select: { scheduledAt: true } },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>
          Cats <span className="font-normal text-base cd-muted">({cats.length})</span>
        </h1>
        <Link href="/cats/new" className="cd-btn">+ New Cat</Link>
      </div>

      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by name, breed, or owner…" className="cd-input flex-1" />
        <button type="submit" className="cd-btn-sec">Search</button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cats.map(cat => {
          const lastGroomed = cat.appointments[0]?.scheduledAt ?? null
          const nextDue = predictNextGrooming(lastGroomed, cat.breed, cat.groomingInterval, cat.coatType)
          const daysUntil = Math.ceil((nextDue.getTime() - Date.now()) / 86400000)
          const overdue = daysUntil < 0

          // Card is a div with a stretched link overlay — a Link card with a nested
          // owner Link (plus an onClick) is invalid in a server component and
          // crashed this page as soon as one cat existed.
          return (
            <div key={cat.id} className="cd-card p-4 relative hover:opacity-90 transition-opacity">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <Link href={`/cats/${cat.id}`} className="font-semibold" style={{ color: '#2D1907' }}>
                    {cat.name}
                    {/* stretched hit area: the whole card opens the cat */}
                    <span className="absolute inset-0" aria-hidden />
                  </Link>
                  <div className="text-xs cd-muted">{cat.breed ?? 'Unknown breed'} · {cat.lifeStage ?? '—'} · {cat.gender ?? '—'}</div>
                </div>
              </div>
              <div className="text-xs cd-muted">
                Owner: <Link href={`/customers/${cat.customerId}`} className="cd-link relative z-10">{cat.customer.name ?? cat.customer.phone}</Link>
              </div>
              <div className="text-xs mt-1 font-medium" style={{
                color: overdue ? '#B14919' : daysUntil <= 7 ? '#8a6c00' : '#729094'
              }}>
                {lastGroomed
                  ? overdue ? `Grooming overdue by ${Math.abs(daysUntil)}d` : `Next grooming in ${daysUntil}d`
                  : 'No grooming history'}
              </div>
            </div>
          )
        })}
        {cats.length === 0 && (
          <p className="col-span-3 text-sm cd-muted text-center py-8">No cats found</p>
        )}
      </div>
    </div>
  )
}
