import { requireManager } from '@/lib/auth'
import { recentBriefs, pendingBriefDay } from '@/lib/brief'
import { db } from '@/lib/db'
import { SEGMENTS } from '@/lib/segments'
import { generateBriefNow } from './actions'
import Link from 'next/link'

const seg = SEGMENTS.business
const day = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-MY', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

// C5 · The archive. The dashboard shows the latest brief; this is where a
// fortnight of them can be read in sequence, which is where a trend actually
// becomes visible.
export default async function BriefPage() {
  await requireManager()
  const [briefs, pending] = await Promise.all([recentBriefs(), pendingBriefDay()])
  const missing = !briefs.some(b => b.date === pending)
  const configured = !!process.env.ANTHROPIC_API_KEY

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Morning briefs
          </h1>
          <p className="text-sm cd-muted">
            Written just after midnight from the day&apos;s own figures. Every number is computed by the
            OS — the assistant only reads them.
          </p>
        </div>
        {missing && configured && (
          <form action={generateBriefNow}>
            <input type="hidden" name="date" value={pending} />
            <button type="submit" className="cd-btn text-sm whitespace-nowrap">Write {pending}</button>
          </form>
        )}
      </div>

      {!configured && (
        <div className="cd-card p-4">
          <p className="text-sm cd-muted">
            No <code>ANTHROPIC_API_KEY</code> is set on this deployment, so no brief is written. The
            figures are still on the dashboard — what is missing is the reading of them.
          </p>
        </div>
      )}

      {briefs.length === 0 ? (
        <div className="cd-card py-12 text-center">
          <p className="text-sm cd-muted">
            No briefs yet. The first one is written tonight{configured ? ', or now with the button above' : ''}.
          </p>
        </div>
      ) : (
        briefs.map(b => {
          const { revenue, visits, boarding, money, lowStock } = b.facts
          const up = revenue.deltaPct != null && revenue.deltaPct > 0
          return (
            <section key={b.date} className="cd-card overflow-hidden">
              <div className="cd-section-header">
                <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>{day(b.date)}</h2>
                <span className="text-xs cd-muted tabular-nums">
                  RM {revenue.total.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                  {revenue.deltaPct != null && (
                    <span style={{ color: up ? '#5c6b3c' : '#B14919' }}> ({up ? '+' : ''}{revenue.deltaPct}%)</span>
                  )}
                </span>
              </div>

              <div className="px-5 py-4 space-y-3">
                <ul className="space-y-1.5">
                  {b.observations.map((o, i) => (
                    <li key={i} className="text-sm flex gap-2" style={{ color: '#2D1907' }}>
                      <span aria-hidden style={{ color: seg.color, opacity: 0.5 }}>—</span>
                      <span>{o}</span>
                    </li>
                  ))}
                </ul>

                {b.actions.length > 0 && (
                  <div className="space-y-1.5">
                    {b.actions.map((a, i) => {
                      const body = (
                        <>
                          <span className="text-sm font-medium" style={{ color: '#2D1907' }}>{a.title}</span>
                          <span className="block text-xs cd-muted">{a.why}</span>
                        </>
                      )
                      return a.href ? (
                        <Link key={i} href={a.href} className="block px-3 py-2 rounded-lg"
                          style={{ background: 'rgba(45,25,7,0.05)' }}>{body}</Link>
                      ) : (
                        <div key={i} className="px-3 py-2 rounded-lg" style={{ background: 'rgba(45,25,7,0.05)' }}>{body}</div>
                      )
                    })}
                  </div>
                )}

                {/* The facts the narration was written from, kept visible: a claim
                    the reader cannot check against anything is just an assertion. */}
                <details>
                  <summary className="text-xs cd-muted cursor-pointer">What this was written from</summary>
                  <div className="mt-2 text-xs cd-muted space-y-0.5">
                    <p>
                      {visits.completed} completed, {visits.noShows} no-show{visits.noShows === 1 ? '' : 's'},
                      {' '}{visits.cancelled} cancelled of {visits.booked} booked
                    </p>
                    <p>{boarding.catsIn} cats boarding · {boarding.roomsOccupied}/{boarding.totalRooms} rooms ({boarding.occupancyPct}%)</p>
                    <p>
                      Month to date RM {money.monthToDate.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
                      {money.monthPacePct != null ? ` · ${money.monthPacePct}% of target` : ''}
                      {' · '}RM {money.receivable.toLocaleString('en-MY', { maximumFractionDigits: 0 })} owed to us
                      {' · '}RM {money.payable.toLocaleString('en-MY', { maximumFractionDigits: 0 })} owed by us
                    </p>
                    {revenue.byStream.length > 0 && (
                      <p>{revenue.byStream.map(s => `${s.category} RM ${Math.round(s.total)}`).join(' · ')}</p>
                    )}
                    {lowStock.length > 0 && <p>Low stock: {lowStock.map(p => `${p.name} (${p.stockQty})`).join(', ')}</p>}
                  </div>
                </details>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

export async function generateMetadata() {
  const count = await db.dailyBrief.count()
  return { title: `Morning briefs${count ? ` (${count})` : ''}` }
}
