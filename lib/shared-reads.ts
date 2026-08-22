import { cache } from 'react'
import { db } from './db'
import { MEMBERSHIP_EXPIRY_ALERT_DAYS, RESIDENCY_TYPE } from './constants'
import { CAT_NOT_HOUSE } from './cat-stock'

// Reads the dashboard and the Action Inbox both need.
//
// Those two pages render two independent aggregators — getDashboardData() and
// buildActionQueue() — and they had grown to ask the database for the same
// things: every cat with its appointments, today's bookings, today's
// check-outs, unpaid visits, expiring memberships.
//
// That would be a rounding error if the queries overlapped. They do not: the
// libsql adapter takes a mutex around every single statement (performIO in
// @prisma/adapter-libsql), so Promise.all buys nothing and each query on the
// page costs a full serial round trip. Asking twice therefore costs exactly
// twice — scripts/perf-rtt.mjs demonstrates it, and scripts/perf-probe.mjs
// counts what a page spends.
//
// So each read lives here once, wrapped in React's `cache`, which dedupes for
// the length of a single render.
//
// ── Why there are no `include`s below ────────────────────────────────────────
//
// Prisma issues ONE STATEMENT PER RELATION. `include: { customer: { include:
// { memberships: { include: { tier } } } }, cat: true, room: true }` is not one
// query, it is six. Five aggregates each pulling their own copy of Customer is
// how a page ends up reading that table five times, which is exactly what
// scripts/perf-probe.mjs found:
//
//   /          63 queries, 5952ms   Customer ×10, Appointment ×8, Cat ×7
//   /actions   47 queries, 5211ms   Customer ×5,  Appointment ×5, Cat ×5
//
// So the entity tables are read ONCE each, into a Map, and the aggregates below
// select flat rows and stitch the relations in memory. The returned shapes are
// deliberately identical to what the `include`s produced, so callers did not
// have to change — the saving is in round trips, not in what anyone reads.
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

// ── Entity indexes: one round trip per table, for the whole render ───────────
//
// Deliberately UNFILTERED. House records are excluded by the aggregates that
// care (see NOT_HOUSE / CAT_NOT_HOUSE below), not here — an index missing a row
// that some appointment points at would stitch `undefined` into a card and
// crash the page, and the filter belongs with the rule that wants it.

const customerIndex = cache(async () => {
  const rows = await db.customer.findMany({
    select: {
      id: true, name: true, phone: true, language: true, createdAt: true,
      isHouse: true, pointsBalance: true, walletBalance: true,
    },
  })
  return new Map(rows.map(c => [c.id, c]))
})

const catIndex = cache(async () => {
  // Explicit select, not a bare fetch: Cat carries several free-text notes
  // columns and this is a whole-table read.
  const rows = await db.cat.findMany({
    select: {
      id: true, name: true, breed: true, coatType: true, customerId: true,
      dateOfBirth: true, groomingInterval: true, vaccinationExpiry: true,
    },
  })
  return new Map(rows.map(c => [c.id, c]))
})

const roomIndex = cache(async () => {
  const rows = await db.room.findMany({ select: { id: true, name: true, type: true, status: true } })
  return new Map(rows.map(r => [r.id, r]))
})

const tierIndex = cache(async () => {
  const rows = await db.membershipTier.findMany({ select: { id: true, name: true, pointsMultiplier: true } })
  return new Map(rows.map(t => [t.id, t]))
})

/** Active memberships grouped by customer, each with its tier already attached. */
const activeMembershipsByCustomer = cache(async () => {
  const [rows, tiers] = [
    await db.membership.findMany({
      where: { status: 'Active' },
      select: { id: true, customerId: true, tierId: true, status: true, expiryDate: true },
      orderBy: { expiryDate: 'asc' },
    }),
    await tierIndex(),
  ]
  const byCustomer = new Map<string, (typeof rows[number] & { tier: NonNullable<ReturnType<typeof tiers.get>> })[]>()
  for (const m of rows) {
    const tier = tiers.get(m.tierId)
    if (!tier) continue
    const list = byCustomer.get(m.customerId) ?? []
    list.push({ ...m, tier })
    byCustomer.set(m.customerId, list)
  }
  return byCustomer
})

/**
 * Look a row up in an index that is guaranteed to contain it.
 *
 * `Appointment.customerId` and `.catId` are NOT NULL foreign keys and SQLite
 * enforces them, and the indexes above are unfiltered whole-table reads — so a
 * miss is not a "maybe", it is a dangling foreign key that the database should
 * have made impossible. Returning null for it would push a `?.` onto every
 * caller to guard against something that cannot happen, and would render a card
 * reading "undefined" if it ever did. Throwing says which row is broken.
 */
function must<T>(index: Map<string, T>, id: string, what: string): T {
  const row = index.get(id)
  if (!row) throw new Error(`${what} ${id} is referenced but does not exist — dangling foreign key`)
  return row
}

/** A customer with their active memberships, in the shape the `include` produced. */
async function customerWithMemberships(id: string) {
  const [customers, memberships] = [await customerIndex(), await activeMembershipsByCustomer()]
  return { ...must(customers, id, 'Customer'), memberships: memberships.get(id) ?? [] }
}

/**
 * Every cat, with its owner and visit history.
 *
 * The visit history is one flat read of every appointment rather than a
 * per-cat relation load.
 */
export const allCatsWithVisits = cache(async () => {
  const [cats, customers, visits] = [
    await db.cat.findMany({
      // The shop's own cats are excluded HERE rather than at each caller, because
      // this one query feeds both the dashboard and the Action Inbox — and the
      // Action Inbox composes WhatsApp messages. A house cat reaching it produces
      // a birthday greeting addressed to a phone number that does not exist.
      where: CAT_NOT_HOUSE,
      select: {
        id: true, name: true, breed: true, coatType: true, groomingInterval: true,
        dateOfBirth: true, vaccinationExpiry: true, lastDewormAt: true, lastDefleaAt: true,
        foundingNumber: true, customerId: true,
      },
    }),
    await customerIndex(),
    await db.appointment.findMany({ select: { catId: true, scheduledAt: true, status: true, type: true } }),
  ]

  const byCat = new Map<string, { scheduledAt: Date; status: string; type: string }[]>()
  for (const v of visits) {
    if (!v.catId) continue
    const list = byCat.get(v.catId) ?? []
    list.push({ scheduledAt: v.scheduledAt, status: v.status, type: v.type })
    byCat.set(v.catId, list)
  }

  return cats.map(c => {
    const owner = must(customers, c.customerId, 'Customer')
    return {
      ...c,
      customer: { id: owner.id, name: owner.name, phone: owner.phone },
      appointments: byCat.get(c.id) ?? [],
    }
  })
})

/** Today's bookings, with the membership tier that makes an arrival a VIP. */
export const appointmentsToday = cache(async () => {
  const { start, end } = today()
  const appts = await db.appointment.findMany({
    // A house cat's residency is an appointment so the room calendar and run
    // sheet see it; the diary is not the place for it. Without this, moving a
    // cat into a room puts a fake arrival on today's board.
    where: { scheduledAt: { gte: start, lt: end }, status: { not: 'Cancelled' }, type: { not: RESIDENCY_TYPE } },
    orderBy: { scheduledAt: 'asc' },
  })
  const [cats, rooms] = [await catIndex(), await roomIndex()]
  return Promise.all(appts.map(async a => ({
    ...a,
    customer: await customerWithMemberships(a.customerId),
    cat: must(cats, a.catId, 'Cat'),
    room: a.roomId ? rooms.get(a.roomId) ?? null : null,
  })))
})

/** Boarding stays ending today. */
export const checkoutsToday = cache(async () => {
  const { start, end } = today()
  const appts = await db.appointment.findMany({
    where: { type: 'Boarding', endsAt: { gte: start, lt: end }, status: { not: 'Cancelled' } },
    orderBy: { endsAt: 'asc' },
  })
  const [customers, cats, rooms] = [await customerIndex(), await catIndex(), await roomIndex()]
  return appts.map(a => ({
    ...a,
    customer: must(customers, a.customerId, 'Customer'),
    cat: must(cats, a.catId, 'Cat'),
    room: a.roomId ? rooms.get(a.roomId) ?? null : null,
  }))
})

/**
 * Completed visits that were never paid for.
 *
 * Takes the larger of the two limits the callers wanted; the dashboard shows
 * ten and slices, rather than spending a second round trip on its own narrower
 * ten.
 */
export const unpaidVisits = cache(async () => {
  const appts = await db.appointment.findMany({
    where: { status: 'Completed', paid: false, price: { not: null }, type: { not: RESIDENCY_TYPE } },
    orderBy: { scheduledAt: 'desc' },
    take: 25,
  })
  const [customers, cats] = [await customerIndex(), await catIndex()]
  return appts.map(a => ({
    ...a,
    customer: must(customers, a.customerId, 'Customer'),
    cat: must(cats, a.catId, 'Cat'),
  }))
})

/** Active memberships running out inside the alert window. */
export const membershipsExpiringSoon = cache(async () => {
  const threshold = new Date(Date.now() + MEMBERSHIP_EXPIRY_ALERT_DAYS * DAY)
  const [byCustomer, customers] = [await activeMembershipsByCustomer(), await customerIndex()]
  return [...byCustomer.values()]
    .flat()
    .filter(m => m.expiryDate != null && m.expiryDate <= threshold)
    .sort((a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0))
    .map(m => ({ ...m, customer: must(customers, m.customerId, 'Customer') }))
})
