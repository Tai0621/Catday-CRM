import { db } from '../db'
import { getConfig } from '../config'
import { lowStockProducts } from '../inventory'
import { buildActionQueue } from '../actions'
import { zonedDayKey, zonedDayRange, shiftDayKey } from '../timezone'
import { REVENUE_CATEGORIES } from '../constants'

// ── C5 · Yesterday, as facts ─────────────────────────────────────────────────
//
// Every number here is COMPUTED, by the same read-only builders the pages use.
// The model's job in C5 is to narrate this object and nothing else — it is
// never asked what the revenue was, only what to make of it. A brief that can
// hallucinate a figure is worse than no brief, because it is read at 8am by
// someone who will act on it.
//
// The whole object is stored alongside the narration, so a brief can be
// audited months later against data that has since moved on.

const round = (n: number) => Math.round(n * 100) / 100

/** How many prior same-weekdays form the comparison. */
const BASELINE_WEEKS = 4

export interface BriefFacts {
  date: string
  weekday: string
  revenue: {
    total: number
    byStream: { category: string; total: number }[]
    /** Mean takings on the same weekday over the previous BASELINE_WEEKS. */
    baseline: number
    baselineWeeks: number
    deltaPct: number | null
  }
  visits: { completed: number; noShows: number; cancelled: number; booked: number }
  boarding: { catsIn: number; roomsOccupied: number; totalRooms: number; occupancyPct: number }
  customers: { new: number; served: number }
  money: {
    monthToDate: number
    monthTarget: number | null
    monthPacePct: number | null
    receivable: number
    payable: number
  }
  lowStock: { name: string; stockQty: number; reorderLevel: number }[]
  staffHours: { name: string; hours: number }[]
  openActions: { title: string; reason: string; href: string | null }[]
}

export async function buildBriefFacts(dayKey: string): Promise<BriefFacts> {
  const { timezone } = await getConfig()
  const { start, end } = zonedDayRange(dayKey, timezone)

  // Same weekday, previous four weeks — the only comparison that means anything
  // for a business whose Saturday is nothing like its Tuesday. A day-on-day or
  // a flat 30-day mean would make every weekend look like a triumph.
  const baselineRanges = Array.from({ length: BASELINE_WEEKS }, (_, i) =>
    zonedDayRange(shiftDayKey(dayKey, -7 * (i + 1)), timezone))

  const monthKey = dayKey.slice(0, 7)
  const monthStart = zonedDayRange(`${monthKey}-01`, timezone).start

  const [
    byCategory, baselineTotals, appts, boardingIn, rooms, newCustomers,
    monthAgg, target, receivables, payables, lowStock, timeEntries, queue,
  ] = await Promise.all([
    db.transaction.groupBy({ by: ['category'], where: { date: { gte: start, lt: end } }, _sum: { total: true } }),
    Promise.all(baselineRanges.map(r =>
      db.transaction.aggregate({ where: { date: { gte: r.start, lt: r.end } }, _sum: { total: true } }))),
    db.appointment.findMany({
      where: { scheduledAt: { gte: start, lt: end } },
      select: { status: true, customerId: true },
    }),
    // Boarding stays that covered any part of the day, not just ones starting in it.
    db.appointment.count({
      where: {
        type: 'Boarding', status: { notIn: ['Cancelled', 'NoShow'] },
        scheduledAt: { lt: end }, OR: [{ endsAt: { gt: start } }, { endsAt: null }],
      },
    }),
    db.appointment.findMany({
      where: {
        roomId: { not: null }, status: { notIn: ['Cancelled', 'NoShow'] },
        scheduledAt: { lt: end }, OR: [{ endsAt: { gt: start } }, { endsAt: null }],
      },
      select: { roomId: true },
    }),
    db.customer.count({ where: { createdAt: { gte: start, lt: end }, erasedAt: null } }),
    db.transaction.aggregate({ where: { date: { gte: monthStart, lt: end } }, _sum: { total: true } }),
    db.monthlyTarget.findUnique({ where: { month: monthKey }, select: { revenueTarget: true } }),
    db.appointment.aggregate({
      where: { status: 'Completed', paid: false, scheduledAt: { lt: end } },
      _sum: { price: true },
    }),
    db.expense.aggregate({ where: { paid: false }, _sum: { amount: true } }),
    lowStockProducts(),
    db.timeEntry.findMany({
      where: { clockInAt: { gte: start, lt: end }, clockOutAt: { not: null } },
      select: { clockInAt: true, clockOutAt: true, staff: { select: { name: true } } },
    }),
    buildActionQueue(),
  ])

  const streamMap: Record<string, number> = Object.fromEntries(REVENUE_CATEGORIES.map(c => [c, 0]))
  for (const g of byCategory) {
    const key = (REVENUE_CATEGORIES as readonly string[]).includes(g.category) ? g.category : 'Other'
    streamMap[key] += g._sum.total ?? 0
  }
  const total = round(Object.values(streamMap).reduce((s, v) => s + v, 0))

  const baselineValues = baselineTotals.map(b => b._sum.total ?? 0)
  const baseline = round(baselineValues.reduce((s, v) => s + v, 0) / (baselineValues.length || 1))

  const totalRooms = await db.room.count({ where: { isActive: true } })
  const roomsOccupied = new Set(rooms.map(r => r.roomId)).size

  const hoursByStaff = new Map<string, number>()
  for (const e of timeEntries) {
    const hours = (e.clockOutAt!.getTime() - e.clockInAt.getTime()) / 3600000
    const name = e.staff.name
    hoursByStaff.set(name, (hoursByStaff.get(name) ?? 0) + hours)
  }

  const monthToDate = round(monthAgg._sum.total ?? 0)
  const monthTarget = target?.revenueTarget ?? null

  return {
    date: dayKey,
    weekday: new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('en-MY', { weekday: 'long', timeZone: 'UTC' }),
    revenue: {
      total,
      byStream: Object.entries(streamMap).filter(([, v]) => v > 0).map(([category, v]) => ({ category, total: round(v) })),
      baseline,
      baselineWeeks: BASELINE_WEEKS,
      deltaPct: baseline > 0 ? Math.round(((total - baseline) / baseline) * 100) : null,
    },
    visits: {
      completed: appts.filter(a => a.status === 'Completed').length,
      noShows: appts.filter(a => a.status === 'NoShow').length,
      cancelled: appts.filter(a => a.status === 'Cancelled').length,
      booked: appts.length,
    },
    boarding: {
      catsIn: boardingIn,
      roomsOccupied,
      totalRooms,
      occupancyPct: totalRooms > 0 ? Math.round((roomsOccupied / totalRooms) * 100) : 0,
    },
    customers: { new: newCustomers, served: new Set(appts.map(a => a.customerId)).size },
    money: {
      monthToDate,
      monthTarget,
      monthPacePct: monthTarget && monthTarget > 0 ? Math.round((monthToDate / monthTarget) * 100) : null,
      receivable: round(receivables._sum.price ?? 0),
      payable: round(payables._sum.amount ?? 0),
    },
    lowStock: lowStock.slice(0, 8).map(p => ({ name: p.name, stockQty: p.stockQty, reorderLevel: p.reorderLevel ?? 0 })),
    staffHours: [...hoursByStaff.entries()].map(([name, h]) => ({ name, hours: Math.round(h * 10) / 10 })),
    // Only the urgent band: a brief that lists forty opportunities is a list, not a brief.
    openActions: queue.filter(a => a.band === 'Do now').slice(0, 8)
      .map(a => ({ title: a.title, reason: a.reason, href: a.href ?? null })),
  }
}

/** The day the brief is about: the local calendar day that has just finished. */
export function briefDayKey(now: Date, timezone: string): string {
  return shiftDayKey(zonedDayKey(now, timezone), -1)
}
