import { requireManager } from '@/lib/auth'
import { buildCashFlow, type CFSection } from '@/lib/cash-flow'
import { monthKey } from '@/lib/plan'
import { SEGMENTS } from '@/lib/segments'
import Link from 'next/link'

// Cash Flow Statement — year-to-date, indirect method. Read-only: every figure
// derives from the income statement and the movement between two balance
// sheets, so it always ties to the balance-sheet cash line.
export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>
}) {
  await requireManager()
  const { to: toParam } = await searchParams
  const to = /^\d{4}-\d{2}$/.test(toParam ?? '') ? toParam! : monthKey(new Date())
  const from = `${Number(to.slice(0, 4)) - 1}-12` // year-to-date: opening = prior year-end
  const cf = await buildCashFlow(from, to)
  const seg = SEGMENTS.business

  const fmt = (v: number) =>
    v < 0 ? `(${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
      : v === 0 ? '–'
      : v.toLocaleString('en-MY', { maximumFractionDigits: 0 })

  // month chips for the closing month (this year up to now)
  const now = new Date(); const yr = Number(to.slice(0, 4))
  const months: string[] = []
  const lastM = yr === now.getFullYear() ? now.getMonth() + 1 : 12
  for (let m = 1; m <= lastM; m++) months.push(`${yr}-${String(m).padStart(2, '0')}`)

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Cash Flow Statement
          </h1>
          <p className="text-sm cd-muted">
            Year to date · end {cf.fromLabel} → end {cf.toLabel} · indirect method. Derived from the{' '}
            <Link href="/finance/income-statement" className="cd-link">Income Statement</Link> and{' '}
            <Link href="/finance/balance-sheet" className="cd-link">Balance Sheet</Link>.
          </p>
        </div>
        <a href={`/finance/cash-flow/export?to=${to}`} className="cd-btn text-sm">⤓ Export to Excel</a>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {months.map(m => {
          const [y, mm] = m.split('-').map(Number)
          const lbl = new Date(y, mm - 1, 1).toLocaleDateString('en-MY', { month: 'short' })
          return (
            <Link key={m} href={`/finance/cash-flow?to=${m}`} className="text-xs px-2.5 py-1 rounded-lg"
              style={m === to
                ? { background: '#2D1907', color: '#ECDBB6', fontWeight: 600 }
                : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' }}>
              {lbl}
            </Link>
          )
        })}
      </div>

      {/* Tie / integrity banner */}
      <div className="rounded-xl px-4 py-2.5 text-sm"
        style={cf.ties
          ? { background: 'rgba(122,138,79,0.15)', border: '1px solid rgba(122,138,79,0.35)', color: '#5c6b3c' }
          : { background: 'rgba(177,73,25,0.1)', border: '1px solid rgba(177,73,25,0.3)', color: '#B14919' }}>
        {cf.ties ? (
          <span className="font-semibold">✓ Ties to the balance sheet — closing cash RM {cf.balanceSheetClosingCash.toLocaleString('en-MY', { maximumFractionDigits: 0 })}</span>
        ) : (
          <>
            <span className="font-semibold">⚠ Does not tie by RM {Math.abs(cf.tie).toLocaleString('en-MY', { maximumFractionDigits: 0 })}.</span>{' '}
            <span className="text-xs">
              {(!cf.openBalanced || !cf.closeBalanced)
                ? 'The balance sheet is out of balance at one end of the period — fix it there and this ties automatically.'
                : 'Check the opening/closing cash keyed on the balance sheet.'}
            </span>
          </>
        )}
      </div>

      <div className="cd-card overflow-hidden">
        <table className="text-sm w-full" style={{ borderCollapse: 'collapse' }}>
          <tbody className="cd-tbody">
            {[cf.operating, cf.investing, cf.financing].map(s => <Section key={s.title} s={s} fmt={fmt} />)}
            <Total label="Net change in cash" value={cf.netChange} fmt={fmt} strong />
            <Simple label={`Opening cash (end ${cf.fromLabel})`} value={cf.openingCash} fmt={fmt} />
            <Total label={`Closing cash (end ${cf.toLabel})`} value={cf.computedClosingCash} fmt={fmt} strong />
          </tbody>
        </table>
      </div>

      <p className="text-xs cd-muted">
        Built from balance-sheet movements, so closing cash always reconciles to the balance sheet when both period-ends
        balance. Depreciation is captured within the change in fixed assets (net). Read-only — key the underlying figures on
        the <Link href="/finance/balance-sheet" className="cd-link">Balance Sheet</Link>.
      </p>
    </div>
  )
}

function Section({ s, fmt }: { s: CFSection; fmt: (v: number) => string }) {
  return (
    <>
      <tr><td colSpan={2} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase" style={{ color: '#5C4A32', letterSpacing: '0.08em' }}>{s.title}</td></tr>
      {s.lines.map((l, i) => (
        <tr key={i}>
          <td className="px-4 py-1.5 pl-7 whitespace-nowrap" style={{ color: '#2D1907' }}>{l.label}</td>
          <td className="px-4 py-1.5 text-right tabular-nums" style={{ color: l.value < 0 ? '#B14919' : 'rgba(45,25,7,0.8)' }}>{fmt(l.value)}</td>
        </tr>
      ))}
      <tr style={{ borderTop: '1px solid rgba(45,25,7,0.12)' }}>
        <td className="px-4 py-1 pl-7 text-xs uppercase tracking-wide" style={{ color: 'rgba(45,25,7,0.5)' }}>Net cash — {s.title.replace(' activities', '')}</td>
        <td className="px-4 py-1 text-right tabular-nums text-xs font-semibold" style={{ color: s.subtotal < 0 ? '#B14919' : '#2D1907' }}>{fmt(s.subtotal)}</td>
      </tr>
    </>
  )
}

function Total({ label, value, fmt, strong }: { label: string; value: number; fmt: (v: number) => string; strong?: boolean }) {
  return (
    <tr style={{ borderTop: '2px solid rgba(45,25,7,0.25)' }}>
      <td className="px-4 py-1.5 font-bold" style={{ color: '#2D1907' }}>{label}</td>
      <td className="px-4 py-1.5 text-right font-bold tabular-nums" style={{ color: value < 0 ? '#B14919' : '#2D1907' }}>{fmt(value)}</td>
    </tr>
  )
}

function Simple({ label, value, fmt }: { label: string; value: number; fmt: (v: number) => string }) {
  return (
    <tr>
      <td className="px-4 py-1.5" style={{ color: 'rgba(45,25,7,0.7)' }}>{label}</td>
      <td className="px-4 py-1.5 text-right tabular-nums" style={{ color: 'rgba(45,25,7,0.7)' }}>{fmt(value)}</td>
    </tr>
  )
}
