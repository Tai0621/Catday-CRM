import { db } from '../../db'
import { monthRange, shiftMonth } from '../period'
import { buildIncomeStatement } from '../../finance'
import { buildReceivables, buildPayables } from '../../aging'

// C9 · Finance. Every figure is lifted from the SAME builder that renders the
// income statement — not recomputed from transactions.
//
// This is the whole point of the department. If the report added its own sum
// over `Transaction`, it would drift from the statement the moment an
// accountant keyed an override into a cell (blue = keyed, black = derived), and
// the owner would be holding two documents that disagree. Reports must be the
// statement, narrated.
//
// Data-integrity rule 1 holds: read-only, nothing here writes to operations.

const r2 = (n: number) => Math.round(n * 100) / 100

export interface FinanceFacts {
  month: string
  revenue: { totalRM: number; byStreamRM: { stream: string; amountRM: number }[] }
  costs: { cogsRM: number; opexRM: number; byCategoryRM: { category: string; amountRM: number }[] }
  profit: {
    grossProfitRM: number
    grossMarginPct: number | null
    ebitdaRM: number
    netIncomeRM: number
    netMarginPct: number | null
  }
  versusPriorMonth: { revenueRM: number; changeRM: number; changePct: number | null }
  plan: { targetRM: number | null; achievedPct: number | null; varianceRM: number | null }
  aging: {
    receivableRM: number
    receivableOver90RM: number
    payableRM: number
    payableOver90RM: number
    customersOwing: number
  }
  cash: { collectedRM: number; byMethodRM: { method: string; amountRM: number }[] }
}

/** One month's column out of a StatementRow, which carries all twelve. */
const at = (row: { values: number[] } | undefined, i: number) => r2(row?.values[i] ?? 0)

export async function financeFacts(month: string): Promise<FinanceFacts> {
  const [year, m] = month.split('-').map(Number)
  const i = m - 1
  const { start, end } = monthRange(month)
  const prev = shiftMonth(month, -1)

  const [statement, target, receivables, payables, methods] = await Promise.all([
    buildIncomeStatement(year),
    db.monthlyTarget.findUnique({ where: { month }, select: { revenueTarget: true } }),
    buildReceivables(),
    buildPayables(),
    db.transaction.groupBy({
      by: ['method'], where: { date: { gte: start, lt: end } }, _sum: { total: true },
    }),
  ])

  // January's comparison month lives in the previous year's statement.
  const prevYear = Number(prev.slice(0, 4))
  const prevIndex = Number(prev.slice(5)) - 1
  const prevStatement = prevYear === year ? statement : await buildIncomeStatement(prevYear)

  const totalRevenue = at(statement.totalRevenue, i)
  const prevRevenue = at(prevStatement.totalRevenue, prevIndex)
  const changeRM = r2(totalRevenue - prevRevenue)

  const grossMargin = statement.grossMarginPct[i]
  const netIncome = at(statement.netIncome, i)
  const targetRM = target?.revenueTarget ?? null

  return {
    month,
    revenue: {
      totalRM: totalRevenue,
      byStreamRM: statement.revenue
        .map(r => ({ stream: r.label, amountRM: at(r, i) }))
        .filter(s => s.amountRM !== 0),
    },
    costs: {
      cogsRM: at(statement.totalCogs, i),
      opexRM: at(statement.totalOpex, i),
      byCategoryRM: [...statement.cogs, ...statement.opex]
        .map(r => ({ category: r.label, amountRM: at(r, i) }))
        .filter(c => c.amountRM !== 0)
        .sort((a, b) => b.amountRM - a.amountRM),
    },
    profit: {
      grossProfitRM: at(statement.grossProfit, i),
      // -1 is the statement's "no revenue, margin undefined" sentinel; surfacing
      // it as a percentage would report a -100% margin that never happened.
      grossMarginPct: grossMargin === -1 ? null : Math.round(grossMargin * 10) / 10,
      ebitdaRM: at(statement.ebitda, i),
      netIncomeRM: netIncome,
      netMarginPct: totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 1000) / 10 : null,
    },
    versusPriorMonth: {
      revenueRM: prevRevenue,
      changeRM,
      changePct: prevRevenue > 0 ? Math.round((changeRM / prevRevenue) * 1000) / 10 : null,
    },
    plan: {
      targetRM,
      achievedPct: targetRM && targetRM > 0 ? Math.round((totalRevenue / targetRM) * 1000) / 10 : null,
      varianceRM: targetRM ? r2(totalRevenue - targetRM) : null,
    },
    aging: {
      receivableRM: r2(receivables.total),
      receivableOver90RM: r2(receivables.buckets.d90),
      payableRM: r2(payables.total),
      payableOver90RM: r2(payables.buckets.d90),
      customersOwing: receivables.customers.length,
    },
    cash: {
      collectedRM: r2(methods.reduce((s, g) => s + (g._sum.total ?? 0), 0)),
      byMethodRM: methods
        .map(g => ({ method: g.method ?? 'Unrecorded', amountRM: r2(g._sum.total ?? 0) }))
        .filter(x => x.amountRM !== 0)
        .sort((a, b) => b.amountRM - a.amountRM),
    },
  }
}
