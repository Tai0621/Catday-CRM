import { db } from './db'
import {
  ACTION_TYPES,
  ACTION_LEARNING_MIN_SAMPLE,
  ACTION_LEARNING_HALF_LIFE_DAYS,
  ACTION_LEARNING_MAX_SHIFT,
  ACTION_LEARNING_LOOKBACK_DAYS,
  ACTION_SUPPRESS_ACCEPTANCE,
  ACTION_SUPPRESS_MIN_PRIORITY,
  ACTION_OUTCOME_WINDOW_DAYS,
  type ActionType,
} from './constants'

const DAY = 24 * 60 * 60 * 1000

// ── C3 · Learning from the Action Inbox ──────────────────────────────────────
// The queue used to rank purely on a hardcoded priority while ActionLog quietly
// accumulated a labelled record of which suggestions staff actually act on, and
// whether those suggestions produced a booking. This module reads that record
// back so the queue ranks on evidence.
//
// Two things are deliberately NOT done here:
//
//  1. Learning cannot reorder the queue freely. It shifts a type's effective
//     priority by at most ACTION_LEARNING_MAX_SHIFT, so an unpaid bill can never
//     sink below a birthday no matter how well birthdays convert. The bands
//     ("Do now" / "This week" / "Opportunities") keep their operational meaning.
//  2. Urgent types are never suppressed. Staff dismissing outstanding payments
//     means the collection process is broken, not that the card is useless.

export interface TypeStats {
  type: ActionType
  sample: number          // raw outcome count — gates whether we judge at all
  done: number
  snoozed: number
  dismissed: number
  acceptance: number      // time-decayed Done ÷ all outcomes
  converted: number       // outcomes followed by a booking/payment in the window
  conversionRate: number  // converted ÷ outcomes eligible for conversion
  hasOutcomeWindow: boolean
  measured: boolean       // sample cleared ACTION_LEARNING_MIN_SAMPLE
  suppressed: boolean
}

/** Older evidence counts for less, so the queue is not frozen by last year's behaviour. */
function decay(ageDays: number): number {
  return Math.pow(0.5, ageDays / ACTION_LEARNING_HALF_LIFE_DAYS)
}

/**
 * Read every logged action outcome in the lookback window and score each type on
 * acceptance (did staff act on it) and conversion (did a booking or payment
 * follow). Conversion is the real signal; acceptance is only a proxy and is used
 * alone for internal task types that no customer can convert on.
 */
export async function buildActionStats(now: Date = new Date()): Promise<Map<ActionType, TypeStats>> {
  const since = new Date(now.getTime() - ACTION_LEARNING_LOOKBACK_DAYS * DAY)

  const logs = await db.actionLog.findMany({
    where: { createdAt: { gte: since } },
    select: { type: true, status: true, customerId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const stats = new Map<ActionType, TypeStats>()
  for (const type of ACTION_TYPES) {
    stats.set(type, {
      type, sample: 0, done: 0, snoozed: 0, dismissed: 0,
      acceptance: 0, converted: 0, conversionRate: 0,
      hasOutcomeWindow: ACTION_OUTCOME_WINDOW_DAYS[type] != null,
      measured: false, suppressed: false,
    })
  }
  if (logs.length === 0) return stats

  // One batched read of everything that could count as a conversion for any
  // customer that appears in the log, rather than a query per action.
  const customerIds = [...new Set(logs.map(l => l.customerId).filter((id): id is string => !!id))]
  const [appointments, transactions] = customerIds.length
    ? await Promise.all([
      db.appointment.findMany({
        where: { customerId: { in: customerIds }, createdAt: { gte: since }, status: { not: 'Cancelled' } },
        select: { customerId: true, createdAt: true },
      }),
      db.transaction.findMany({
        where: { customerId: { in: customerIds }, date: { gte: since } },
        select: { customerId: true, date: true },
      }),
    ])
    : [[], []]

  const bookingsBy = new Map<string, number[]>()
  for (const a of appointments) {
    const list = bookingsBy.get(a.customerId) ?? []
    list.push(a.createdAt.getTime())
    bookingsBy.set(a.customerId, list)
  }
  const paymentsBy = new Map<string, number[]>()
  for (const t of transactions) {
    if (!t.customerId) continue
    const list = paymentsBy.get(t.customerId) ?? []
    list.push(t.date.getTime())
    paymentsBy.set(t.customerId, list)
  }

  // Weighted accumulators, kept separate from the raw counts that gate judgement.
  const acc = new Map<ActionType, { w: number; wDone: number; wEligible: number; wConverted: number }>()
  for (const type of ACTION_TYPES) acc.set(type, { w: 0, wDone: 0, wEligible: 0, wConverted: 0 })

  for (const log of logs) {
    const type = log.type as ActionType
    const s = stats.get(type)
    const a = acc.get(type)
    if (!s || !a) continue // an action type retired from ACTION_TYPES but still in history

    const weight = decay((now.getTime() - log.createdAt.getTime()) / DAY)
    s.sample++
    if (log.status === 'Done') s.done++
    else if (log.status === 'Snoozed') s.snoozed++
    else if (log.status === 'Dismissed') s.dismissed++

    a.w += weight
    if (log.status === 'Done') a.wDone += weight

    const windowDays = ACTION_OUTCOME_WINDOW_DAYS[type]
    if (windowDays == null || !log.customerId) continue

    // Only count outcomes whose window has actually closed — a card logged
    // yesterday has not had its 21 days to convert and would drag the rate down.
    const windowEnd = log.createdAt.getTime() + windowDays * DAY
    if (windowEnd > now.getTime()) continue

    a.wEligible += weight
    const pool = type === 'OutstandingPayment' ? paymentsBy : bookingsBy
    const hit = (pool.get(log.customerId) ?? []).some(t => t > log.createdAt.getTime() && t <= windowEnd)
    if (hit) {
      s.converted++
      a.wConverted += weight
    }
  }

  for (const type of ACTION_TYPES) {
    const s = stats.get(type)!
    const a = acc.get(type)!
    s.acceptance = a.w > 0 ? a.wDone / a.w : 0
    s.conversionRate = a.wEligible > 0 ? a.wConverted / a.wEligible : 0
    s.measured = s.sample >= ACTION_LEARNING_MIN_SAMPLE
    s.suppressed = s.measured && s.acceptance < ACTION_SUPPRESS_ACCEPTANCE
  }

  return stats
}

/** The metric a type is judged on: conversion where it exists, acceptance otherwise. */
function metricFor(s: TypeStats): { value: number; family: 'conversion' | 'acceptance' } | null {
  if (!s.measured) return null
  if (s.hasOutcomeWindow) return { value: s.conversionRate, family: 'conversion' }
  return { value: s.acceptance, family: 'acceptance' }
}

/**
 * Effective priority per type, given the static priorities the generators assign.
 *
 * Conversion rates (5–25%) and acceptance rates (40–80%) live on different
 * scales, so a type is compared against the mean of other types measured on the
 * *same* metric rather than against a fixed constant. Unmeasured types score
 * zero adjustment, which is what keeps new and rare types in rotation instead of
 * starving them.
 */
export function priorityShifts(stats: Map<ActionType, TypeStats>): Map<ActionType, number> {
  const families: Record<'conversion' | 'acceptance', number[]> = { conversion: [], acceptance: [] }
  for (const s of stats.values()) {
    const m = metricFor(s)
    if (m) families[m.family].push(m.value)
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const baseline = { conversion: mean(families.conversion), acceptance: mean(families.acceptance) }

  const shifts = new Map<ActionType, number>()
  for (const s of stats.values()) {
    const m = metricFor(s)
    if (!m) { shifts.set(s.type, 0); continue }
    const base = baseline[m.family]
    // Relative lift against the average type on the same metric. A type that
    // converts twice as well as average moves a full step up the queue.
    const lift = base > 0 ? (m.value - base) / base : 0
    const shift = Math.max(-ACTION_LEARNING_MAX_SHIFT, Math.min(ACTION_LEARNING_MAX_SHIFT, lift * ACTION_LEARNING_MAX_SHIFT))
    shifts.set(s.type, shift)
  }
  return shifts
}

/** A better-performing type gets a lower (more urgent) effective priority. */
export function effectivePriority(basePriority: number, shift: number): number {
  return basePriority - shift
}

export function isSuppressed(s: TypeStats | undefined, basePriority: number): boolean {
  if (!s?.suppressed) return false
  return basePriority >= ACTION_SUPPRESS_MIN_PRIORITY
}
