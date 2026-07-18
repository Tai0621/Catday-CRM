import { requireManager } from '@/lib/auth'
import { buildIncomeStatement, type StatementRow } from '@/lib/finance'
import { SEGMENTS } from '@/lib/segments'
import Link from 'next/link'
import { ForecastView } from './ForecastView'

// The Excel's income statement, live: revenue rows come from the same
// transactions the POS writes; cost rows from the Expenses page.
// ?view=forecast shows the Excel model's estimates instead of actuals.
export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; view?: string }>
}) {
  await requireManager()
  const { year: yearParam, view } = await searchParams
  const year = /^\d{4}$/.test(yearParam ?? '') ? Number(yearParam) : new Date().getFullYear()
  const forecast = view === 'forecast'
  const s = await buildIncomeStatement(year)
  const seg = SEGMENTS.business

  const fmt = (v: number) =>
    v < 0 ? `(${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
      : v === 0 ? '–'
      : v.toLocaleString('en-MY', { maximumFractionDigits: 0 })

  const numCell = (v: number, bold = false) => (
    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
      style={{ color: v < 0 ? '#B14919' : bold ? '#2D1907' : 'rgba(45,25,7,0.75)', fontWeight: bold ? 700 : 400 }}>
      {fmt(v)}
    </td>
  )

  const dataRow = (r: StatementRow, opts?: { bold?: boolean; indent?: boolean; topRule?: boolean }) => (
    <tr key={r.label} style={opts?.topRule ? { borderTop: '2px solid rgba(45,25,7,0.25)' } : undefined}>
      <td className={`px-3 py-1.5 whitespace-nowrap ${opts?.indent ? 'pl-7' : ''}`}
        style={{ color: '#2D1907', fontWeight: opts?.bold ? 700 : 400, position: 'sticky', left: 0, background: '#F2EDE0' }}>
        {r.label}
      </td>
      {r.values.map((v, i) => <NumTd key={i} v={v} bold={opts?.bold} />)}
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap"
        style={{ color: r.total < 0 ? '#B14919' : '#2D1907', fontWeight: 700, borderLeft: '1px solid rgba(45,25,7,0.15)' }}>
        {fmt(r.total)}
      </td>
    </tr>
  )

  function NumTd({ v, bold }: { v: number; bold?: boolean }) {
    return numCell(v, bold)
  }

  const sectionHead = (label: string) => (
    <tr>
      <td colSpan={14} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase"
        style={{ color: seg.text, letterSpacing: '0.08em', position: 'sticky', left: 0 }}>
        {label}
      </td>
    </tr>
  )

  const pctRow = (label: string, values: number[], yearVal: number | null) => (
    <tr>
      <td className="px-3 py-1 text-xs italic whitespace-nowrap"
        style={{ color: 'rgba(45,25,7,0.5)', position: 'sticky', left: 0, background: '#F2EDE0' }}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-2 py-1 text-right text-xs italic tabular-nums" style={{ color: v < 0 ? 'rgba(45,25,7,0.3)' : 'rgba(45,25,7,0.55)' }}>
          {v < 0 ? '–' : `${v}%`}
        </td>
      ))}
      <td className="px-2 py-1 text-right text-xs italic tabular-nums"
        style={{ color: 'rgba(45,25,7,0.65)', borderLeft: '1px solid rgba(45,25,7,0.15)' }}>
        {yearVal == null ? '–' : `${yearVal}%`}
      </td>
    </tr>
  )

  const hasAnyData = s.totalRevenue.total !== 0 || s.totalCogs.total !== 0 || s.totalOpex.total !== 0

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Income Statement
          </h1>
          <p className="text-sm cd-muted">
            Live P&L — revenue flows in from checkout automatically; costs from the{' '}
            <Link href="/finance/expenses" className="cd-link">Expenses</Link> page. All figures in RM.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Actuals ⇄ Forecast toggle */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(45,25,7,0.15)' }}>
            <Link href={`/finance/income-statement?year=${year}`}
              className="text-xs px-3 py-1.5"
              style={!forecast
                ? { background: '#2D1907', color: '#ECDBB6', fontWeight: 600 }
                : { background: 'rgba(45,25,7,0.04)', color: 'rgba(45,25,7,0.55)' }}>
              Actuals
            </Link>
            <Link href={`/finance/income-statement?year=${year}&view=forecast`}
              className="text-xs px-3 py-1.5"
              style={forecast
                ? { background: seg.color, color: '#2D1907', fontWeight: 700 }
                : { background: 'rgba(45,25,7,0.04)', color: 'rgba(45,25,7,0.55)' }}>
              Forecast (Excel model)
            </Link>
          </div>
          {!forecast && s.availableYears.map(y => (
            <Link key={y} href={`/finance/income-statement?year=${y}`}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={y === year
                ? { background: '#2D1907', color: '#ECDBB6', fontWeight: 600 }
                : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' }}>
              {y}
            </Link>
          ))}
          {!forecast && (
            <a href={`/finance/income-statement/export?year=${year}`} className="cd-btn text-sm">⤓ Export to Excel</a>
          )}
        </div>
      </div>

      {forecast && <ForecastView />}

      {!forecast && <>
      {/* Year headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Headline label={`Revenue ${year}`} value={s.totalRevenue.total} />
        <Headline label="Gross Profit" value={s.grossProfit.total} sub={s.yearGrossMarginPct != null ? `${s.yearGrossMarginPct}% margin` : undefined} />
        <Headline label="EBITDA" value={s.ebitda.total} sub={s.yearEbitdaMarginPct != null ? `${s.yearEbitdaMarginPct}% margin` : undefined} />
        <Headline label="Net Income" value={s.netIncome.total} sub={s.yearNetMarginPct != null ? `${s.yearNetMarginPct}% margin` : undefined} />
      </div>

      {!hasAnyData && (
        <div className="cd-card px-5 py-4 text-sm cd-muted">
          No figures for {year} yet. Revenue appears here automatically when checkouts happen at the{' '}
          <Link href="/pos" className="cd-link">POS</Link>; record rent, salaries and other costs at{' '}
          <Link href="/finance/expenses" className="cd-link">Expenses</Link>.
        </div>
      )}

      <div className="cd-card overflow-x-auto">
        <table className="text-xs w-full" style={{ borderCollapse: 'collapse', minWidth: '68rem' }}>
          <thead>
            <tr className="cd-thead">
              <th style={{ position: 'sticky', left: 0, background: '#ECDBB6', zIndex: 1 }}>RM</th>
              {s.months.map(m => <th key={m} className="text-right px-2">{m}</th>)}
              <th className="text-right px-2" style={{ borderLeft: '1px solid rgba(45,25,7,0.15)' }}>{year} Total</th>
            </tr>
          </thead>
          <tbody className="cd-tbody">
            {sectionHead('Revenue')}
            {s.revenue.map(r => dataRow(r, { indent: true }))}
            {dataRow(s.totalRevenue, { bold: true, topRule: true })}

            {sectionHead('Cost of Services (variable)')}
            {s.cogs.map(r => dataRow(r, { indent: true }))}
            {dataRow(s.totalCogs, { bold: true, topRule: true })}
            {dataRow(s.grossProfit, { bold: true })}
            {pctRow('Gross Margin %', s.grossMarginPct, s.yearGrossMarginPct)}

            {sectionHead('Operating Expenses (fixed)')}
            {s.opex.map(r => dataRow(r, { indent: true }))}
            {dataRow(s.totalOpex, { bold: true, topRule: true })}

            {dataRow(s.ebitda, { bold: true, topRule: true })}
            {pctRow('EBITDA Margin %', s.ebitdaMarginPct, s.yearEbitdaMarginPct)}
            {dataRow(s.tax, { indent: true })}
            {dataRow(s.netIncome, { bold: true, topRule: true })}
            <tr>
              <td className="px-3 py-1.5 whitespace-nowrap text-xs italic"
                style={{ color: 'rgba(45,25,7,0.5)', position: 'sticky', left: 0, background: '#F2EDE0' }}>
                Cumulative Net Income
              </td>
              {s.cumulativeNet.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right text-xs italic tabular-nums"
                  style={{ color: v < 0 ? '#B14919' : 'rgba(45,25,7,0.65)' }}>
                  {fmt(v)}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right text-xs italic tabular-nums"
                style={{ color: s.netIncome.total < 0 ? '#B14919' : 'rgba(45,25,7,0.65)', borderLeft: '1px solid rgba(45,25,7,0.15)' }}>
                {fmt(s.netIncome.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs cd-muted">
        Tax row is a 24% provision on profitable months (the model&apos;s corporate rate) — LHDN computes the real
        figure annually. Balance sheet &amp; cash flow join once asset and liability data exist (three-statement goal).
      </p>
      </>}
    </div>
  )
}

function Headline({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted">{label}</div>
      <div className="text-xl font-bold tabular-nums" style={{ color: value < 0 ? '#B14919' : '#2D1907' }}>
        {value < 0 ? `(RM ${Math.abs(value).toLocaleString('en-MY', { maximumFractionDigits: 0 })})` : `RM ${value.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`}
      </div>
      {sub && <div className="text-xs cd-muted">{sub}</div>}
    </div>
  )
}
