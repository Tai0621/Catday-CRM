import { requireManager } from '@/lib/auth'
import Link from 'next/link'
import { getConfig, fmtMoney } from '@/lib/config'
import { SEGMENTS } from '@/lib/segments'
import { isMediaConfigured, periodOf } from '@/lib/media'
import {
  receiptsForPeriod, expenseRecordsForPeriod, availablePeriods, summarise, monthLabelOf,
} from '@/lib/finance-records'

// Records — the document trail behind a month's figures.
//
// The two things checked at close: that the sales listed here are the sales the
// income statement counted, and that every expense claimed has an invoice behind
// it. Both are scoped to ONE accounting period at a time, deliberately: a screen
// that mixes March and April receipts is the thing this exists to prevent.
//
// The period comes from each record's own date. An invoice uploaded in April for
// a March expense files under March, because that is the month the money belongs
// to and the month the accountant is closing.

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  await requireManager()
  const cfg = await getConfig()
  const seg = SEGMENTS.business
  const { period: requested } = await searchParams

  const periods = await availablePeriods()
  // An unknown or malformed period falls back to the newest rather than
  // rendering an empty month that looks like missing data.
  const period = requested && periods.includes(requested) ? requested : (periods[0] ?? periodOf(new Date()))

  const [receipts, expenses] = await Promise.all([
    receiptsForPeriod(period),
    expenseRecordsForPeriod(period),
  ])
  const sum = summarise(period, receipts, expenses)
  const missing = expenses.filter(e => e.documents.length === 0)
  const coveragePct = sum.expenseTotal > 0 ? Math.round((sum.documentedTotal / sum.expenseTotal) * 100) : 100

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Records
          </h1>
          <p className="text-sm cd-muted">
            Every sale and every expense document for one month, for checking against the close.
          </p>
        </div>
        <Link href="/finance/income-statement" className="cd-btn-sec text-sm">Income Statement →</Link>
      </div>

      {/* One month at a time — the whole point of the screen. */}
      <form className="cd-card px-4 py-3 flex flex-wrap items-center gap-3">
        <label className="cd-label mb-0" htmlFor="period">Accounting period</label>
        <select id="period" name="period" defaultValue={period} className="cd-input" style={{ width: 'auto' }}>
          {periods.map(p => <option key={p} value={p}>{monthLabelOf(p)}</option>)}
        </select>
        <button type="submit" className="cd-btn-sec text-sm">Show</button>
        <span className="text-xs cd-muted ml-auto">
          Filed by the date of the sale or expense, not the date it was uploaded.
        </span>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Sales this month" value={String(sum.salesCount)}
          sub={fmtMoney(sum.salesTotal, cfg)} accent="#B14919" />
        <Stat label="Expenses recorded" value={String(sum.expenseCount)}
          sub={fmtMoney(sum.expenseTotal, cfg)} accent="#729094" />
        <Stat label="Invoices on file" value={`${coveragePct}%`}
          sub={`${sum.documented} of ${sum.expenseCount} · ${fmtMoney(sum.documentedTotal, cfg)} covered`}
          accent={coveragePct === 100 ? '#7A8A4F' : '#B8902B'} />
      </div>

      {/* ── Expenses missing a document ── the reason to open this screen ── */}
      {missing.length > 0 && (
        <section className="cd-card overflow-hidden" style={{ borderTop: '3px solid #B14919' }}>
          <div className="cd-section-header">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>
              No invoice on file
              <span className="cd-pill ml-2" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>{missing.length}</span>
            </h2>
            <Link href="/finance/expenses" className="text-xs cd-link">Upload on Expenses →</Link>
          </div>
          <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
            {missing.map(e => (
              <li key={e.id} className="px-4 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: '#2D1907' }}>
                    {e.category}{e.vendor ? ` · ${e.vendor}` : ''}
                  </p>
                  <p className="text-xs cd-muted">{e.date.toLocaleDateString(cfg.currency.locale)}</p>
                </div>
                <span className="text-sm font-semibold whitespace-nowrap" style={{ color: '#B14919' }}>
                  {fmtMoney(e.amount, cfg)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Expense documents ── */}
      <section className="cd-card overflow-hidden">
        <div className="cd-section-header">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Expense invoices &amp; receipts</h2>
          <span className="text-xs cd-muted">{monthLabelOf(period)}</span>
        </div>
        {expenses.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center cd-muted">No expenses recorded in this period.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'rgba(45,25,7,0.08)' }}>
            {expenses.filter(e => e.documents.length > 0).map(e => (
              <li key={e.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#2D1907' }}>
                      {e.category}{e.vendor ? ` · ${e.vendor}` : ''}
                    </p>
                    <p className="text-xs cd-muted">
                      {e.date.toLocaleDateString(cfg.currency.locale)}
                      {!e.paid && ' · unpaid'}
                    </p>
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap" style={{ color: '#2D1907' }}>
                    {fmtMoney(e.amount, cfg)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {e.documents.map(d => (
                    <a key={d.id} href={`/api/media/${d.id}/file`} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded-lg inline-flex items-center gap-1.5"
                      style={{ background: 'rgba(114,144,148,0.14)', color: '#4a6265', border: '1px solid rgba(114,144,148,0.3)' }}>
                      {d.kind === 'document' ? 'PDF' : 'Image'}
                      <span className="cd-muted">{d.createdAt.toLocaleDateString(cfg.currency.locale)}</span>
                    </a>
                  ))}
                </div>
              </li>
            ))}
            {expenses.every(e => e.documents.length === 0) && (
              <li className="px-4 py-6 text-sm text-center cd-muted">
                Nothing filed for this period yet — upload invoices from the{' '}
                <Link href="/finance/expenses" className="cd-link">Expenses</Link> screen.
              </li>
            )}
          </ul>
        )}
        {!isMediaConfigured() && (
          <p className="px-4 py-2 text-xs cd-muted" style={{ borderTop: '1px solid rgba(45,25,7,0.08)' }}>
            Document storage isn’t set up on this deployment yet, so nothing can be uploaded.
          </p>
        )}
      </section>

      {/* ── Sales receipts ── */}
      <section className="cd-card overflow-hidden">
        <div className="cd-section-header">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Sales receipts</h2>
          <span className="text-xs cd-muted">
            {sum.salesCount} sale{sum.salesCount === 1 ? '' : 's'} · {fmtMoney(sum.salesTotal, cfg)}
          </span>
        </div>
        <p className="px-4 pt-3 text-xs cd-muted">
          One line per sale. A split payment is stored as several rows sharing a reference and is
          shown here as the single sale it was — so this count is the number of receipts issued,
          while the total is the money taken and is the figure to check against the Income Statement.
        </p>
        {receipts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center cd-muted">No sales recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="cd-thead">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Reference</th>
                  <th className="text-left px-4 py-2">Customer</th>
                  <th className="text-left px-4 py-2">Paid by</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="cd-tbody">
                {receipts.map(r => (
                  <tr key={r.primaryId}>
                    <td className="px-4 py-2 whitespace-nowrap">{r.date.toLocaleDateString(cfg.currency.locale)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.reference ?? '—'}</td>
                    <td className="px-4 py-2 truncate">{r.customer ?? 'Walk-in'}</td>
                    <td className="px-4 py-2 text-xs">
                      {r.methods.join(' + ') || '—'}
                      {r.rowCount > 1 && <span className="cd-muted"> (split)</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{fmtMoney(r.total, cfg)}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/pos/receipt/${r.primaryId}`} className="text-xs cd-link">Receipt</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="cd-card px-4 py-3" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-xs cd-muted">{label}</div>
      <div className="text-xl font-bold" style={{ color: '#2D1907' }}>{value}</div>
      <div className="text-xs cd-muted">{sub}</div>
    </div>
  )
}
