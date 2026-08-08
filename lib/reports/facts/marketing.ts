import { db } from '../../db'
import { monthRange } from '../period'
import { buildActionStats } from '../../actions-learning'
import { buildAttribution } from '../../attribution'
import { SYSTEM_GROUPS } from '../../customer-groups'

// C9 · Marketing. Outreach volume, the Action Inbox's own performance (C3),
// message-variant results (C4) and attributed revenue (M2).
//
// One honest caveat, carried into the facts themselves rather than hidden:
// `buildActionStats` and `buildAttribution` are time-DECAYED and evaluated as
// at now, not confined to the reported month. Their windows are what makes them
// meaningful — a conversion window that closes after the month end would
// otherwise be scored as a miss. So they are labelled `asAtGeneration` and the
// narration is told what that means, rather than being handed month-shaped
// numbers that are not month-shaped.

const r2 = (n: number) => Math.round(n * 100) / 100

export interface MarketingFacts {
  outreach: {
    messagesSent: number
    customersReached: number
    byGroup: { group: string; sends: number }[]
    consentBase: number
  }
  reviews: { requested: number; answered: number; positive: number; clickedThrough: number; responseRatePct: number }
  referrals: { linked: number; credited: number; creditPaidRM: number }
  /** C3/C4/M2 — decayed and evaluated at generation time, NOT confined to the month. */
  asAtGeneration: {
    note: string
    actionTypes: { type: string; sample: number; acceptancePct: number; conversionPct: number; suppressed: boolean }[]
    attributedRevenueRM: number
    marketingSpendRM: number
    netRM: number
    byType: { type: string; sends: number; attributedRM: number; perSendRM: number }[]
  }
}

export async function marketingFacts(month: string): Promise<MarketingFacts> {
  const { start, end } = monthRange(month)

  const [sends, consentBase, reviews, referralsLinked, referralsCredited, creditSum, stats, attribution] =
    await Promise.all([
      db.groupSend.findMany({
        where: { sentAt: { gte: start, lt: end } },
        select: { groupKey: true, customerId: true },
      }),
      db.customer.count({ where: { marketingConsent: true, erasedAt: null } }),
      // Counted by when the ASK went out, not when it was answered: the funnel
      // is "of the requests we sent in March, how many came back", and keying
      // on the reply would move a March request into April's numbers.
      db.reviewRequest.findMany({
        where: { sentAt: { gte: start, lt: end } },
        select: { respondedAt: true, sentiment: true, clickedAt: true },
      }),
      db.referral.count({ where: { createdAt: { gte: start, lt: end } } }),
      db.referral.count({ where: { status: 'Credited', creditedAt: { gte: start, lt: end } } }),
      db.referral.aggregate({
        where: { status: 'Credited', creditedAt: { gte: start, lt: end } },
        _sum: { referrerCreditRM: true, referredCreditRM: true },
      }),
      buildActionStats(),
      buildAttribution(),
    ])

  const byGroup = new Map<string, number>()
  for (const s of sends) byGroup.set(s.groupKey, (byGroup.get(s.groupKey) ?? 0) + 1)
  const groupName = (key: string) => SYSTEM_GROUPS.find(g => g.key === key)?.name ?? key

  const answered = reviews.filter(r => r.respondedAt).length

  return {
    outreach: {
      messagesSent: sends.length,
      customersReached: new Set(sends.map(s => s.customerId)).size,
      byGroup: [...byGroup.entries()]
        .map(([key, count]) => ({ group: groupName(key), sends: count }))
        .sort((a, b) => b.sends - a.sends),
      consentBase,
    },
    reviews: {
      requested: reviews.length,
      answered,
      positive: reviews.filter(r => r.sentiment === 'Positive').length,
      clickedThrough: reviews.filter(r => r.clickedAt).length,
      responseRatePct: reviews.length > 0 ? Math.round((answered / reviews.length) * 1000) / 10 : 0,
    },
    referrals: {
      linked: referralsLinked,
      credited: referralsCredited,
      creditPaidRM: r2((creditSum._sum.referrerCreditRM ?? 0) + (creditSum._sum.referredCreditRM ?? 0)),
    },
    asAtGeneration: {
      note: 'Action-inbox and attribution figures are time-decayed and measured at the moment this report was generated, not confined to the reported month. Conversion windows that close after the month end would otherwise be scored as misses.',
      actionTypes: [...stats.values()]
        .filter(s => s.sample > 0)
        .map(s => ({
          type: s.type,
          sample: s.sample,
          acceptancePct: Math.round(s.acceptance * 1000) / 10,
          conversionPct: Math.round(s.conversionRate * 1000) / 10,
          suppressed: s.suppressed,
        }))
        .sort((a, b) => b.sample - a.sample),
      attributedRevenueRM: r2(attribution.totalAttributedRM),
      marketingSpendRM: r2(attribution.totalSpendRM),
      netRM: r2(attribution.totalAttributedRM - attribution.totalSpendRM),
      byType: [...attribution.byType.values()]
        .filter(t => t.sends > 0)
        .map(t => ({ type: t.type, sends: t.sends, attributedRM: r2(t.attributedRM), perSendRM: r2(t.perSendRM) }))
        .sort((a, b) => b.attributedRM - a.attributedRM),
    },
  }
}
