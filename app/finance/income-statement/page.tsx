import { requireManager } from '@/lib/auth'
import { buildIncomeStatement, type IncomeStatement } from '@/lib/finance'
import { buildForecastStatement, FORECAST_YEARS } from '@/lib/finance-forecast'
import { SEGMENTS } from '@/lib/segments'
import Link from 'next/link'
import { StatementTable } from './StatementTable'
import { StatementTabs } from '../StatementTabs'

// One layout for both views — Actuals (live + accountant-keyed) and the Excel
// model's Forecast — so the toggle never jumps. A Plan-vs-Actual strip tracks
// how reality is running against the model.
export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; view?: string }>
}) {
  await requireManager()
  const { year: yearParam, view } = await searchParams
  const year = /^\d{4}$/.test(yearParam ?? '') ? Number(yearParam) : new Date().getFullYear()
  const forecast = view === 'forecast'

  const actual = await buildIncomeStatement(year)
  const plan = buildForecastStatement(year)
  const s: IncomeStatement = forecast ? plan : actual
  const seg = SEGMENTS.business

  const years = forecast ? [...FORECAST_YEARS] : actual.availableYears
  const hasAnyData = actual.totalRevenue.total !== 0 || actual.totalCogs.total !== 0 || actual.totalOpex.total !== 0

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <StatementTabs />
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
        {/* Control bar — identical structure in both views so nothing jumps */}
        <div className="flex flex-wrap items-center gap-2">
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
                ? { background: '#E7CE7A', color: '#2D1907', fontWeight: 700 }
                : { background: 'rgba(45,25,7,0.04)', color: 'rgba(45,25,7,0.55)' }}>
              Forecast (Excel model)
            </Link>
          </div>
          {years.map(y => (
            <Link key={y} href={`/finance/income-statement?year=${y}${forecast ? '&view=forecast' : ''}`}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={y === year
                ? { background: '#2D1907', color: '#ECDBB6', fontWeight: 600 }
                : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' }}>
              {y}
            </Link>
          ))}
          <a href={`/finance/income-statement/export?year=${year}${forecast ? '&view=forecast' : ''}`}
            className="cd-btn text-sm">
            ⤓ Export to Excel
          </a>
        </div>
      </div>

      {/* Year headline — same cards in both views */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Headline label={`Revenue ${year}${forecast ? ' (plan)' : ''}`} value={s.totalRevenue.total} />
        <Headline label={forecast ? 'Gross Profit (plan)' : 'Gross Profit'} value={s.grossProfit.total} sub={s.yearGrossMarginPct != null ? `${s.yearGrossMarginPct}% margin` : undefined} />
        <Headline label={forecast ? 'EBITDA (plan)' : 'EBITDA'} value={s.ebitda.total} sub={s.yearEbitdaMarginPct != null ? `${s.yearEbitdaMarginPct}% margin` : undefined} />
        <Headline label={forecast ? 'Net Income (plan)' : 'Net Income'} value={s.netIncome.total} sub={s.yearNetMarginPct != null ? `${s.yearNetMarginPct}% margin` : undefined} />
      </div>

      {/* Plan vs actual — the key relationship, tracked year-to-date */}
      {!forecast && <PlanVsActual actual={actual} plan={plan} year={year} />}

      {!forecast && !hasAnyData && (
        <div className="cd-card px-5 py-4 text-sm cd-muted">
          No figures for {year} yet. Revenue appears here automatically when checkouts happen at the{' '}
          <Link href="/pos" className="cd-link">POS</Link>; record rent, salaries and other costs at{' '}
          <Link href="/finance/expenses" className="cd-link">Expenses</Link> — or press ✎ Edit below to key
          figures directly.
        </div>
      )}

      <StatementTable statement={s} mode={forecast ? 'forecast' : 'actuals'} />

      <p className="text-xs cd-muted">
        {forecast
          ? 'Conservative scenario from CATDAY Income Statement.xlsx — 2026 follows its monthly ramp; later years spread the annual figures evenly. Edit lib/finance-forecast.ts if the model changes.'
          : 'Tax row defaults to a 24% provision on profitable months (the model’s corporate rate) — key the assessed figure over it when LHDN’s annual computation lands. Balance sheet & cash flow join once asset and liability data exist (three-statement goal).'}
      </p>
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

// ── Actuals vs the Excel model, year-to-date ──
function PlanVsActual({ actual, plan, year }: { actual: IncomeStatement; plan: IncomeStatement; year: number }) {
  const now = new Date()
  // Compare through the last complete-ish month: current month for this year,
  // the full year for past years; future years have nothing to compare.
  const upto = year === now.getFullYear() ? now.getMonth() : year < now.getFullYear() ? 11 : -1
  if (upto < 0 || plan.totalRevenue.total === 0) return null

  const ytd = (values: number[]) => Math.round(values.slice(0, upto + 1).reduce((s, v) => s + v, 0) * 100) / 100
  const rm = (v: number) =>
    v < 0 ? `(RM ${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})` : `RM ${v.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`

  const metrics = [
    { label: 'Revenue', a: ytd(actual.totalRevenue.values), p: ytd(plan.totalRevenue.values) },
    { label: 'Gross Profit', a: ytd(actual.grossProfit.values), p: ytd(plan.grossProfit.values) },
    { label: 'EBITDA', a: ytd(actual.ebitda.values), p: ytd(plan.ebitda.values) },
  ]
  const monthName = new Date(year, upto, 1).toLocaleDateString('en-MY', { month: 'long' })

  return (
    <section className="cd-card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-sm" style={{ color: '#2D1907' }}>
          Actuals vs Plan <span className="cd-muted font-normal text-xs">· Jan – {monthName} {year}, against the Excel model</span>
        </h2>
        <Link href={`/finance/income-statement?year=${year}&view=forecast`} className="text-xs cd-link">See full plan →</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {metrics.map(m => {
          const diff = Math.round((m.a - m.p) * 100) / 100
          const ahead = diff >= 0
          const pct = m.p > 0 ? Math.round((m.a / m.p) * 100) : null
          return (
            <div key={m.label} className="space-y-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium" style={{ color: '#2D1907' }}>{m.label}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={ahead
                    ? { background: 'rgba(122,138,79,0.18)', color: '#5c6b3c' }
                    : { background: 'rgba(177,73,25,0.14)', color: '#B14919' }}>
                  {ahead ? '▲' : '▼'} {rm(Math.abs(diff))} {ahead ? 'ahead of' : 'behind'} plan
                </span>
              </div>
              {pct != null ? (
                <>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(45,25,7,0.08)' }}>
                    <div className="h-full rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: pct >= 100 ? '#7A8A4F' : '#B8902B' }} />
                  </div>
                  <div className="flex justify-between text-xs cd-muted">
                    <span>{rm(m.a)} actual</span>
                    <span>{pct}% of {rm(m.p)} plan</span>
                  </div>
                </>
              ) : (
                <div className="text-xs cd-muted">
                  {rm(m.a)} actual vs {rm(m.p)} planned{m.p < 0 ? ' (model expects a loss this period)' : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
