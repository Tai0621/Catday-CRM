import { db } from '../../db'
import { monthRange } from '../period'
import { depreciationInMonth, fixedAssetsNBV } from '../../assets'
import { LIVE_CUSTOMER } from '../../cat-stock'

// C9 · Administrative. Compliance, assets, the audit trail, data protection.
//
// This is the department nobody looks at until something has already lapsed,
// which is exactly why it gets a monthly report. A licence that expired three
// weeks ago is a finding; a licence expiring next month is a task.

const r2 = (n: number) => Math.round(n * 100) / 100
const DAY = 86400000

export interface AdminFacts {
  licenses: {
    total: number
    lapsed: number
    dueWithin60Days: number
    renewedThisMonth: number
    lapsedItems: { name: string; daysOverdue: number }[]
    dueItems: { name: string; daysUntil: number }[]
  }
  assets: {
    count: number
    additionsThisMonth: number
    additionsCostRM: number
    depreciationThisMonthRM: number
    netBookValueRM: number
  }
  audit: { entries: number; byAction: { action: string; count: number }[] }
  dataProtection: { erasuresCompleted: number; activeCustomers: number; erasedTotal: number }
}

export async function adminFacts(month: string): Promise<AdminFacts> {
  const { start, end } = monthRange(month)
  const asOf = end
  const soon = new Date(asOf.getTime() + 60 * DAY)

  const [licenses, assets, audit, erasedInMonth, activeCustomers, erasedTotal] = await Promise.all([
    db.license.findMany({
      where: { archived: false },
      select: { name: true, renewalDate: true, updatedAt: true },
    }),
    db.fixedAsset.findMany({
      select: { name: true, cost: true, salvageValue: true, purchaseDate: true, usefulLifeMonths: true },
    }),
    db.auditLog.groupBy({ by: ['action'], where: { at: { gte: start, lt: end } }, _count: true }),
    db.customer.count({ where: { erasedAt: { gte: start, lt: end } } }),
    db.customer.count({ where: LIVE_CUSTOMER }),
    db.customer.count({ where: { erasedAt: { not: null } } }),
  ])

  // Judged as at the month end, not today: a report for March must say what was
  // true in March, or re-reading it in June tells a different story each time.
  const lapsed = licenses.filter(l => l.renewalDate < asOf)
  const due = licenses.filter(l => l.renewalDate >= asOf && l.renewalDate <= soon)

  const [year, m] = month.split('-').map(Number)
  const additions = assets.filter(a => a.purchaseDate >= start && a.purchaseDate < end)

  return {
    licenses: {
      total: licenses.length,
      lapsed: lapsed.length,
      dueWithin60Days: due.length,
      renewedThisMonth: licenses.filter(l => l.updatedAt >= start && l.updatedAt < end && l.renewalDate >= asOf).length,
      lapsedItems: lapsed
        .map(l => ({ name: l.name, daysOverdue: Math.floor((asOf.getTime() - l.renewalDate.getTime()) / DAY) }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 10),
      dueItems: due
        .map(l => ({ name: l.name, daysUntil: Math.ceil((l.renewalDate.getTime() - asOf.getTime()) / DAY) }))
        .sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 10),
    },
    assets: {
      count: assets.length,
      additionsThisMonth: additions.length,
      additionsCostRM: r2(additions.reduce((s, a) => s + a.cost, 0)),
      depreciationThisMonthRM: r2(assets.reduce((s, a) => s + depreciationInMonth(a, year, m - 1), 0)),
      netBookValueRM: r2(fixedAssetsNBV(assets, month)),
    },
    audit: {
      entries: audit.reduce((s, a) => s + a._count, 0),
      byAction: audit.map(a => ({ action: a.action, count: a._count }))
        .sort((a, b) => b.count - a.count).slice(0, 10),
    },
    dataProtection: { erasuresCompleted: erasedInMonth, activeCustomers, erasedTotal },
  }
}
