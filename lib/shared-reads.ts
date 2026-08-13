import { cache } from 'react'
import { db } from './db'
import { MEMBERSHIP_EXPIRY_ALERT_DAYS } from './constants'

// Reads the dashboard needs twice.
//
// The dashboard renders two independent aggregators — getDashboardData() and
// buildActionQueue() — and they had grown to ask the database for the same
// things: every cat with its appointments, today's bookings, today's
// check-outs, unpaid visits, expiring memberships. Each of those is not one
// query but several, because Prisma loads every relation with its own
// statement.
//
// That would be a rounding error if the queries overlapped. They do not: the
// libsql adapter takes a mutex around every single statement (performIO in
// @prisma/adapter-libsql), so Promise.all buys nothing and each query on the
// page costs a full serial round trip. Asking twice therefore costs exactly
// twice — scripts/perf-rtt.mjs demonstrates it, and scripts/perf-probe.mjs
// counts what a page spends.
//
// So each read lives here once, wrapped in React's `cache`, which dedupes for
// the length of a single render. Both callers get the SUPERSET shape: where the
// two wanted different fields, ordering, or limits, this asks for the wider one
// and lets the narrower caller trim. Narrowing them again to "only what this
// caller needs" would reintroduce the second round trip to save nothing.
//
// NOTHING HERE TAKES A DATE. `cache` keys on argument identity, and two callers
// each doing `new Date()` produce different objects a millisecond apart — which
// misses the cache silently and leaves the duplicate queries in place while
// looking exactly like a fix. The window is derived internally instead, which
// also means one definition of "today" per render rather than two.

const DAY = 24 * 60 * 60 * 1000
function today() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { now, start, end: new Date(start.getTime() + DAY) }
}

/**
 * Every cat, with its owner and visit history.
 *
 * The superset is the action queue's: it adds the parasite-treatment dates and
 * the founding number the dashboard's own copy left out.
 *
 * `select` rather than a bare fetch is load-bearing — this is a whole-table
 * scan and Cat carries several free-text notes columns.
 */
export const allCatsWithVisits = cache(async () =>
  db.cat.findMany({
    select: {
      id: true, name: true, breed: true, coatType: true, groomingInterval: true,
      dateOfBirth: true, vaccinationExpiry: true, lastDewormAt: true, lastDefleaAt: true,
      foundingNumber: true, customerId: true,
      customer: { select: { id: true, name: true, phone: true } },
      appointments: { select: { scheduledAt: true, status: true, type: true } },
    },
  }))

/** Today's bookings, with the membership tier that makes an arrival a VIP. */
export const appointmentsToday = cache(async () => {
  const { start, end } = today()
  return db.appointment.findMany({
    where: { scheduledAt: { gte: start, lt: end }, status: { not: 'Cancelled' } },
    include: {
      customer: { include: { memberships: { where: { status: 'Active' }, include: { tier: true } } } },
      cat: true,
      room: true,
    },
    orderBy: { scheduledAt: 'asc' },
  })
})

/** Boarding stays ending today. */
export const checkoutsToday = cache(async () => {
  const { start, end } = today()
  return db.appointment.findMany({
    where: { type: 'Boarding', endsAt: { gte: start, lt: end }, status: { not: 'Cancelled' } },
    include: { customer: true, cat: true, room: true },
    orderBy: { endsAt: 'asc' },
  })
})

/**
 * Completed visits that were never paid for.
 *
 * Takes the larger of the two limits the callers wanted; the dashboard shows
 * ten and slices, rather than spending a second round trip on its own narrower
 * ten.
 */
export const unpaidVisits = cache(async () =>
  db.appointment.findMany({
    where: { status: 'Completed', paid: false, price: { not: null } },
    include: { customer: true, cat: true },
    orderBy: { scheduledAt: 'desc' },
    take: 25,
  }))

/** Active memberships running out inside the alert window. */
export const membershipsExpiringSoon = cache(async () => {
  const threshold = new Date(Date.now() + MEMBERSHIP_EXPIRY_ALERT_DAYS * DAY)
  return db.membership.findMany({
    where: { status: 'Active', expiryDate: { lte: threshold } },
    include: { customer: true, tier: true },
    orderBy: { expiryDate: 'asc' },
  })
})
