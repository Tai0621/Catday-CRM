import { REVENUE_CATEGORIES } from './constants'
import { COGS_CATEGORIES, OPEX_CATEGORIES } from './finance'
import { monthsBetween } from './plan'

// Driver-based financial projection: capacity × price × a utilization ramp
// drives boarding & grooming revenue; other streams + variable costs scale
// with the same ramp; fixed opex is flat. Mirrors the owner's Excel model,
// but every lever is editable in the app.

// Boarding & grooming are capacity-driven; the rest are entered as a monthly
// figure "at full capacity" that scales with the utilization ramp.
export const CAPACITY_STREAMS = new Set(['Boarding', 'Grooming'])
// Streams entered as a flat "at full capacity" monthly figure
export const FLAT_REV_STREAMS = REVENUE_CATEGORIES.filter(c => !CAPACITY_STREAMS.has(c))

export type PlanDrivers = Record<string, number>

export function defaultDrivers(boardingRooms = 50): PlanDrivers {
  return {
    'cap.boardingRooms': boardingRooms,
    'cap.boardingPrice': 88,
    'cap.operatingDays': 30,
    'cap.groomingStations': 3,
    'cap.groomingSessionsPerDay': 4,
    'cap.groomingPrice': 128,
    'util.startPct': 5,
    'util.endPct': 35,
    // Non-capacity revenue, monthly at 100% utilization
    'rev.Retail': 0,
    'rev.Membership': 14143,
    'rev.Academy': 15000,
    'rev.Other': 7500,
    // Variable costs, monthly at 100% utilization
    'cogs.Grooming Supplies': 6000,
    'cogs.Food & Litter': 24000,
    'cogs.Vet Visit': 8400,
    'cogs.Retail Stock': 0,
    // Fixed monthly operating expenses
    'opex.Rent': 17000,
    'opex.Salaries': 20800,
    'opex.Cleaning Supplies': 850,
    'opex.Utilities': 4000,
    'opex.Marketing': 5500,
    'opex.Maintenance': 1000,
    'opex.Other Expense': 0,
    'tax.ratePct': 24,
  }
}

// Every driver key, grouped for the form
export const DRIVER_GROUPS: { title: string; hint?: string; keys: { key: string; label: string; unit?: string }[] }[] = [
  {
    title: 'Capacity & Pricing',
    hint: 'Boarding and grooming revenue are computed from these.',
    keys: [
      { key: 'cap.boardingRooms', label: 'Boarding rooms', unit: 'rooms' },
      { key: 'cap.boardingPrice', label: 'Price / night', unit: 'RM' },
      { key: 'cap.groomingStations', label: 'Grooming stations', unit: 'stations' },
      { key: 'cap.groomingSessionsPerDay', label: 'Sessions / station / day', unit: '' },
      { key: 'cap.groomingPrice', label: 'Price / session', unit: 'RM' },
      { key: 'cap.operatingDays', label: 'Operating days / month', unit: 'days' },
    ],
  },
  {
    title: 'Utilization Ramp',
    hint: 'How full the business is — ramps linearly from start to end across the plan.',
    keys: [
      { key: 'util.startPct', label: 'Starting utilization', unit: '%' },
      { key: 'util.endPct', label: 'Ending utilization', unit: '%' },
    ],
  },
  {
    title: 'Other Revenue — monthly at full capacity',
    hint: 'Scales with the utilization ramp.',
    keys: FLAT_REV_STREAMS.map(c => ({ key: `rev.${c}`, label: c, unit: 'RM' })),
  },
  {
    title: 'Variable Costs — monthly at full capacity',
    hint: 'Cost of services; scales with utilization.',
    keys: COGS_CATEGORIES.map(c => ({ key: `cogs.${c}`, label: c, unit: 'RM' })),
  },
  {
    title: 'Fixed Costs — monthly',
    hint: 'Operating expenses; the same every month.',
    keys: OPEX_CATEGORIES.map(c => ({ key: `opex.${c}`, label: c, unit: 'RM' })),
  },
  {
    title: 'Tax',
    keys: [{ key: 'tax.ratePct', label: 'Corporate tax rate', unit: '%' }],
  },
]

export const ALL_DRIVER_KEYS = DRIVER_GROUPS.flatMap(g => g.keys.map(k => k.key))

export type PlanLine = { label: string; values: number[] }
export type PlanYear = {
  year: number
  months: number
  avgUtilPct: number
  revenue: number
  cogs: number
  grossProfit: number
  opex: number
  ebitda: number
  tax: number
  net: number
}
export interface PlanProjection {
  months: string[]              // YYYY-MM
  utilPct: number[]             // per month, %
  revenue: PlanLine[]
  cogs: PlanLine[]
  opex: PlanLine[]
  totalRevenue: number[]
  totalCogs: number[]
  grossProfit: number[]
  totalOpex: number[]
  ebitda: number[]
  tax: number[]
  netIncome: number[]
  cumulativeNet: number[]
  monthlyRevCost: { month: string; revenue: number; cost: number }[] // write-through to targets
  years: PlanYear[]
  breakevenMonth: string | null
  totals: { revenue: number; cost: number; net: number }
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function buildPlanProjection(drivers: PlanDrivers, startMonth: string, endMonth: string): PlanProjection {
  const d = (k: string) => drivers[k] ?? 0
  const months = monthsBetween(startMonth, endMonth)
  const N = months.length || 1

  const startU = d('util.startPct') / 100
  const endU = d('util.endPct') / 100
  const utilFrac = months.map((_, m) => (N <= 1 ? endU : startU + (endU - startU) * (m / (N - 1))))
  const utilPct = utilFrac.map(u => Math.round(u * 1000) / 10)

  const boardingFull = d('cap.boardingRooms') * d('cap.boardingPrice') * d('cap.operatingDays')
  const groomingFull = d('cap.groomingStations') * d('cap.groomingSessionsPerDay') * d('cap.operatingDays') * d('cap.groomingPrice')
  const taxRate = d('tax.ratePct') / 100

  const revLine = (stream: string): PlanLine => {
    const full = stream === 'Boarding' ? boardingFull : stream === 'Grooming' ? groomingFull : d(`rev.${stream}`)
    return { label: stream === 'Boarding' || stream === 'Grooming' ? `${stream} Revenue` : `${stream} Revenue`, values: utilFrac.map(u => r2(full * u)) }
  }
  const revenue = REVENUE_CATEGORIES.map(revLine)
  const cogs = COGS_CATEGORIES.map(c => ({ label: c, values: utilFrac.map(u => r2(d(`cogs.${c}`) * u)) }))
  const opex = OPEX_CATEGORIES.map(c => ({ label: c, values: months.map(() => r2(d(`opex.${c}`))) }))

  const sumAt = (lines: PlanLine[], m: number) => r2(lines.reduce((s, l) => s + l.values[m], 0))
  const totalRevenue = months.map((_, m) => sumAt(revenue, m))
  const totalCogs = months.map((_, m) => sumAt(cogs, m))
  const grossProfit = months.map((_, m) => r2(totalRevenue[m] - totalCogs[m]))
  const totalOpex = months.map((_, m) => sumAt(opex, m))
  const ebitda = months.map((_, m) => r2(grossProfit[m] - totalOpex[m]))
  const tax = ebitda.map(v => (v > 0 ? r2(v * taxRate) : 0))
  const netIncome = months.map((_, m) => r2(ebitda[m] - tax[m]))

  const cumulativeNet: number[] = []
  let breakevenMonth: string | null = null
  netIncome.reduce((acc, v, i) => {
    const c = r2(acc + v)
    cumulativeNet[i] = c
    if (breakevenMonth === null && c >= 0) breakevenMonth = months[i]
    return c
  }, 0)

  const monthlyRevCost = months.map((month, m) => ({ month, revenue: totalRevenue[m], cost: r2(totalCogs[m] + totalOpex[m]) }))

  // Annual roll-up
  const yearMap = new Map<number, PlanYear>()
  months.forEach((mk, m) => {
    const y = Number(mk.slice(0, 4))
    if (!yearMap.has(y)) yearMap.set(y, { year: y, months: 0, avgUtilPct: 0, revenue: 0, cogs: 0, grossProfit: 0, opex: 0, ebitda: 0, tax: 0, net: 0 })
    const yr = yearMap.get(y)!
    yr.months++
    yr.avgUtilPct += utilPct[m]
    yr.revenue += totalRevenue[m]
    yr.cogs += totalCogs[m]
    yr.grossProfit += grossProfit[m]
    yr.opex += totalOpex[m]
    yr.ebitda += ebitda[m]
    yr.tax += tax[m]
    yr.net += netIncome[m]
  })
  const years = [...yearMap.values()].map(y => ({
    ...y,
    avgUtilPct: Math.round((y.avgUtilPct / y.months) * 10) / 10,
    revenue: r2(y.revenue), cogs: r2(y.cogs), grossProfit: r2(y.grossProfit),
    opex: r2(y.opex), ebitda: r2(y.ebitda), tax: r2(y.tax), net: r2(y.net),
  }))

  const totalRev = r2(totalRevenue.reduce((s, v) => s + v, 0))
  const totalCost = r2(totalCogs.reduce((s, v) => s + v, 0) + totalOpex.reduce((s, v) => s + v, 0))

  return {
    months, utilPct,
    revenue, cogs, opex,
    totalRevenue, totalCogs, grossProfit, totalOpex, ebitda, tax, netIncome, cumulativeNet,
    monthlyRevCost, years, breakevenMonth,
    totals: { revenue: totalRev, cost: totalCost, net: r2(totalRev - totalCost) },
  }
}
