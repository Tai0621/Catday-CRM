import { requireManager } from '@/lib/auth'
import { buildIncomeStatement } from '@/lib/finance'
import { SEGMENTS } from '@/lib/segments'
import Link from 'next/link'
import { ForecastView } from './ForecastView'
import { StatementTable } from './StatementTable'

// The Excel's income statement, live: revenue rows come from the same
// transactions the POS writes; cost rows from the Expenses page. Accountant
// can hard-key any leaf cell (blue) — OS figures stay black and auto-update.
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

      {forecast ? (
        <ForecastView />
      ) : (
        <>
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
              <Link href="/finance/expenses" className="cd-link">Expenses</Link> — or click any cell below to key
              a figure directly.
            </div>
          )}

          <StatementTable statement={s} />

          <p className="text-xs cd-muted">
            Tax row defaults to a 24% provision on profitable months (the model&apos;s corporate rate) — key the
            assessed figure over it when LHDN&apos;s annual computation lands. Balance sheet &amp; cash flow join
            once asset and liability data exist (three-statement goal).
          </p>
        </>
      )}
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
