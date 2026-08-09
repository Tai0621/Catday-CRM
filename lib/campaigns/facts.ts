import { db } from '../db'
import { getConfig } from '../config'
import { groomerCapacity } from '../slots'
import { getCommissionDefault, resolveRate } from '../commission'
// The pure arithmetic lives on its own so it can be exercised without a database.
import { offerEconomics, type DayLoad, type ServiceMargin } from './economics'
export { offerEconomics, CANNIBALISATION_THRESHOLD_PCT } from './economics'
export type { DayLoad, ServiceMargin, OfferEconomics } from './economics'

// ── M1 · What a campaign is allowed to know ──────────────────────────────────
//
// Two things constrain an offer here that a generic promotion builder has no
// concept of: OPEN CAPACITY and TRUE MARGIN. Discounting a Saturday that is
// already full is giving money away; discounting a service whose margin cannot
// carry it is worse.
//
// Both are computed. The model receives them and proposes structures; it never
// works out what anything costs.
//
// One deliberate absence: there is NO projected revenue and NO expected uptake.
// A forecast needs a conversion rate nobody has measured yet, and inventing one
// would produce a confident number the owner would plan against. Instead this
// reports margin PER BOOKING at the proposed discount and the number of bookings
// needed to cover the messaging spend — both facts, and both enough to decide.

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const r2 = (n: number) => Math.round(n * 100) / 100

export interface CampaignFacts {
  window: { from: string; to: string; days: number }
  /** Averaged per weekday across the window — the shape of a normal week. */
  byWeekday: DayLoad[]
  slackestWeekdays: string[]
  busiestWeekdays: string[]
  services: ServiceMargin[]
  audiences: { key: string; name: string; size: number; sendable: number }[]
  messageCostRM: number
  note: string
}

/**
 * Load across a forward window, averaged by weekday.
 *
 * Forward-looking on purpose: a campaign fills slots that are still open, and
 * last month's utilisation says nothing about whether next Tuesday is free.
 */
export async function campaignFacts(
  fromISO: string,
  toISO: string,
  audiences: { key: string; name: string; size: number; sendable: number }[],
): Promise<CampaignFacts> {
  const from = new Date(`${fromISO}T00:00:00`)
  const to = new Date(`${toISO}T00:00:00`)
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY))

  const [config, capacity, rooms, appointments, services, commissionDefault, staff] = await Promise.all([
    getConfig(),
    groomerCapacity(),
    db.room.count({ where: { isActive: true } }),
    db.appointment.findMany({
      where: { scheduledAt: { gte: from, lt: to }, status: { notIn: ['Cancelled', 'NoShow'] } },
      select: { type: true, scheduledAt: true, endsAt: true, serviceId: true },
    }),
    db.service.findMany({
      where: { active: true },
      select: { id: true, name: true, category: true, price: true, durationMin: true, commissionRatePct: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    getCommissionDefault(),
    db.staff.findMany({ where: { active: true, role: 'Groomer' }, select: { commissionRatePct: true } }),
  ])

  const { openHour, closeHour } = config.ops
  const groomHours = Math.max(0, closeHour - openHour)

  // Buckets keyed by weekday index.
  const groomBooked = new Array(7).fill(0)
  const roomNights = new Array(7).fill(0)
  const dayCount = new Array(7).fill(0)
  for (let d = new Date(from); d < to; d = new Date(d.getTime() + DAY)) dayCount[d.getDay()]++

  for (const a of appointments) {
    const wd = a.scheduledAt.getDay()
    if (a.type === 'Boarding') {
      const end = a.endsAt ?? new Date(a.scheduledAt.getTime() + DAY)
      // Nights are attributed to each night's own weekday, not the check-in day.
      for (let d = new Date(a.scheduledAt); d < end; d = new Date(d.getTime() + DAY)) {
        if (d >= from && d < to) roomNights[d.getDay()]++
      }
    } else {
      groomBooked[wd]++
    }
  }

  // A day's grooming capacity: hours open × groomers, at a nominal hour a groom.
  const dailyGroomSlots = Math.max(1, Math.round(groomHours * capacity))

  const byWeekday: DayLoad[] = WEEKDAYS.map((weekday, i) => {
    const occurrences = Math.max(1, dayCount[i])
    const booked = r2(groomBooked[i] / occurrences)
    const sold = r2(roomNights[i] / occurrences)
    return {
      weekday,
      groomBooked: booked,
      groomCapacity: dailyGroomSlots,
      groomUtilisationPct: Math.round((booked / dailyGroomSlots) * 1000) / 10,
      roomNightsSold: sold,
      roomNightsAvailable: rooms,
      occupancyPct: rooms > 0 ? Math.round((sold / rooms) * 1000) / 10 : 0,
    }
  })

  // Ranked on whichever side of the business is emptier that day.
  const pressure = (d: DayLoad) => Math.max(d.groomUtilisationPct, d.occupancyPct)
  const ranked = [...byWeekday].filter(d => dayCount[WEEKDAYS.indexOf(d.weekday)] > 0)
    .sort((a, b) => pressure(a) - pressure(b))

  // Groomer rates vary; the average is what a mixed week actually pays out.
  const avgStaffRate = staff.length > 0 && staff.some(s => s.commissionRatePct != null)
    ? staff.reduce((s, x) => s + (x.commissionRatePct ?? commissionDefault), 0) / staff.length
    : null

  const serviceMargins: ServiceMargin[] = services.map(s => {
    const commissionPct = resolveRate(avgStaffRate, s.commissionRatePct, commissionDefault)
    const contribution = s.price * (1 - commissionPct / 100)
    return {
      id: s.id, name: s.name, category: s.category, price: r2(s.price),
      commissionPct: r2(commissionPct),
      contributionRM: r2(contribution),
      contributionPct: s.price > 0 ? Math.round((contribution / s.price) * 1000) / 10 : 0,
    }
  })

  return {
    window: { from: fromISO, to: toISO, days },
    byWeekday,
    slackestWeekdays: ranked.slice(0, 3).map(d => d.weekday),
    busiestWeekdays: ranked.slice(-2).reverse().map(d => d.weekday),
    services: serviceMargins,
    audiences,
    messageCostRM: config.marketing.messageCostRM,
    note: 'Contribution is price less groomer commission — the OS does not model per-service consumable cost, so the real margin is a little lower. There is no revenue forecast here: nobody has measured a conversion rate yet, so any projection would be invented.',
  }
}
