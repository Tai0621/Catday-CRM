import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { predictNextGrooming } from '@/lib/grooming-reminder'

export default async function CatsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAuth()
  const { q } = await searchParams

  const cats = await db.cat.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { breed: { contains: q } }, { customer: { name: { contains: q } } }] } : {},
    // explicit select keeps the free-text notes fields out of the list query;
    // cover photos are fetched separately from MediaAsset below
    select: {
      id: true, name: true, breed: true, gender: true, lifeStage: true,
      coatType: true, groomingInterval: true, customerId: true,
      customer: { select: { name: true, phone: true } },
      appointments: { where: { type: 'Grooming', status: 'Completed' }, orderBy: { scheduledAt: 'desc' }, take: 1, select: { scheduledAt: true } },
    },
    orderBy: { name: 'asc' },
  })

  // Cover photo per cat: the most recent image in MediaAsset (private Blob,
  // served through the auth proxy). One batched query, newest-first, first hit
  // per cat wins.
  const catIds = cats.map(c => c.id)
  const coverByCat = new Map<string, string>()
  if (catIds.length) {
    const photos = await db.mediaAsset.findMany({
      where: { ownerType: 'cat', ownerId: { in: catIds }, kind: 'image' },
      select: { id: true, ownerId: true },
      orderBy: { createdAt: 'desc' },
    })
    for (const p of photos) if (!coverByCat.has(p.ownerId)) coverByCat.set(p.ownerId, p.id)
  }

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
          const coverId = coverByCat.get(cat.id)
          return (
            <div key={cat.id} className="cd-card p-4 relative hover:opacity-90 transition-opacity flex items-start gap-3">
              {/* Cover photo (or a cat-glyph placeholder when none) */}
              <div className="shrink-0 w-[88px] h-[88px] rounded-lg overflow-hidden flex items-center justify-center"
                style={{ background: 'rgba(45,25,7,0.06)' }}>
                {coverId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${coverId}/file`} alt={cat.name} className="w-full h-full object-cover" />
                ) : (
                  <svg width="36" height="36" viewBox="0 0 512 512" fill="rgba(45,25,7,0.28)" aria-hidden>
                    <path d="M128 232C120 196 118 150 126 112C130 96 148 92 160 104C186 130 214 158 232 182C247 178 265 178 280 182C298 158 326 130 352 104C364 92 382 96 386 112C394 150 392 196 384 232C398 258 406 288 406 318C406 388 340 440 256 440C172 440 106 388 106 318C106 288 114 258 128 232Z" />
                  </svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <Link href={`/cats/${cat.id}`} className="font-semibold" style={{ color: '#2D1907' }}>
                  {cat.name}
                  {/* stretched hit area: the whole card opens the cat */}
                  <span className="absolute inset-0" aria-hidden />
                </Link>
                <div className="text-xs cd-muted">{cat.breed ?? 'Unknown breed'} · {cat.lifeStage ?? '—'} · {cat.gender ?? '—'}</div>
                <div className="text-xs cd-muted mt-1">
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
