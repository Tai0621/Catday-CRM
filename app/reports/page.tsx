import { requireManager } from '@/lib/auth'
import { reportsForMonth, reportedMonths, previousMonth, monthLabel, departmentByKey, isMonthKey } from '@/lib/reports'
import { SEGMENTS } from '@/lib/segments'
import { aiConfigured } from '@/lib/ai/provider'
import { generateMonthNow, renarrateDepartment } from './actions'
import Link from 'next/link'

// C9 · The monthly record. Six departments, one closed month at a time.
//
// Facts are always shown. The narrative is shown when it was traced to them,
// and shown behind a warning when it was not — hiding a flagged report would
// throw away sound figures because the prose about them was wrong.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  await requireManager()
  const { month: requested } = await searchParams
  const months = await reportedMonths()
  const month = requested && isMonthKey(requested) ? requested : (months[0] ?? previousMonth())
  const reports = await reportsForMonth(month)
  // Asks the provider seam, not one provider's env var: the demo runs on
  // Groq and would otherwise hide a working feature behind the
  // "not configured" state.
  const configured = aiConfigured()

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: SEGMENTS.business.color }} />
            Department reports
          </h1>
          <p className="text-sm cd-muted">
            Six reports for {monthLabel(month)}. Figures are computed by the OS from the same builders
            the statements use — the assistant only writes about them.
          </p>
        </div>
        {reports.length === 0 && (
          <form action={generateMonthNow}>
            <input type="hidden" name="month" value={month} />
            <button type="submit" className="cd-btn text-sm whitespace-nowrap">Generate {month}</button>
          </form>
        )}
      </div>

      {months.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {months.map(m => (
            <Link key={m} href={`/reports?month=${m}`} className="text-xs px-3 py-1.5 rounded-lg"
              style={m === month
                ? { background: SEGMENTS.business.color, color: '#F2EDE0', fontWeight: 600 }
                : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)' }}>
              {monthLabel(m)}
            </Link>
          ))}
        </div>
      )}

      {reports.length === 0 ? (
        <div className="cd-card py-12 text-center">
          <p className="text-sm cd-muted">
            Nothing for {monthLabel(month)} yet. Reports are written on the 1st for the month just closed
            {configured ? ', or now with the button above' : ''}.
          </p>
        </div>
      ) : (
        reports.map(r => {
          const dept = departmentByKey(r.department)
          const color = dept ? SEGMENTS[dept.segment].color : SEGMENTS.business.color
          return (
            <section key={r.department} className="cd-card overflow-hidden" style={{ borderLeft: `3px solid ${color}` }}>
              <div className="cd-section-header">
                <h2 className="font-semibold" style={{ color: '#2D1907' }}>{dept?.label ?? r.department}</h2>
                {r.status === 'Facts' && <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.55)' }}>figures only</span>}
                {r.status === 'Flagged' && <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>unverified figures</span>}
              </div>

              <div className="px-5 py-4 space-y-3">
                {r.status === 'Flagged' && (
                  <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(177,73,25,0.07)', border: '1px solid rgba(177,73,25,0.25)' }}>
                    <p className="text-sm" style={{ color: '#B14919' }}>
                      The written summary below quotes {r.unsupported.length === 1 ? 'a figure' : 'figures'} that
                      {' '}{r.unsupported.length === 1 ? 'does' : 'do'} not appear in this month&apos;s data
                      {' — '}<strong>{r.unsupported.join(', ')}</strong>. The figures further down are computed
                      by the OS and are unaffected. Do not quote the summary until it has been rewritten.
                    </p>
                    <form action={renarrateDepartment}>
                      <input type="hidden" name="month" value={r.month} />
                      <input type="hidden" name="department" value={r.department} />
                      <button type="submit" className="text-xs cd-btn-sec">Rewrite from the same figures</button>
                    </form>
                  </div>
                )}

                {r.status === 'Facts' && (
                  <p className="text-sm cd-muted">
                    No written summary — the assistant was unavailable when this was generated. The figures
                    below are complete.
                  </p>
                )}

                {r.headline && r.status !== 'Facts' && (
                  <p className="text-sm font-semibold" style={{ color: '#2D1907' }}>{r.headline}</p>
                )}

                {r.observations.length > 0 && (
                  <ul className="space-y-1.5">
                    {r.observations.map((o, i) => (
                      <li key={i} className="text-sm flex gap-2" style={{ color: '#2D1907' }}>
                        <span aria-hidden style={{ color, opacity: 0.5 }}>—</span>
                        <span>{o}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {r.actions.length > 0 && (
                  <div className="space-y-1.5">
                    {r.actions.map((a, i) => {
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

                <details>
                  <summary className="text-xs cd-muted cursor-pointer">The figures</summary>
                  <pre className="mt-2 text-xs overflow-x-auto p-3 rounded-lg"
                    style={{ background: 'rgba(45,25,7,0.05)', color: 'rgba(45,25,7,0.75)' }}>
                    {JSON.stringify(r.facts, null, 2)}
                  </pre>
                </details>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
