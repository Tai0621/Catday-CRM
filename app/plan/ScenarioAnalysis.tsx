'use client'

import { useMemo, useState } from 'react'
import { buildPlanProjection, solveDriverForNet, type PlanDrivers } from '@/lib/plan-model'
import { monthLabel } from '@/lib/plan'

// Interactive scenario analysis + smart recommendation. The projection engine
// runs live in the browser, so dragging a lever redraws the profit lines
// instantly. Revenue and cost are one connected model — the recommendation
// re-solves against REAL costs pulled from the income statement.

const INK = '#2D1907'
const RUST = '#B14919'
const OLIVE = '#7A8A4F'

type Actual = { months: number; revenue: number; cost: number } | null

export function ScenarioAnalysis({ drivers, startMonth, endMonth, actual, plannedElapsed }: {
  drivers: PlanDrivers
  startMonth: string
  endMonth: string
  actual: Actual
  plannedElapsed: { revenue: number; cost: number }
}) {
  // Cost reality: how real costs so far compare to what the plan expected
  const costScale = actual && plannedElapsed.cost > 0 ? actual.cost / plannedElapsed.cost : 1
  const costVariancePct = Math.round((costScale - 1) * 100)

  // Scenario levers (start from the saved plan)
  const [utilStart, setUtilStart] = useState(drivers['util.startPct'] ?? 5)
  const [utilEnd, setUtilEnd] = useState(drivers['util.endPct'] ?? 35)
  const [boardingPrice, setBoardingPrice] = useState(drivers['cap.boardingPrice'] ?? 88)
  const [groomingPrice, setGroomingPrice] = useState(drivers['cap.groomingPrice'] ?? 128)
  const [applyRealCosts, setApplyRealCosts] = useState(true)
  const [mode, setMode] = useState<'profit' | 'revcost'>('profit')

  const scenarioDrivers: PlanDrivers = {
    ...drivers,
    'util.startPct': utilStart,
    'util.endPct': utilEnd,
    'cap.boardingPrice': boardingPrice,
    'cap.groomingPrice': groomingPrice,
  }
  const scale = applyRealCosts ? costScale : 1

  const baseline = useMemo(() => buildPlanProjection(drivers, startMonth, endMonth, 1), [drivers, startMonth, endMonth])
  const scenario = useMemo(
    () => buildPlanProjection(scenarioDrivers, startMonth, endMonth, scale),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [utilStart, utilEnd, boardingPrice, groomingPrice, scale, startMonth, endMonth],
  )

  // ── Smart recommendation, re-solved against real costs ──
  const rec = useMemo(() => buildRecommendation({ drivers, startMonth, endMonth, actual, plannedElapsed, costScale }),
    [drivers, startMonth, endMonth, actual, plannedElapsed, costScale])

  const rm0 = (v: number) => (v < 0 ? `(RM ${Math.abs(v).toLocaleString('en-MY', { maximumFractionDigits: 0 })})` : `RM ${v.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`)

  // Chart series
  const months = scenario.months
  const series = mode === 'profit'
    ? [
        { label: 'Saved plan', color: 'rgba(45,25,7,0.35)', dashed: true, values: baseline.cumulativeNet },
        { label: applyRealCosts && costScale !== 1 ? 'This scenario (real costs)' : 'This scenario', color: RUST, values: scenario.cumulativeNet },
      ]
    : [
        { label: 'Revenue / mo', color: OLIVE, values: scenario.totalRevenue },
        { label: 'Cost / mo', color: RUST, values: scenario.totalCogs.map((c, i) => c + scenario.totalOpex[i]) },
      ]

  const reset = () => {
    setUtilStart(drivers['util.startPct'] ?? 5)
    setUtilEnd(drivers['util.endPct'] ?? 35)
    setBoardingPrice(drivers['cap.boardingPrice'] ?? 88)
    setGroomingPrice(drivers['cap.groomingPrice'] ?? 128)
  }
  const dirty = utilStart !== (drivers['util.startPct'] ?? 5) || utilEnd !== (drivers['util.endPct'] ?? 35)
    || boardingPrice !== (drivers['cap.boardingPrice'] ?? 88) || groomingPrice !== (drivers['cap.groomingPrice'] ?? 128)

  return (
    <section className="cd-card p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2" style={{ color: INK }}>
            <span>✦</span> Smart Recommendation &amp; Scenario Analysis
          </h2>
          <p className="text-xs cd-muted">Drag a lever to see profit respond. Revenue and cost move together — one connected model.</p>
        </div>
      </div>

      {/* Recommendation */}
      <div className="rounded-xl px-4 py-3" style={{ background: rec.tone === 'warn' ? 'rgba(177,73,25,0.1)' : rec.tone === 'good' ? 'rgba(122,138,79,0.15)' : 'rgba(231,206,122,0.28)', border: `1px solid ${rec.tone === 'warn' ? 'rgba(177,73,25,0.3)' : rec.tone === 'good' ? 'rgba(122,138,79,0.35)' : 'rgba(231,206,122,0.55)'}` }}>
        <div className="text-sm font-semibold mb-1" style={{ color: rec.tone === 'warn' ? RUST : INK }}>{rec.headline}</div>
        <ul className="text-sm space-y-0.5" style={{ color: 'rgba(45,25,7,0.8)' }}>
          {rec.lines.map((l, i) => <li key={i}>· {l}</li>)}
        </ul>
        {rec.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2.5">
            {rec.actions.map((a, i) => (
              <button key={i} onClick={a.apply}
                className="text-xs px-2.5 py-1 rounded-lg font-medium hover:opacity-90"
                style={{ background: INK, color: '#ECDBB6' }}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lever controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Lever label="Start utilization" value={utilStart} set={setUtilStart} min={0} max={100} step={1} unit="%" />
        <Lever label="End utilization" value={utilEnd} set={setUtilEnd} min={0} max={100} step={1} unit="%" />
        <Lever label="Boarding price / night" value={boardingPrice} set={setBoardingPrice} min={0} max={400} step={1} unit="RM" />
        <Lever label="Grooming price / session" value={groomingPrice} set={setGroomingPrice} min={0} max={600} step={1} unit="RM" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {actual && costScale !== 1 && (
          <label className="flex items-center gap-1.5" style={{ color: 'rgba(45,25,7,0.7)' }}>
            <input type="checkbox" checked={applyRealCosts} onChange={e => setApplyRealCosts(e.target.checked)} />
            Model real costs ({costVariancePct >= 0 ? '+' : ''}{costVariancePct}% vs plan)
          </label>
        )}
        {dirty && <button onClick={reset} className="cd-link">↩ reset to saved plan</button>}
        <span className="ml-auto flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(45,25,7,0.15)' }}>
          {(['profit', 'revcost'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className="px-2.5 py-1"
              style={mode === m ? { background: INK, color: '#ECDBB6', fontWeight: 600 } : { color: 'rgba(45,25,7,0.55)' }}>
              {m === 'profit' ? 'Cumulative profit' : 'Revenue vs cost'}
            </button>
          ))}
        </span>
      </div>

      {/* Multiline chart */}
      <MultiLineChart months={months} series={series} zeroLine={mode === 'profit'} rm0={rm0} />

      {/* Scenario outcome */}
      <div className="grid grid-cols-3 gap-3">
        <Outcome label="Scenario net over plan" value={rm0(scenario.totals.net)} accent={scenario.totals.net >= 0 ? OLIVE : RUST} />
        <Outcome label="Breakeven month" value={scenario.breakevenMonth ? monthLabel(scenario.breakevenMonth) : 'Not within plan'} accent={scenario.breakevenMonth ? INK : RUST} />
        <Outcome label="vs saved plan"
          value={`${scenario.totals.net - baseline.totals.net >= 0 ? '+' : ''}${rm0(scenario.totals.net - baseline.totals.net)}`}
          accent={scenario.totals.net - baseline.totals.net >= 0 ? OLIVE : RUST} />
      </div>
      <p className="text-xs cd-muted">
        Scenario changes here are exploratory — they don&apos;t save. Update the assumptions above and press Save to commit a new plan.
      </p>
    </section>
  )
}

function Lever({ label, value, set, min, max, step, unit }: {
  label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; unit: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="cd-label" style={{ marginBottom: 0 }}>{label}</label>
        <span className="text-sm font-semibold tabular-nums" style={{ color: RUST }}>
          {unit === 'RM' ? 'RM ' : ''}{value}{unit === '%' ? '%' : ''}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => set(Number(e.target.value))}
        className="w-full" style={{ accentColor: RUST }} />
    </div>
  )
}

function Outcome({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(45,25,7,0.04)' }}>
      <div className="text-xs cd-muted">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: accent }}>{value}</div>
    </div>
  )
}

// ── Smart recommendation logic ──
type Rec = { tone: 'warn' | 'good' | 'neutral'; headline: string; lines: string[]; actions: { label: string; apply: () => void }[] }

function buildRecommendation({ drivers, startMonth, endMonth, actual, plannedElapsed, costScale }: {
  drivers: PlanDrivers; startMonth: string; endMonth: string
  actual: Actual; plannedElapsed: { revenue: number; cost: number }; costScale: number
}): Rec {
  const curEnd = drivers['util.endPct'] ?? 35
  const curPrice = drivers['cap.boardingPrice'] ?? 88
  const rm = (v: number) => `RM ${Math.round(v).toLocaleString('en-MY')}`

  if (!actual || actual.months === 0) {
    return {
      tone: 'neutral',
      headline: 'Waiting on real numbers',
      lines: ['Once checkouts and expenses are recorded, this recalibrates the plan to your actual costs and tells you the exact utilization or price needed to stay on track.'],
      actions: [],
    }
  }

  const actualPerMo = actual.cost / actual.months
  const plannedPerMo = plannedElapsed.cost / Math.max(1, actual.months)
  const variancePct = Math.round((costScale - 1) * 100)

  // Costs meaningfully above plan → re-solve the levers with real costs
  if (costScale > 1.02) {
    const neededEnd = solveDriverForNet(drivers, startMonth, endMonth, 'util.endPct', costScale, 0)
    const neededPrice = solveDriverForNet(drivers, startMonth, endMonth, 'cap.boardingPrice', costScale, 0)
    const lines = [
      `Real costs are running ${variancePct}% above plan — ${rm(actualPerMo)}/mo vs ${rm(plannedPerMo)}/mo budgeted.`,
    ]
    if (neededEnd != null && neededEnd > curEnd + 0.5) {
      lines.push(`To still break even, lift ending utilization from ${curEnd}% to about ${Math.ceil(neededEnd)}%.`)
    } else if (neededEnd != null) {
      lines.push(`Good news: your utilization target of ${curEnd}% still covers it.`)
    }
    if (neededPrice != null && neededPrice > curPrice + 0.5) {
      lines.push(`Or raise boarding price from ${rm(curPrice)} to about ${rm(Math.ceil(neededPrice))}/night.`)
    }
    if (neededEnd == null && neededPrice == null) {
      const gap = Math.round(actualPerMo - plannedPerMo)
      lines.push(`Even at full capacity the current cost base can’t break even — costs need trimming by about ${rm(gap)}/mo.`)
    }
    return { tone: 'warn', headline: 'Costs are outrunning the plan', lines, actions: [] }
  }

  if (costScale < 0.98) {
    return {
      tone: 'good',
      headline: 'Costs are under plan — you’re ahead',
      lines: [
        `Real costs are ${Math.abs(variancePct)}% below budget — ${rm(actualPerMo)}/mo vs ${rm(plannedPerMo)}/mo planned.`,
        `You have headroom: hold prices and reach breakeven sooner, or reinvest the saving into marketing to pull utilization up faster.`,
      ],
      actions: [],
    }
  }

  return {
    tone: 'good',
    headline: 'On plan',
    lines: [`Real costs are tracking the plan (${rm(actualPerMo)}/mo vs ${rm(plannedPerMo)}/mo). Keep utilization climbing toward ${curEnd}%.`],
    actions: [],
  }
}

// ── Inline multiline SVG chart ──
function MultiLineChart({ months, series, zeroLine, rm0 }: {
  months: string[]
  series: { label: string; color: string; values: number[]; dashed?: boolean }[]
  zeroLine: boolean
  rm0: (v: number) => string
}) {
  const W = 760, H = 260, padL = 56, padR = 14, padT = 12, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB
  const all = series.flatMap(s => s.values)
  let max = Math.max(...all, 0), min = Math.min(...all, 0)
  if (max === min) max = min + 1
  const pad = (max - min) * 0.08
  max += pad; min -= pad
  const n = months.length
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => padT + plotH - ((v - min) / (max - min)) * plotH
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => min + (max - min) * f)
  const short = (v: number) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`
  const labelEvery = Math.ceil(n / 12)

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1">
        {series.map(s => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(45,25,7,0.6)' }}>
            <span style={{ width: 14, height: 0, borderTop: `2px ${s.dashed ? 'dashed' : 'solid'} ${s.color}` }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Scenario projection" style={{ display: 'block' }}>
        {grid.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={y(v)} x2={padL + plotW} y2={y(v)} stroke="rgba(45,25,7,0.08)" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill="rgba(45,25,7,0.45)">{short(v)}</text>
          </g>
        ))}
        {zeroLine && min < 0 && max > 0 && (
          <line x1={padL} y1={y(0)} x2={padL + plotW} y2={y(0)} stroke="rgba(45,25,7,0.5)" strokeWidth={1.2} strokeDasharray="2 2" />
        )}
        {months.map((m, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={m} x={x(i)} y={H - 9} textAnchor="middle" fontSize={9} fill="rgba(45,25,7,0.45)">
            {m.slice(2).replace('-', '/')}
          </text>
        ))}
        {series.map(s => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2.5}
            strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </svg>
    </div>
  )
}
