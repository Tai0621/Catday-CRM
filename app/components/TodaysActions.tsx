import Link from 'next/link'
import { buildActionQueue } from '@/lib/actions'
import { whatsappUrl } from '@/lib/phone'
import { SEGMENTS } from '@/lib/segments'

// The dashboard's five-row preview of the Action Inbox.
//
// It lives in its own file so the dashboard can <Suspense> it. Building the
// queue is by a wide margin the most expensive thing on that page — it derives
// the ENTIRE inbox (every customer with their visit history, a year of
// transactions, every cat, the licence register, today's care logs) in order to
// show five rows and a count. Those queries do not overlap with anything: the
// libsql adapter takes a mutex per statement, so while the queue is being built
// the rest of the dashboard is simply waiting.
//
// Suspended, it stops holding the page hostage — the revenue, the panels and
// the alerts paint as soon as their own data lands, and these five rows drop in
// after.

export async function TodaysActions() {
  const actionQueue = await buildActionQueue()
  const topActions = actionQueue.slice(0, 5)

  return (
    <section className="cd-card overflow-hidden">
      <div className="cd-section-header">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>
          Today&apos;s Actions {actionQueue.length > 0 && (
            <span className="cd-pill ml-1" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>{actionQueue.length}</span>
          )}
        </h2>
        <Link href="/actions" className="text-xs hover:underline" style={{ color: '#B14919' }}>Open inbox →</Link>
      </div>
      {topActions.length === 0 ? (
        <p className="px-5 py-6 text-sm text-center cd-muted">All clear — nothing needs attention right now 🐾</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
          {topActions.map(a => (
            <li key={a.key} className="px-5 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2.5">
                <span className="rounded-full shrink-0" title={SEGMENTS[a.segment].label}
                  style={{ width: 7, height: 7, background: SEGMENTS[a.segment].color }} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: '#2D1907' }}>{a.title}</p>
                  <p className="text-xs cd-muted truncate">{a.reason}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="cd-pill" style={a.band === 'Do now'
                  ? { background: 'rgba(177,73,25,0.15)', color: '#B14919' }
                  : { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.55)' }}>{a.band}</span>
                {a.phone && a.waMessage && (
                  <a href={whatsappUrl(a.phone, a.waMessage)} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1 rounded hover:opacity-90 transition-opacity"
                    style={{ background: '#729094', color: '#F2EDE0' }}>
                    WhatsApp
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Holds the section's shape while the queue is built, so the cards below it do
 * not jump down the page when it arrives. Matches the app's skeleton treatment
 * rather than a spinner.
 */
export function TodaysActionsSkeleton() {
  return (
    <section className="cd-card overflow-hidden" aria-busy="true">
      <div className="cd-section-header">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>Today&apos;s Actions</h2>
        <span className="text-xs cd-muted">Reading the day…</span>
      </div>
      <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
        {[0, 1, 2].map(i => (
          <li key={i} className="px-5 py-2.5 flex items-center gap-2.5">
            <span className="rounded-full shrink-0 cd-skeleton" style={{ width: 7, height: 7 }} />
            <span className="cd-skeleton rounded" style={{ height: 12, width: `${55 - i * 10}%` }} />
          </li>
        ))}
      </ul>
    </section>
  )
}
