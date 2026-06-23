// Helpers for the breakeven / financial plan feature.

/** "YYYY-MM" key for a date. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Human label for a "YYYY-MM" key, e.g. "Jan 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })
}

/** Inclusive list of "YYYY-MM" keys from start to end. */
export function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  const out: string[] = []
  let y = sy
  let m = sm
  // guard against bad input / runaway loops (cap at 120 months)
  while ((y < ey || (y === ey && m <= em)) && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** Whole days left in the current month, including today. */
export function daysLeftInMonth(now: Date = new Date()): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0) // last day of month
  return end.getDate() - now.getDate() + 1
}

/** Weeks (rounded up, min 1) remaining in the current month. */
export function weeksLeftInMonth(now: Date = new Date()): number {
  return Math.max(1, Math.ceil(daysLeftInMonth(now) / 7))
}

export interface SalesPacing {
  targetRevenue: number
  actualRevenue: number
  remaining: number
  pct: number
  salesToClose: number | null   // null when avgSaleValue not set
  salesPerWeek: number | null
  weeksLeft: number
  onTrack: boolean
}

/**
 * Given this month's target, revenue booked so far, and the average sale value,
 * work out how many sales still need to close — overall and per remaining week.
 */
export function computePacing(
  targetRevenue: number,
  actualRevenue: number,
  avgSaleValue: number,
  now: Date = new Date(),
): SalesPacing {
  const remaining = Math.max(0, targetRevenue - actualRevenue)
  const pct = targetRevenue > 0 ? Math.min(100, Math.round((actualRevenue / targetRevenue) * 100)) : 0
  const weeksLeft = weeksLeftInMonth(now)
  const salesToClose = avgSaleValue > 0 ? Math.ceil(remaining / avgSaleValue) : null
  const salesPerWeek = salesToClose != null ? Math.ceil(salesToClose / weeksLeft) : null
  return {
    targetRevenue,
    actualRevenue,
    remaining,
    pct,
    salesToClose,
    salesPerWeek,
    weeksLeft,
    onTrack: targetRevenue > 0 && actualRevenue >= targetRevenue,
  }
}

/** First month where cumulative revenue ≥ cumulative cost (projected breakeven). */
export function projectedBreakeven(
  targets: { month: string; revenueTarget: number; costBudget: number }[],
): string | null {
  let cumRev = 0
  let cumCost = 0
  for (const t of [...targets].sort((a, b) => a.month.localeCompare(b.month))) {
    cumRev += t.revenueTarget
    cumCost += t.costBudget
    if (cumRev >= cumCost && cumCost > 0) return t.month
  }
  return null
}
