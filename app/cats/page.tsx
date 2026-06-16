import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { predictNextGrooming } from '@/lib/grooming-reminder'

export default async function CatsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAuth()
  const { q } = await searchParams

  const cats = await db.cat.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { breed: { contains: q } }, { customer: { name: { contains: q } } }] } : {},
    include: {
      customer: true,
      appointments: { where: { type: 'Grooming', status: 'Completed' }, orderBy: { scheduledAt: 'desc' }, take: 1 },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Cats <span className="text-gray-400 font-normal text-base">({cats.length})</span></h1>
        <Link href="/cats/new" className="bg-rose-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-rose-700">+ New Cat</Link>
      </div>

      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by name, breed, or owner…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        <button type="submit" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">Search</button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cats.map(cat => {
          const lastGroomed = cat.appointments[0]?.scheduledAt ?? null
          const nextDue = predictNextGrooming(lastGroomed, cat.breed, cat.groomingInterval)
          const daysUntil = Math.ceil((nextDue.getTime() - Date.now()) / 86400000)
          const overdue = daysUntil < 0

          return (
            <Link key={cat.id} href={`/cats/${cat.id}`}
              className="bg-white border border-gray-200 rounded-xl p-4 hover:border-rose-200 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-gray-900">{cat.name}</div>
                  <div className="text-xs text-gray-500">{cat.breed ?? 'Unknown breed'} · {cat.lifeStage ?? '—'} · {cat.gender ?? '—'}</div>
                </div>
              </div>
              <div className="text-xs text-gray-400">Owner: {cat.customer.name ?? cat.customer.phone}</div>
              <div className={`text-xs mt-1 font-medium ${overdue ? 'text-red-500' : daysUntil <= 7 ? 'text-amber-600' : 'text-green-600'}`}>
                {lastGroomed
                  ? overdue ? `Grooming overdue by ${Math.abs(daysUntil)}d` : `Next grooming in ${daysUntil}d`
                  : 'No grooming history'}
              </div>
            </Link>
          )
        })}
        {cats.length === 0 && (
          <p className="col-span-3 text-sm text-gray-400 text-center py-8">No cats found</p>
        )}
      </div>
    </div>
  )
}
