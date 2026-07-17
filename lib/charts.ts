import { db } from './db'
import { REVENUE_CATEGORIES } from './constants'

const DAY = 24 * 60 * 60 * 1000
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type MonthlyRevenuePoint = {
  key: string          // YYYY-MM
  label: string        // "Aug" (with year on January boundaries)
  total: number
  streams: Record<string, number>
}
export type DailyBookingPoint = {
  key: string          // YYYY-MM-DD
  label: string        // day-of-month
  grooming: number
  boarding: number
  other: number
  total: number
}

const streamOf = (category: string) =>
  (REVENUE_CATEGORIES as readonly string[]).includes(category) ? category : 'Other'

// Everything the dashboard charts need, computed on load (no cron, like getDashboardData).
export async function getChartData() {
  const now = new Date()

  // ── 12-month window (inclusive of current month) ──
  const first = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const monthKeys: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // ── 30-day window (inclusive of today) ──
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)

  const [txns, appts] = await Promise.all([
    db.transaction.findMany({
      where: { date: { gte: first } },
      select: { date: true, total: true, category: true },
    }),
    db.appointment.findMany({
      where: { scheduledAt: { gte: dayStart }, status: { notIn: ['Cancelled', 'NoShow'] } },
      select: { scheduledAt: true, type: true },
    }),
  ])

  // ── Monthly revenue, split by stream ──
  const blankStreams = () => Object.fromEntries(REVENUE_CATEGORIES.map(c => [c, 0])) as Record<string, number>
  const monthBuckets = new Map<string, { total: number; streams: Record<string, number> }>()
  for (const k of monthKeys) monthBuckets.set(k, { total: 0, streams: blankStreams() })
  for (const t of txns) {
    const k = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`
    const b = monthBuckets.get(k)
    if (!b) continue
    b.total += t.total
    b.streams[streamOf(t.category)] += t.total
  }
  const monthlyRevenue: MonthlyRevenuePoint[] = monthKeys.map(k => {
    const [y, m] = k.split('-').map(Number)
    const b = monthBuckets.get(k)!
    return {
      key: k,
      label: m === 1 ? `${MONTH_LABELS[0]} ’${String(y).slice(2)}` : MONTH_LABELS[m - 1],
      total: Math.round(b.total),
      streams: b.streams,
    }
  })

  // ── Daily bookings, last 30 days ──
  const dayKeys: string[] = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(dayStart.getTime() + i * DAY)
    dayKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const dayBuckets = new Map<string, DailyBookingPoint>()
  for (const k of dayKeys) {
    dayBuckets.set(k, { key: k, label: String(Number(k.slice(-2))), grooming: 0, boarding: 0, other: 0, total: 0 })
  }
  for (const a of appts) {
    const d = a.scheduledAt
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const b = dayBuckets.get(k)
    if (!b) continue
    if (a.type === 'Grooming' || a.type === 'Bath') b.grooming++
    else if (a.type === 'Boarding') b.boarding++
    else b.other++
    b.total++
  }
  const dailyBookings: DailyBookingPoint[] = dayKeys.map(k => dayBuckets.get(k)!)

  // ── This-month revenue mix (from the latest bucket) ──
  const thisMonth = monthlyRevenue[monthlyRevenue.length - 1]
  const mix = REVENUE_CATEGORIES
    .map(cat => ({ cat, value: Math.round(thisMonth.streams[cat] ?? 0) }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)

  // ── Trend: this month vs previous month ──
  const prev = monthlyRevenue[monthlyRevenue.length - 2]
  const momPct = prev && prev.total > 0
    ? Math.round(((thisMonth.total - prev.total) / prev.total) * 100)
    : null

  return { monthlyRevenue, dailyBookings, mix, momPct, bestMonth: Math.max(...monthlyRevenue.map(m => m.total)) }
}
