import { db } from '../../db'
import { monthRange } from '../period'
import { groomerCapacity } from '../../slots'

// C9 · Operations & Sales. Read-only over appointments and rooms.
//
// Every rate the narrative might want to quote is computed HERE. The model is
// forbidden from doing arithmetic — and the numeric grounding check enforces
// that — so a rate it is not handed is a rate it cannot mention.

const r2 = (n: number) => Math.round(n * 100) / 100
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

export interface OperationsFacts {
  appointments: {
    total: number
    completed: number
    noShows: number
    cancelled: number
    noShowRatePct: number
    cancellationRatePct: number
    completionRatePct: number
    byType: { type: string; count: number; revenueRM: number }[]
  }
  boarding: {
    stays: number
    nightsSold: number
    averageStayNights: number
    roomNightsAvailable: number
    occupancyPct: number
    revenuePerAvailableRoomNightRM: number
  }
  grooming: {
    sessions: number
    groomerCapacityPerSlot: number
    busiestWeekday: string | null
  }
  revenueRM: number
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export async function operationsFacts(month: string): Promise<OperationsFacts> {
  const { start, end } = monthRange(month)
  const nights = Math.round((end.getTime() - start.getTime()) / 86400000)

  const [appts, rooms, capacity, boardingRevenue] = await Promise.all([
    db.appointment.findMany({
      where: { scheduledAt: { gte: start, lt: end } },
      select: { type: true, status: true, price: true, scheduledAt: true, endsAt: true, roomId: true },
    }),
    db.room.count({ where: { isActive: true } }),
    groomerCapacity(),
    db.transaction.aggregate({ where: { date: { gte: start, lt: end }, category: 'Boarding' }, _sum: { total: true } }),
  ])

  const live = appts.filter(a => a.status !== 'Cancelled' && a.status !== 'NoShow')
  const completed = appts.filter(a => a.status === 'Completed')
  const noShows = appts.filter(a => a.status === 'NoShow')
  const cancelled = appts.filter(a => a.status === 'Cancelled')

  const byTypeMap = new Map<string, { count: number; revenueRM: number }>()
  for (const a of live) {
    const e = byTypeMap.get(a.type) ?? { count: 0, revenueRM: 0 }
    e.count++
    e.revenueRM += a.price ?? 0
    byTypeMap.set(a.type, e)
  }

  // Nights are clipped to the month, so a stay spanning the month end counts
  // only the nights it actually occupied inside the period being reported.
  const stays = live.filter(a => a.type === 'Boarding')
  let nightsSold = 0
  for (const s of stays) {
    if (!s.endsAt) continue
    const from = Math.max(s.scheduledAt.getTime(), start.getTime())
    const to = Math.min(s.endsAt.getTime(), end.getTime())
    if (to > from) nightsSold += Math.max(1, Math.round((to - from) / 86400000))
  }

  const weekdayCount = new Array(7).fill(0)
  for (const a of live) weekdayCount[a.scheduledAt.getDay()]++
  const busiest = weekdayCount.some(n => n > 0)
    ? WEEKDAYS[weekdayCount.indexOf(Math.max(...weekdayCount))]
    : null

  const roomNightsAvailable = rooms * nights
  const boardingRM = r2(boardingRevenue._sum.total ?? 0)

  return {
    appointments: {
      total: appts.length,
      completed: completed.length,
      noShows: noShows.length,
      cancelled: cancelled.length,
      noShowRatePct: pct(noShows.length, appts.length),
      cancellationRatePct: pct(cancelled.length, appts.length),
      completionRatePct: pct(completed.length, appts.length),
      byType: [...byTypeMap.entries()]
        .map(([type, v]) => ({ type, count: v.count, revenueRM: r2(v.revenueRM) }))
        .sort((a, b) => b.revenueRM - a.revenueRM),
    },
    boarding: {
      stays: stays.length,
      nightsSold,
      averageStayNights: stays.length > 0 ? Math.round((nightsSold / stays.length) * 10) / 10 : 0,
      roomNightsAvailable,
      occupancyPct: pct(nightsSold, roomNightsAvailable),
      revenuePerAvailableRoomNightRM: roomNightsAvailable > 0 ? r2(boardingRM / roomNightsAvailable) : 0,
    },
    grooming: {
      sessions: live.filter(a => a.type === 'Grooming' || a.type === 'Bath').length,
      groomerCapacityPerSlot: capacity,
      busiestWeekday: busiest,
    },
    revenueRM: r2(live.reduce((s, a) => s + (a.price ?? 0), 0)),
  }
}
