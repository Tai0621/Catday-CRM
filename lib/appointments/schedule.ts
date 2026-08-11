import { zonedDayKey } from '../timezone'
import { boardingNights } from '../appointment-charge'

// Appointment scheduling rules — cancelling, moving, and grouping a diary.
//
// Everything here is a decision the server must not delegate to the browser:
// which appointments may still be changed, what a move costs, and which day a
// booking belongs to for a business that is not in UTC.
//
// Both imports are themselves dependency-free, so this module still compiles
// and runs standalone under tsc for direct testing (the same pattern as
// lib/campaigns/economics.ts).

/** Statuses past which an appointment is history, not a plan. */
export const TERMINAL_STATUSES = ['Completed', 'Cancelled', 'NoShow'] as const

/**
 * Can this still be cancelled or moved?
 *
 * Terminal appointments cannot. Cancelling a Completed booking would erase a
 * service that was actually delivered and paid for; re-cancelling a Cancelled
 * one would write a second audit row implying it happened twice.
 *
 * Everything before that IS movable, including CheckedIn and InService —
 * extending a boarding stay while the cat is in the building is one of the most
 * common changes there is, and refusing it would push staff back to editing the
 * database by hand.
 */
export function isChangeable(status: string): boolean {
  return !(TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Why a booking was cancelled. Free text is also accepted alongside these. */
export const CANCEL_REASONS = [
  'Customer cancelled',
  'Customer rescheduled',
  'Cat unwell',
  'Weather / travel',
  'Shop closed',
  'Staff unavailable',
  'Duplicate booking',
  'Other',
] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

export function isCancelReason(v: string): v is CancelReason {
  return (CANCEL_REASONS as readonly string[]).includes(v)
}

// ── Day keys in the business's own timezone ─────────────────────────────────
//
// A Malaysian business runs on UTC+8 while Vercel runs on UTC, so a 07:00
// check-out is 23:00 the PREVIOUS day in UTC. Grouping a diary on the server's
// own calendar would file that booking under yesterday and the owner would go
// looking for a cat that is standing in front of them.
//
// The day-key maths already exists in lib/timezone — reused rather than
// rewritten, so a diary and a report can never disagree about which day a
// booking fell on. That module is import-free too, so this one still compiles
// standalone.

/** `HH:MM` for an instant, as seen in `timeZone`. */
export function zonedTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant)
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/**
 * "Today" / "Tomorrow" / "Yesterday", or null when a plain date reads better.
 *
 * Only the three days a person actually thinks about relatively. "In 4 days"
 * makes someone count, which is the hunting this view exists to remove.
 */
export function relativeDayLabel(dayKey: string, todayKey: string): string | null {
  switch (daysBetween(todayKey, dayKey)) {
    case 0: return 'Today'
    case 1: return 'Tomorrow'
    case -1: return 'Yesterday'
    default: return null
  }
}

// ── Grouping ────────────────────────────────────────────────────────────────

export interface DatedItem { scheduledAt: Date }
export interface DayGroup<T> { dayKey: string; items: T[] }

/**
 * Bucket appointments into days, in the order they were given.
 *
 * The caller sorts (ascending for upcoming, descending for past), so grouping
 * must preserve that order rather than imposing one — a "past" list reads
 * newest-first and re-sorting here would silently flip it.
 */
export function groupByDay<T extends DatedItem>(items: T[], timeZone: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const item of items) {
    const dayKey = zonedDayKey(item.scheduledAt, timeZone)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) last.items.push(item)
    else groups.push({ dayKey, items: [item] })
  }
  return groups
}

// ── Moving a booking ────────────────────────────────────────────────────────

export interface MoveInput {
  lane: 'grooming' | 'boarding'
  startISO: string
  endISO?: string
  /** Minutes, for grooming: the service decides, never the browser. */
  durationMin: number
  /** Per-night rate for boarding, or the flat price for grooming. */
  unitPrice: number
}

export type MoveResult =
  | { ok: true; scheduledAt: Date; endsAt: Date; price: number; nights: number }
  | { ok: false; error: string }

/**
 * Where a moved booking lands, and what it now costs.
 *
 * Boarding is priced per night, so moving the dates CHANGES THE PRICE — a
 * three-night stay pushed out to five nights is not the same bill. Recomputing
 * here (and only here) is what stops a move from quietly leaving the old total
 * attached to new dates.
 */
export function planMove(input: MoveInput, now: Date): MoveResult {
  const scheduledAt = new Date(input.startISO)
  if (isNaN(scheduledAt.getTime())) return { ok: false, error: 'Pick a valid date and time.' }

  if (input.lane !== 'boarding') {
    const endsAt = new Date(scheduledAt.getTime() + input.durationMin * 60_000)
    return { ok: true, scheduledAt, endsAt, price: input.unitPrice, nights: 0 }
  }

  if (!input.endISO) return { ok: false, error: 'Pick a check-out date.' }
  const endsAt = new Date(input.endISO)
  if (isNaN(endsAt.getTime())) return { ok: false, error: 'Pick a valid check-out date.' }
  if (endsAt <= scheduledAt) return { ok: false, error: 'Check-out must be after check-in.' }

  // boardingNights, not a local copy: a moved stay must be charged on exactly
  // the same basis as a new one, and the POS reads that same function when the
  // cat is collected. Two implementations of "how many nights" is a bill that
  // disagrees with itself.
  const nights = boardingNights(scheduledAt, endsAt, now)
  return {
    ok: true, scheduledAt, endsAt, nights,
    price: Math.round(input.unitPrice * nights * 100) / 100,
  }
}

/**
 * A one-line description of a move, for the audit trail.
 *
 * Written from both sides deliberately: an audit row saying only where a
 * booking ended up cannot answer "what did we change it from?", which is the
 * question asked when a customer disputes it.
 */
export function describeMove(
  before: { scheduledAt: Date; endsAt: Date | null; price: number | null },
  after: { scheduledAt: Date; endsAt: Date | null; price: number },
  timeZone: string,
): string {
  const stamp = (d: Date | null) => (d ? `${zonedDayKey(d, timeZone)} ${zonedTime(d, timeZone)}` : '—')
  const parts = [`${stamp(before.scheduledAt)} → ${stamp(after.scheduledAt)}`]
  if (before.endsAt || after.endsAt) parts.push(`ends ${stamp(before.endsAt)} → ${stamp(after.endsAt)}`)
  if (before.price != null && Math.abs(before.price - after.price) >= 0.005) {
    parts.push(`RM ${before.price.toFixed(2)} → RM ${after.price.toFixed(2)}`)
  }
  return parts.join(' · ')
}
