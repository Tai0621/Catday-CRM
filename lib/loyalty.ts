import { db } from './db'
import { GOLD_SPEND_THRESHOLD } from './constants'

/**
 * Award (or deduct) loyalty points for a customer. Writes a ledger entry and
 * keeps the denormalised Customer.pointsBalance in sync in one batch.
 * Pass a negative `points` value for redemptions.
 */
export async function awardPoints(customerId: string, points: number, reason: string, note?: string) {
  await db.$transaction([
    db.loyaltyEntry.create({
      data: { customerId, points, reason, note: note ?? null },
    }),
    db.customer.update({
      where: { id: customerId },
      data: { pointsBalance: { increment: points } },
    }),
  ])
}

/** Total spend over the trailing 12 months (used for Gold qualification). */
export function trailingAnnualSpend(
  transactions: { date: Date; total: number }[],
  now: Date = new Date(),
): number {
  const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
  return transactions
    .filter(t => t.date >= yearAgo)
    .reduce((sum, t) => sum + t.total, 0)
}

/** Whether a customer's spend qualifies them for Gold and how much remains. */
export function goldProgress(annualSpend: number) {
  const qualifies = annualSpend >= GOLD_SPEND_THRESHOLD
  return {
    qualifies,
    remaining: Math.max(0, GOLD_SPEND_THRESHOLD - annualSpend),
    pct: Math.min(100, Math.round((annualSpend / GOLD_SPEND_THRESHOLD) * 100)),
  }
}

/** Next sequential member card number (1-based). */
export async function nextMemberNumber(): Promise<number> {
  const latest = await db.membership.findFirst({
    where: { memberNumber: { not: null } },
    orderBy: { memberNumber: 'desc' },
    select: { memberNumber: true },
  })
  return (latest?.memberNumber ?? 0) + 1
}
