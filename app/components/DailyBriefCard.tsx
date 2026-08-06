import Link from 'next/link'
import { latestBrief } from '@/lib/brief'
import { SEGMENTS } from '@/lib/segments'

// C5 · What the owner reads first.
//
// Renders nothing at all when there is no brief — an empty "your brief will
// appear here" panel at the top of the dashboard is a permanent apology on a
// tenant that has AI switched off.

export async function DailyBriefCard() {
  const brief = await latestBrief()
  if (!brief) return null

  const seg = SEGMENTS.business
  const { revenue } = brief.facts
  const delta = revenue.deltaPct
  const up = delta != null && delta > 0
  const dayLabel = new Date(`${brief.date}T12:00:00Z`).toLocaleDateString('en-MY', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })

  return (
    <section className="cd-card overflow-hidden" style={{ borderLeft: `3px solid ${seg.color}` }}>
      <div className="cd-section-header">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>
          Morning brief <span className="cd-muted font-normal text-sm">· {dayLabel}</span>
        </h2>
        <Link href="/brief" className="text-xs hover:underline" style={{ color: '#B14919' }}>All briefs →</Link>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xl font-bold tabular-nums" style={{ color: '#2D1907' }}>
            RM {revenue.total.toLocaleString('en-MY', { maximumFractionDigits: 0 })}
          </span>
          {delta != null && (
            <span className="text-sm font-medium" style={{ color: up ? '#5c6b3c' : '#B14919' }}>
              {up ? '+' : ''}{delta}% vs its {revenue.baselineWeeks}-week {brief.facts.weekday} average
            </span>
          )}
          <span className="text-xs cd-muted">
            {brief.facts.visits.completed} completed · {brief.facts.boarding.catsIn} boarding · {brief.facts.boarding.occupancyPct}% of rooms
          </span>
        </div>

        {brief.observations.length > 0 && (
          <ul className="space-y-1.5">
            {brief.observations.map((o, i) => (
              <li key={i} className="text-sm flex gap-2" style={{ color: '#2D1907' }}>
                <span aria-hidden style={{ color: seg.color, opacity: 0.5 }}>—</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        )}

        {brief.actions.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="cd-label">Today</p>
            {brief.actions.map((a, i) => {
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
      </div>
    </section>
  )
}
