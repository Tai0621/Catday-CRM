import { db } from './db'
import { getConfig } from './config'
import {
  ACTION_TYPES,
  ACTION_LEARNING_LOOKBACK_DAYS,
  ACTION_OUTCOME_WINDOW_DAYS,
  type ActionType,
} from './constants'

const DAY = 24 * 60 * 60 * 1000

// ── M2 · Marketing attribution ───────────────────────────────────────────────
// C3 answers "did a booking follow this nudge?". This answers "how much was it
// worth?" — the same join, carrying money instead of a boolean, so the Action
// Inbox and the message variants can be read as a marketing P&L rather than a
// pair of percentages.
//
// Two things this deliberately does NOT claim:
//
//  1. It is LAST-TOUCH. When several nudges precede one sale, only the most
//     recent one inside its window is credited. Crediting all of them would let
//     a single RM 200 groom appear as RM 600 of "marketing revenue" — the
//     fastest way to build a report nobody can trust.
//
//  2. It is ATTRIBUTED, not INCREMENTAL. A customer who would have booked anyway
//     still counts. Knowing the difference needs a holdout group — a slice of
//     each audience deliberately left un-messaged — which is worth building once
//     there is enough volume to spare. Until then the UI says "attributed", and
//     the number should be read as an upper bound.

export interface TypeRevenue {
  type: ActionType
  sends: number         // outcomes staff marked Done — see the caveat below
  attributedRM: number
  spendRM: number
  netRM: number
  perSendRM: number
}

export interface VariantRevenue {
  label: string
  sends: number
  attributedRM: number
  perSendRM: number
}

export interface Attribution {
  byType: Map<ActionType, TypeRevenue>
  byVariant: Map<string, VariantRevenue>
  messageCostRM: number
  totalAttributedRM: number
  totalSpendRM: number
}

const empty = (type: ActionType): TypeRevenue =>
  ({ type, sends: 0, attributedRM: 0, spendRM: 0, netRM: 0, perSendRM: 0 })

const r2 = (v: number) => Math.round(v * 100) / 100

export async function buildAttribution(now: Date = new Date()): Promise<Attribution> {
  const since = new Date(now.getTime() - ACTION_LEARNING_LOOKBACK_DAYS * DAY)
  const { marketing } = await getConfig()
  const messageCostRM = marketing.messageCostRM

  const byType = new Map<ActionType, TypeRevenue>(ACTION_TYPES.map(t => [t, empty(t)]))
  const byVariant = new Map<string, VariantRevenue>()

  const logs = await db.actionLog.findMany({
    where: { createdAt: { gte: since }, customerId: { not: null } },
    select: { type: true, status: true, customerId: true, variant: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (logs.length === 0) {
    return { byType, byVariant, messageCostRM, totalAttributedRM: 0, totalSpendRM: 0 }
  }

  // "Sends" is a proxy: Done means a staff member marked the card handled, which
  // for a WhatsApp card means they sent it. Actual delivery is not tracked while
  // sending goes through a deep link, so this counts intent, not receipts.
  for (const log of logs) {
    if (log.status !== 'Done') continue
    const t = byType.get(log.type as ActionType)
    if (t) t.sends++
    if (log.variant) {
      const v = byVariant.get(log.variant) ?? { label: log.variant, sends: 0, attributedRM: 0, perSendRM: 0 }
      v.sends++
      byVariant.set(log.variant, v)
    }
  }

  const customerIds = [...new Set(logs.map(l => l.customerId!))]
  const transactions = await db.transaction.findMany({
    where: { customerId: { in: customerIds }, date: { gte: since } },
    select: { customerId: true, date: true, total: true },
  })

  const logsByCustomer = new Map<string, typeof logs>()
  for (const log of logs) {
    const list = logsByCustomer.get(log.customerId!) ?? []
    list.push(log)
    logsByCustomer.set(log.customerId!, list)
  }

  for (const tx of transactions) {
    if (!tx.customerId || tx.total <= 0) continue
    const candidates = logsByCustomer.get(tx.customerId) ?? []

    // Last touch: the most recent nudge whose window still covered this sale.
    let winner: (typeof logs)[number] | null = null
    for (const log of candidates) {
      const windowDays = ACTION_OUTCOME_WINDOW_DAYS[log.type as ActionType]
      if (windowDays == null) continue // internal task, nothing to credit
      const start = log.createdAt.getTime()
      const end = start + windowDays * DAY
      const at = tx.date.getTime()
      if (at <= start || at > end) continue
      if (!winner || log.createdAt > winner.createdAt) winner = log
    }
    if (!winner) continue

    const t = byType.get(winner.type as ActionType)
    if (t) t.attributedRM += tx.total
    if (winner.variant) {
      const v = byVariant.get(winner.variant) ?? { label: winner.variant, sends: 0, attributedRM: 0, perSendRM: 0 }
      v.attributedRM += tx.total
      byVariant.set(winner.variant, v)
    }
  }

  let totalAttributedRM = 0, totalSpendRM = 0
  for (const t of byType.values()) {
    t.attributedRM = r2(t.attributedRM)
    t.spendRM = r2(t.sends * messageCostRM)
    t.netRM = r2(t.attributedRM - t.spendRM)
    t.perSendRM = t.sends > 0 ? r2(t.attributedRM / t.sends) : 0
    totalAttributedRM += t.attributedRM
    totalSpendRM += t.spendRM
  }
  for (const v of byVariant.values()) {
    v.attributedRM = r2(v.attributedRM)
    v.perSendRM = v.sends > 0 ? r2(v.attributedRM / v.sends) : 0
  }

  return {
    byType, byVariant, messageCostRM,
    totalAttributedRM: r2(totalAttributedRM),
    totalSpendRM: r2(totalSpendRM),
  }
}
