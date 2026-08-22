import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { monthKey, monthLabel, monthsBetween } from '@/lib/plan'
import { buildPlanProjection, defaultDrivers, DRIVER_GROUPS, ALL_DRIVER_KEYS, type PlanDrivers } from '@/lib/plan-model'
import { buildIncomeStatement } from '@/lib/finance'
import { SEGMENTS } from '@/lib/segments'
import { ScenarioAnalysis } from './ScenarioAnalysis'
import { SubmitButton } from '@/app/components/Pending'

export default async function PlanPage() {
  await requireManager()
  const now = new Date()

  const [plan, driverRows, roomCount] = await Promise.all([
    db.businessPlan.findUnique({ where: { id: 'default' } }),
    db.planDriver.findMany(),
    db.room.count({ where: { isActive: true, type: { in: ['Standard', 'Suite'] } } }),
  ])

  const startMonth = plan?.startMonth ?? monthKey(now)
  const breakevenMonth = plan?.breakevenMonth ?? monthKey(new Date(now.getFullYear() + 2, now.getMonth(), 1))

  const drivers: PlanDrivers = { ...defaultDrivers(roomCount || 50) }
  for (const r of driverRows) drivers[r.key] = r.value

  const proj = buildPlanProjection(drivers, startMonth, breakevenMonth)
  const seg = SEGMENTS.business

  // ── Real revenue & cost over the elapsed part of the plan (drives the smart
  // recommendation). Uses the income statement actuals, which merge recorded
  // expenses with any accountant-keyed figures. ──
  const nowKey = monthKey(now)
  const elapsedEnd = nowKey < startMonth ? null : (nowKey < breakevenMonth ? nowKey : breakevenMonth)
  const elapsedMonths = elapsedEnd ? monthsBetween(startMonth, elapsedEnd) : []
  let actual: { months: number; revenue: number; cost: number } | null = null
  if (elapsedMonths.length > 0) {
    const yearsNeeded = [...new Set(elapsedMonths.map(m => Number(m.slice(0, 4))))]
    const statements = Object.fromEntries(
      await Promise.all(yearsNeeded.map(async y => [y, await buildIncomeStatement(y)] as const)),
    )
    let rev = 0, cost = 0
    for (const mk of elapsedMonths) {
      const y = Number(mk.slice(0, 4)); const mi = Number(mk.slice(5, 7)) - 1
      const st = statements[y]
      rev += st.totalRevenue.values[mi]
      cost += st.totalCogs.values[mi] + st.totalOpex.values[mi]
    }
    actual = { months: elapsedMonths.length, revenue: Math.round(rev), cost: Math.round(cost) }
  }
  // What the plan itself expected over those same elapsed months
  const K = elapsedMonths.length
  const plannedElapsed = {
    revenue: Math.round(proj.totalRevenue.slice(0, K).reduce((s, v) => s + v, 0)),
    cost: Math.round(proj.totalCogs.slice(0, K).reduce((s, v) => s + v, 0) + proj.totalOpex.slice(0, K).reduce((s, v) => s + v, 0)),
  }

  // ── Save horizon + drivers, then regenerate monthly targets for the dashboard ──
  async function savePlan(data: FormData) {
    'use server'
    const start = (data.get('startMonth') as string) || startMonth
    const end = (data.get('breakevenMonth') as string) || breakevenMonth

    await db.businessPlan.upsert({
      where: { id: 'default' },
      create: { id: 'default', startMonth: start, breakevenMonth: end, avgSaleValue: plan?.avgSaleValue ?? 0 },
      update: { startMonth: start, breakevenMonth: end },
    })

    const nextDrivers: PlanDrivers = { ...drivers }
    await db.$transaction(
      ALL_DRIVER_KEYS.flatMap(key => {
        const raw = data.get(`d_${key}`)
        if (raw === null) return []
        const value = parseFloat(String(raw))
        if (!Number.isFinite(value)) return []
        nextDrivers[key] = value
        return [db.planDriver.upsert({ where: { key }, create: { key, value }, update: { value } })]
      }),
    )

    // Push the projection into MonthlyTarget so the dashboard breakeven widget tracks it
    const next = buildPlanProjection(nextDrivers, start, end)
    await db.$transaction(
      next.monthlyRevCost.map(({ month, revenue, cost }) =>
        db.monthlyTarget.upsert({
          where: { month },
          create: { month, revenueTarget: revenue, costBudget: cost },
          update: { revenueTarget: revenue, costBudget: cost },
        }),
      ),
    )
    revalidatePath('/plan')
    revalidatePath('/')
  }

  const rm = (v: number) =>
    v < 0 ? `(RM ${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
      : `RM ${v.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Financial Plan
          </h1>
          <p className="text-sm cd-muted">
            A driver-based projection: set the assumptions below and every income-statement line is estimated across the plan.
            Compare it against reality on the <Link href="/finance/income-statement" className="cd-link">Income Statement</Link>.
          </p>
        </div>
      </div>

      <form action={savePlan} className="space-y-6">
        {/* Horizon */}
        <div className="cd-card p-5">
          <h2 className="font-semibold mb-4" style={{ color: '#2D1907' }}>Plan Horizon</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
            <div>
              <label className="cd-label">Plan start (month)</label>
              <input name="startMonth" type="month" required defaultValue={startMonth} className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Target breakeven (month)</label>
              <input name="breakevenMonth" type="month" required defaultValue={breakevenMonth} className="cd-input" />
            </div>
          </div>
          <p className="text-xs cd-muted mt-2">
            {proj.months.length} months · utilization ramps {drivers['util.startPct']}% → {drivers['util.endPct']}% across the plan.
          </p>
        </div>

        {/* Assumptions */}
        <div className="cd-card p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold" style={{ color: '#2D1907' }}>Assumptions</h2>
            <SubmitButton className="cd-btn text-sm" busyLabel="Working…">Save &amp; recalculate</SubmitButton>
          </div>
          {DRIVER_GROUPS.map(group => (
            <div key={group.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: seg.text, letterSpacing: '0.08em' }}>
                {group.title}
                {group.hint && <span className="cd-muted font-normal normal-case tracking-normal ml-2">· {group.hint}</span>}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {group.keys.map(k => (
                  <div key={k.key}>
                    <label className="cd-label">{k.label}{k.unit ? ` (${k.unit})` : ''}</label>
                    <input name={`d_${k.key}`} type="number" step="any" min="0"
                      defaultValue={drivers[k.key] ?? 0} className="cd-input" style={{ padding: '0.4rem 0.6rem' }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs cd-muted">
            Boarding = rooms × price × operating days × utilization. Grooming = stations × sessions × days × price × utilization.
            Other revenue and variable costs are entered at full capacity and scale with the ramp; fixed costs stay flat.
            Room count defaults from your {roomCount} active boarding rooms.
          </p>
        </div>
      </form>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Projected revenue" value={rm(proj.totals.revenue)} />
        <SummaryCard label="Projected cost" value={rm(proj.totals.cost)} />
        <SummaryCard label="Net over plan" value={rm(proj.totals.net)} accent={proj.totals.net >= 0 ? '#5c6b3c' : '#B14919'} />
        <SummaryCard label="Breakeven month"
          value={proj.breakevenMonth ? monthLabel(proj.breakevenMonth) : 'Not within plan'}
          accent={proj.breakevenMonth ? '#2D1907' : '#B14919'} />
      </div>

      {/* Smart recommendation + scenario analysis */}
      <ScenarioAnalysis
        drivers={drivers}
        startMonth={startMonth}
        endMonth={breakevenMonth}
        actual={actual}
        plannedElapsed={plannedElapsed}
      />

      {/* Projected P&L — annual columns */}
      <div className="cd-card overflow-x-auto">
        <table className="text-sm w-full" style={{ borderCollapse: 'collapse', minWidth: '40rem' }}>
          <thead>
            <tr className="cd-thead">
              <th style={{ position: 'sticky', left: 0, background: '#ECDBB6' }}>Projected P&amp;L (RM)</th>
              {proj.years.map(y => (
                <th key={y.year} className="text-right px-3">
                  {y.year}
                  <div className="text-[10px] font-normal cd-muted">avg {y.avgUtilPct}% util</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="cd-tbody">
            <PlanRow label="Revenue" years={proj.years} pick={y => y.revenue} bold />
            <PlanRow label="Cost of Services" years={proj.years} pick={y => y.cogs} />
            <PlanRow label="Gross Profit" years={proj.years} pick={y => y.grossProfit} bold topRule />
            <PlanRow label="Operating Expenses" years={proj.years} pick={y => y.opex} />
            <PlanRow label="EBITDA" years={proj.years} pick={y => y.ebitda} bold topRule />
            <PlanRow label="Tax" years={proj.years} pick={y => y.tax} />
            <PlanRow label="Net Income" years={proj.years} pick={y => y.net} bold topRule />
          </tbody>
        </table>
      </div>

      <p className="text-xs cd-muted">
        Saving writes each month&apos;s projected revenue and cost into the dashboard breakeven tracker.
        This plan is an estimate — the <Link href="/finance/income-statement" className="cd-link">Income Statement</Link> shows
        what actually happened, with an Actuals-vs-Plan comparison.
      </p>
    </div>
  )
}

function PlanRow({ label, years, pick, bold, topRule }: {
  label: string
  years: import('@/lib/plan-model').PlanYear[]
  pick: (y: import('@/lib/plan-model').PlanYear) => number
  bold?: boolean
  topRule?: boolean
}) {
  const fmt = (v: number) =>
    v < 0 ? `(${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})`
      : v === 0 ? '–'
      : v.toLocaleString('en-MY', { maximumFractionDigits: 0 })
  return (
    <tr style={topRule ? { borderTop: '2px solid rgba(45,25,7,0.25)' } : undefined}>
      <td className="px-4 py-2 whitespace-nowrap" style={{ color: '#2D1907', fontWeight: bold ? 700 : 400, position: 'sticky', left: 0, background: '#F2EDE0' }}>
        {label}
      </td>
      {years.map(y => {
        const v = pick(y)
        return (
          <td key={y.year} className="px-3 py-2 text-right tabular-nums"
            style={{ color: v < 0 ? '#B14919' : bold ? '#2D1907' : 'rgba(45,25,7,0.75)', fontWeight: bold ? 700 : 400 }}>
            {fmt(v)}
          </td>
        )
      })}
    </tr>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={{ color: accent ?? '#2D1907' }}>{value}</div>
    </div>
  )
}
