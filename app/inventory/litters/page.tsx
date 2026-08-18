import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { ageInDays, saleGate } from '@/lib/cat-stock'
import { MIN_SALE_AGE_DAYS } from '@/lib/constants'
import { addLitter } from '../cats/actions'

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—')

// Litters, and what they mean for supply: a kitten cannot be sold before twelve
// weeks, so a birth today is stock in about three months. Two queens pregnant
// now is the difference between having something to sell in the spring and not.
export default async function LittersPage() {
  await requireManager()
  const now = new Date()

  const [litters, dams, sires] = await Promise.all([
    db.litter.findMany({
      orderBy: [{ bornAt: 'desc' }, { expectedAt: 'desc' }],
      include: {
        dam: { select: { id: true, name: true } },
        sire: { select: { id: true, name: true } },
        kittens: {
          select: {
            id: true, sku: true, status: true, role: true, microchipNo: true,
            cat: {
              select: {
                name: true, dateOfBirth: true, vaccinationExpiry: true,
                lastVaccinatedAt: true, lastDewormAt: true, desexedAt: true,
              },
            },
          },
        },
      },
    }),
    db.catStock.findMany({
      where: { cat: { gender: 'Female' }, status: { in: ['InStock', 'Reserved'] } },
      select: { catId: true, sku: true, cat: { select: { name: true } } },
      orderBy: { sku: 'asc' },
    }),
    db.catStock.findMany({
      where: { cat: { gender: 'Male' }, status: { in: ['InStock', 'Reserved'] } },
      select: { catId: true, sku: true, cat: { select: { name: true } } },
      orderBy: { sku: 'asc' },
    }),
  ])

  const expected = litters.filter(l => !l.bornAt && l.expectedAt)

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Litters</h1>
        <Link href="/inventory/cats" className="cd-btn-sec">Cat Inventory</Link>
      </div>

      {expected.length > 0 && (
        <div className="cd-card p-4">
          <h2 className="font-semibold mb-1" style={{ color: '#2D1907' }}>Expected</h2>
          <ul className="text-sm space-y-1">
            {expected.map(l => (
              <li key={l.id}>
                <strong>{l.code}</strong> · {l.dam?.name ?? 'dam unknown'} × {l.sire?.name ?? l.sireName ?? 'sire unknown'}
                {' — due '}{day(l.expectedAt)}
                <span className="cd-muted"> · sale-ready about {saleReadyFrom(l.expectedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {litters.length === 0 ? (
        <p className="cd-card px-4 py-8 text-sm cd-muted text-center">No litters recorded yet.</p>
      ) : (
        litters.map(l => {
          const readyCount = l.kittens.filter(k => saleGate(k, now).ready).length
          return (
            <div key={l.id} className="cd-card p-4 space-y-2">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <h2 className="font-semibold" style={{ color: '#2D1907' }}>{l.code}</h2>
                <span className="text-xs cd-muted">
                  {l.dam?.name ?? 'dam unknown'} × {l.sire?.name ?? l.sireName ?? 'sire unknown'}
                  {' · born '}{day(l.bornAt)}
                  {l.bornCount != null && ` · ${l.survivingCount ?? l.bornCount}/${l.bornCount} surviving`}
                </span>
              </div>
              {l.kittens.length === 0 ? (
                <p className="text-sm cd-muted">No kittens linked yet — set the litter on each kitten&rsquo;s stock record.</p>
              ) : (
                <>
                  <p className="text-sm cd-muted">{readyCount} of {l.kittens.length} ready to sell</p>
                  <ul className="text-sm grid md:grid-cols-2 gap-1">
                    {l.kittens.map(k => {
                      const g = saleGate(k, now)
                      const days = ageInDays(k.cat.dateOfBirth, now)
                      return (
                        <li key={k.id}>
                          <Link href={`/inventory/cats/${k.id}`} className="cd-link">{k.sku}</Link>
                          {' '}{k.cat.name}
                          <span className="cd-muted">
                            {' — '}
                            {g.ready ? 'ready'
                              : days != null && days < MIN_SALE_AGE_DAYS
                                ? `ready in ${MIN_SALE_AGE_DAYS - days} days`
                                : g.blockers[0] ?? ''}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
              {l.notes && <p className="text-xs cd-muted">{l.notes}</p>}
            </div>
          )
        })
      )}

      <details className="cd-card p-4">
        <summary className="font-semibold cursor-pointer" style={{ color: '#2D1907' }}>Record a litter</summary>
        <form action={addLitter} className="mt-3 grid md:grid-cols-3 gap-3">
          <div><label className="cd-label">Code</label><input name="code" required placeholder="L-2026-09-BSH" className="cd-input" /></div>
          <div>
            <label className="cd-label">Dam (queen)</label>
            <select name="damId" className="cd-input">
              <option value="">—</option>
              {dams.map(d => <option key={d.catId} value={d.catId}>{d.sku} {d.cat.name}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Sire (ours)</label>
            <select name="sireId" className="cd-input">
              <option value="">—</option>
              {sires.map(s => <option key={s.catId} value={s.catId}>{s.sku} {s.cat.name}</option>)}
            </select>
          </div>
          <div><label className="cd-label">Sire (outside stud)</label><input name="sireName" className="cd-input" /></div>
          <div><label className="cd-label">Due date</label><input name="expectedAt" type="date" className="cd-input" /></div>
          <div><label className="cd-label">Born on</label><input name="bornAt" type="date" className="cd-input" /></div>
          <div><label className="cd-label">Born</label><input name="bornCount" type="number" min="0" className="cd-input" /></div>
          <div><label className="cd-label">Surviving</label><input name="survivingCount" type="number" min="0" className="cd-input" /></div>
          <div><label className="cd-label">Notes</label><input name="notes" className="cd-input" /></div>
          <div className="md:col-span-3"><button type="submit" className="cd-btn">Record litter</button></div>
        </form>
      </details>
    </div>
  )
}

function saleReadyFrom(due: Date | null): string {
  if (!due) return 'unknown'
  const d = new Date(due.getTime() + MIN_SALE_AGE_DAYS * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}
