import { db } from './db'
import { getConfig } from './config'
import { zonedDayKey, zonedDayRange } from './timezone'
import { logRedFlags } from './care-log'
import { RESIDENCY_TYPE, CARE_LATE_HOUR } from './constants'

// The Boarding Wall — the cabinet elevation, read from data.
//
// One question, answered for one day: what is in each unit, and is anything
// wrong with it. The geometry (which zone, which cell, how many cells) lives on
// Room; this module only decides what colour the glass is and which single
// badge, if any, the unit carries.

export type WallStatus = 'Occupied' | 'Available' | 'Cleaning' | 'Maintenance'
/** At most one, in this priority order — see `badgeFor`. */
export type WallBadge = 'Health' | 'Out' | 'Late' | 'In' | null

export interface WallRoom {
  id: string
  name: string
  zoneId: string | null
  col: number
  row: number
  colSpan: number
  rowSpan: number
  unitKind: string
  status: WallStatus
  /**
   * The room's own stored flag, before the day's occupancy overrides it.
   *
   * The list needs this and `status` separately: `status` answers "what is
   * true today", the flag answers "what was this room set to". They differ on
   * a cat sitting in a room somebody marked Cleaning, and the status buttons
   * have to reflect the flag or they would offer to set what is already set.
   */
  roomStatus: string
  type: string
  capacity: number
  description: string | null
  occupant: string | null
  catId: string | null
  appointmentId: string | null
  badge: WallBadge
  /** Today only — care progress is meaningless for a day that has not happened. */
  careDone: number
  careTotal: number
}

export interface WallZone {
  id: string
  code: string
  name: string
  kind: string
  cols: number
  rows: number
  rooms: WallRoom[]
}

export interface Wall {
  dayKey: string
  todayKey: string
  isToday: boolean
  zones: WallZone[]
  /** Rooms with no place on the wall. Shown, never hidden — see the schema comment. */
  unplaced: WallRoom[]
  /**
   * Every active room, flat, in sort order — the wall's plain-text twin.
   *
   * Deliberately the SAME objects the zones hold rather than a second query.
   * The old /rooms/list counted occupancy from `Room.status` while the wall
   * derived it from the day's stays, so the two screens could report different
   * numbers for the same morning. One source removes that by construction.
   */
  rooms: WallRoom[]
  totals: { occupied: number; available: number; cleaning: number; maintenance: number; leaving: number }
}

/**
 * One badge, chosen in priority order.
 *
 * A unit is about 116px wide and there are forty of them. Two badges on one is
 * two things nobody reads, so the order is the decision: a health flag beats a
 * departure, which beats late care, which beats an arrival.
 */
function badgeFor(o: {
  flagged: boolean; leaving: boolean; arriving: boolean
  careDone: number; careTotal: number; isToday: boolean; hour: number
}): WallBadge {
  if (o.flagged) return 'Health'
  if (o.leaving) return 'Out'
  if (o.isToday && o.hour >= CARE_LATE_HOUR && o.careTotal > 0 && o.careDone < o.careTotal) return 'Late'
  if (o.arriving) return 'In'
  return null
}

export async function buildWall(dayKeyInput?: string): Promise<Wall> {
  const { timezone } = await getConfig()
  const now = new Date()
  const todayKey = zonedDayKey(now, timezone)
  const dayKey = dayKeyInput ?? todayKey
  const isToday = dayKey === todayKey
  const { start, end } = zonedDayRange(dayKey, timezone)

  const [zones, rooms, stays, tasks, logs] = await Promise.all([
    db.roomZone.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.room.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, status: true, zoneId: true, type: true, capacity: true, description: true,
        gridCol: true, gridRow: true, colSpan: true, rowSpan: true, unitKind: true, sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    // Everything in a room on this day: paying stays and house residencies alike.
    // A residency has no end, hence the null branch.
    db.appointment.findMany({
      where: {
        type: { in: ['Boarding', RESIDENCY_TYPE] },
        roomId: { not: null },
        status: { notIn: ['Cancelled', 'NoShow'] },
        scheduledAt: { lt: end },
        OR: [{ endsAt: { gte: start } }, { endsAt: null }],
      },
      select: {
        id: true, roomId: true, catId: true, status: true, type: true,
        scheduledAt: true, endsAt: true,
        cat: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    isToday
      ? db.careTask.findMany({ where: { date: dayKey }, select: { appointmentId: true, done: true } })
      : Promise.resolve([]),
    isToday
      ? db.dailyCareLog.findMany({ where: { date: dayKey } })
      : Promise.resolve([]),
  ])

  const stayByRoom = new Map<string, (typeof stays)[number]>()
  for (const s of stays) {
    // First stay wins; a room holding two overlapping bookings is a data problem
    // the calendar surfaces, not something the wall should try to render twice.
    if (s.roomId && !stayByRoom.has(s.roomId)) stayByRoom.set(s.roomId, s)
  }

  const careByAppt = new Map<string, { done: number; total: number }>()
  for (const t of tasks) {
    const e = careByAppt.get(t.appointmentId) ?? { done: 0, total: 0 }
    e.total++
    if (t.done) e.done++
    careByAppt.set(t.appointmentId, e)
  }

  const flaggedAppts = new Set<string>()
  for (const l of logs) {
    if (logRedFlags(l).length > 0) flaggedAppts.add(l.appointmentId)
  }

  const hour = Number(now.toLocaleString('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }))

  const toWallRoom = (r: (typeof rooms)[number]): WallRoom => {
    const stay = r.id ? stayByRoom.get(r.id) : undefined
    const care = stay ? careByAppt.get(stay.id) : undefined

    // A room's own `status` is a standing fact (being cleaned, out of service).
    // Occupancy is a fact about the DAY. Occupancy wins — a cat in a room marked
    // "Cleaning" is still a cat in that room, and hiding that would be the
    // dangerous direction.
    let status: WallStatus = 'Available'
    if (stay) status = 'Occupied'
    else if (r.status === 'Cleaning' || r.status === 'Maintenance') status = r.status

    const leaving = !!stay?.endsAt && zonedDayKey(stay.endsAt, timezone) === dayKey
    const arriving = !!stay && zonedDayKey(stay.scheduledAt, timezone) === dayKey && stay.status === 'Scheduled'

    return {
      id: r.id,
      name: r.name,
      zoneId: r.zoneId,
      col: r.gridCol ?? 0,
      row: r.gridRow ?? 0,
      colSpan: r.colSpan ?? 1,
      rowSpan: r.rowSpan ?? 1,
      unitKind: r.unitKind ?? 'arch',
      status,
      roomStatus: r.status,
      type: r.type,
      capacity: r.capacity,
      description: r.description,
      occupant: stay?.cat.name ?? null,
      catId: stay?.catId ?? null,
      appointmentId: stay?.id ?? null,
      badge: badgeFor({
        flagged: !!stay && flaggedAppts.has(stay.id),
        leaving,
        arriving,
        careDone: care?.done ?? 0,
        careTotal: care?.total ?? 0,
        isToday,
        hour,
      }),
      careDone: care?.done ?? 0,
      careTotal: care?.total ?? 0,
    }
  }

  const byZone = new Map<string, WallRoom[]>()
  const unplaced: WallRoom[] = []
  const all: WallRoom[] = []
  for (const r of rooms) {
    const w = toWallRoom(r)
    all.push(w)
    // A room only has a place if it has BOTH a zone and a cell. Half-placed is
    // unplaced — it must still appear somewhere.
    if (w.zoneId && w.col > 0 && w.row > 0) {
      const list = byZone.get(w.zoneId) ?? []
      list.push(w)
      byZone.set(w.zoneId, list)
    } else {
      unplaced.push(w)
    }
  }

  const totals = { occupied: 0, available: 0, cleaning: 0, maintenance: 0, leaving: 0 }
  const wallZones: WallZone[] = zones.map(z => {
    const zr = (byZone.get(z.id) ?? []).sort((a, b) => a.row - b.row || a.col - b.col)
    for (const r of zr) {
      if (r.badge === 'Out') totals.leaving++
      // Staging cubbies are not bookable capacity, so counting one as "free"
      // would offer a room that does not exist.
      if (z.kind === 'Staging') continue
      if (r.status === 'Occupied') totals.occupied++
      else if (r.status === 'Cleaning') totals.cleaning++
      else if (r.status === 'Maintenance') totals.maintenance++
      else totals.available++
    }
    return { id: z.id, code: z.code, name: z.name, kind: z.kind, cols: z.cols, rows: z.rows, rooms: zr }
  })
  for (const r of unplaced) {
    if (r.badge === 'Out') totals.leaving++
    if (r.status === 'Occupied') totals.occupied++
    else if (r.status === 'Cleaning') totals.cleaning++
    else if (r.status === 'Maintenance') totals.maintenance++
    else totals.available++
  }

  return { dayKey, todayKey, isToday, zones: wallZones, unplaced, rooms: all, totals }
}

/** The next `count` days from today, for the date strip. */
export async function wallDays(count = 14): Promise<{ key: string; dow: string; dom: string }[]> {
  const { timezone } = await getConfig()
  const todayKey = zonedDayKey(new Date(), timezone)
  const [y, m, d] = todayKey.split('-').map(Number)
  const out: { key: string; dow: string; dom: string }[] = []
  for (let i = 0; i < count; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i))
    const key = day.toISOString().slice(0, 10)
    out.push({
      key,
      dow: i === 0 ? 'Today' : day.toLocaleDateString('en-MY', { weekday: 'short', timeZone: 'UTC' }),
      dom: String(day.getUTCDate()),
    })
  }
  return out
}
