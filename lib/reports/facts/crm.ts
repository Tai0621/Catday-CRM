import { db } from '../../db'
import { monthRange } from '../period'
import { buildCustomerIntel } from '../../intelligence'
import { LIVE_CUSTOMER } from '../../cat-stock'

// C9 · Customers & CRM.
//
// The line that matters here is SEGMENT MIGRATION: how many customers were
// Regular at the start of the month and At-risk by the end of it. It is the
// earliest signal a business is leaking, and nothing else in the OS shows it.
//
// It is computed by running the same `buildCustomerIntel` twice — once with the
// clock set to the start of the month, once to the end — over each customer's
// own history. That works because intel is a pure function of a history and a
// timestamp, so "what would we have said about this customer on the 1st?" is
// answerable today without ever having stored it. No snapshot table, no
// backfill, and the answer is consistent with what the customer pages show.
//
// Erased customers (Track A) are excluded throughout.

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CrmFacts {
  base: { total: number; newThisMonth: number; withMarketingConsent: number; consentRatePct: number }
  activity: { customersServed: number; returning: number; firstTimers: number; repeatRatePct: number }
  segments: {
    atMonthEnd: { segment: string; count: number }[]
    /** from → to, counting only customers whose segment actually changed */
    migration: { from: string; to: string; count: number }[]
    deteriorated: number
    improved: number
    newlyAtRisk: number
    newlyLost: number
  }
  value: { totalLtvRM: number; averageLtvRM: number; medianLtvRM: number; top10SharePct: number }
  loyalty: { pointsIssued: number; pointsRedeemed: number; walletFloatRM: number }
  memberships: { active: number; startedThisMonth: number; expiredThisMonth: number }
  incidents: { raised: number; resolved: number; openAtMonthEnd: number }
}

export async function crmFacts(month: string): Promise<CrmFacts> {
  const { start, end } = monthRange(month)

  const [customers, pointsIn, pointsOut, walletAgg, activeMemberships, startedM, expiredM,
    raised, resolved, openNow] = await Promise.all([
    db.customer.findMany({
      where: LIVE_CUSTOMER,
      select: {
        id: true, createdAt: true, marketingConsent: true,
        appointments: { select: { scheduledAt: true, status: true } },
        transactions: { select: { total: true, date: true } },
        memberships: { where: { status: 'Active' }, select: { status: true, tier: { select: { name: true } } } },
      },
    }),
    db.loyaltyEntry.aggregate({ where: { createdAt: { gte: start, lt: end }, points: { gt: 0 } }, _sum: { points: true } }),
    db.loyaltyEntry.aggregate({ where: { createdAt: { gte: start, lt: end }, points: { lt: 0 } }, _sum: { points: true } }),
    db.customer.aggregate({ where: LIVE_CUSTOMER, _sum: { walletBalance: true } }),
    db.membership.count({ where: { status: 'Active' } }),
    db.membership.count({ where: { createdAt: { gte: start, lt: end } } }),
    db.membership.count({ where: { expiryDate: { gte: start, lt: end } } }),
    db.incident.count({ where: { createdAt: { gte: start, lt: end } } }),
    db.incident.count({ where: { resolved: true, updatedAt: { gte: start, lt: end } } }),
    db.incident.count({ where: { resolved: false } }),
  ])

  // Intel is a pure function of history and a timestamp, so the same customer
  // can be judged as at two different dates without any stored snapshot.
  const RANK: Record<string, number> = { New: 0, Regular: 1, VIP: 2, 'At-risk': -1, Lost: -2 }
  const migration = new Map<string, number>()
  const endSegments = new Map<string, number>()
  let deteriorated = 0, improved = 0, newlyAtRisk = 0, newlyLost = 0

  const ltvs: number[] = []
  for (const c of customers) {
    const input = {
      createdAt: c.createdAt,
      appointments: c.appointments,
      transactions: c.transactions,
      memberships: c.memberships.map(m => ({ status: m.status, tier: { name: m.tier.name } })),
    }
    // Only history that existed by each cut-off may inform that cut-off.
    const before = buildCustomerIntel({
      ...input,
      appointments: c.appointments.filter(a => a.scheduledAt < start),
      transactions: c.transactions.filter(t => t.date < start),
    }, start)
    const after = buildCustomerIntel({
      ...input,
      appointments: c.appointments.filter(a => a.scheduledAt < end),
      transactions: c.transactions.filter(t => t.date < end),
    }, end)

    endSegments.set(after.segment, (endSegments.get(after.segment) ?? 0) + 1)
    ltvs.push(after.ltv)

    // A customer who did not exist yet has no "before" worth comparing.
    if (c.createdAt >= start) continue
    if (before.segment === after.segment) continue

    const key = `${before.segment}→${after.segment}`
    migration.set(key, (migration.get(key) ?? 0) + 1)
    if (RANK[after.segment] < RANK[before.segment]) deteriorated++
    else improved++
    if (after.segment === 'At-risk') newlyAtRisk++
    if (after.segment === 'Lost') newlyLost++
  }

  const served = new Set<string>()
  const firstTimers = new Set<string>()
  for (const c of customers) {
    const inMonth = c.appointments.filter(a => a.scheduledAt >= start && a.scheduledAt < end)
    if (inMonth.length === 0) continue
    served.add(c.id)
    if (!c.appointments.some(a => a.scheduledAt < start)) firstTimers.add(c.id)
  }

  const sorted = [...ltvs].sort((a, b) => a - b)
  const totalLtv = sorted.reduce((s, v) => s + v, 0)
  const top10 = [...ltvs].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(ltvs.length * 0.1)))
  const consented = customers.filter(c => c.marketingConsent).length

  return {
    base: {
      total: customers.length,
      newThisMonth: customers.filter(c => c.createdAt >= start && c.createdAt < end).length,
      withMarketingConsent: consented,
      consentRatePct: customers.length > 0 ? Math.round((consented / customers.length) * 1000) / 10 : 0,
    },
    activity: {
      customersServed: served.size,
      returning: served.size - firstTimers.size,
      firstTimers: firstTimers.size,
      repeatRatePct: served.size > 0 ? Math.round(((served.size - firstTimers.size) / served.size) * 1000) / 10 : 0,
    },
    segments: {
      atMonthEnd: [...endSegments.entries()].map(([segment, count]) => ({ segment, count }))
        .sort((a, b) => b.count - a.count),
      migration: [...migration.entries()]
        .map(([k, count]) => ({ from: k.split('→')[0], to: k.split('→')[1], count }))
        .sort((a, b) => b.count - a.count),
      deteriorated, improved, newlyAtRisk, newlyLost,
    },
    value: {
      totalLtvRM: r2(totalLtv),
      averageLtvRM: ltvs.length > 0 ? r2(totalLtv / ltvs.length) : 0,
      medianLtvRM: sorted.length > 0 ? r2(sorted[Math.floor(sorted.length / 2)]) : 0,
      top10SharePct: totalLtv > 0 ? Math.round((top10.reduce((s, v) => s + v, 0) / totalLtv) * 1000) / 10 : 0,
    },
    loyalty: {
      pointsIssued: pointsIn._sum.points ?? 0,
      pointsRedeemed: Math.abs(pointsOut._sum.points ?? 0),
      walletFloatRM: r2(walletAgg._sum.walletBalance ?? 0),
    },
    memberships: { active: activeMemberships, startedThisMonth: startedM, expiredThisMonth: expiredM },
    incidents: { raised, resolved, openAtMonthEnd: openNow },
  }
}
