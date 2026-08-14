import { db } from './db'
import { periodOf } from './media'

// The document trail behind the monthly figures.
//
// Two questions the owner asks at close:
//   "does the revenue on the income statement match the sales we actually rang up?"
//   "do I have an invoice for every expense I claimed?"
//
// Both are answered per PERIOD. A period here is always "YYYY-MM" derived from
// the record's own date — a sale's transaction date, an expense's expense date.
// Never the upload date, and never a month stored alongside: an invoice arrives
// days after the expense and often in the following month, and a second stored
// copy of "which month is this" is exactly how documents end up filed under the
// wrong close.

export type Period = string // "YYYY-MM"

export function monthLabelOf(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
}

/** First instant of the period, and the first instant of the next one. */
export function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number)
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) }
}

export interface SaleReceipt {
  /** The receipt token — null when the sale predates digital receipts. */
  token: string | null
  reference: string | null
  primaryId: string
  date: Date
  customer: string | null
  /** Every row sharing this reference, summed. */
  total: number
  methods: string[]
  /** A split payment is one sale across several rows. */
  rowCount: number
}

/**
 * Every sale in the period, as receipts rather than as rows.
 *
 * A split payment (wallet + card) is stored as two Transaction rows sharing one
 * `reference`, so counting rows would overstate the number of sales while
 * summing them gives the right money. Grouping by reference makes the count and
 * the total agree with what actually happened at the counter.
 */
export async function receiptsForPeriod(period: Period): Promise<SaleReceipt[]> {
  const { start, end } = periodRange(period)
  const rows = await db.transaction.findMany({
    where: { date: { gte: start, lt: end } },
    select: {
      id: true, reference: true, date: true, total: true, method: true, publicToken: true,
      customer: { select: { name: true, phone: true } },
    },
    orderBy: { date: 'asc' },
  })

  const byKey = new Map<string, SaleReceipt>()
  for (const r of rows) {
    // A row with no reference is its own sale; it cannot be grouped with anything.
    const key = r.reference ?? `id:${r.id}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        token: r.publicToken, reference: r.reference, primaryId: r.id, date: r.date,
        customer: r.customer?.name ?? r.customer?.phone ?? null,
        total: r.total, methods: r.method ? [r.method] : [], rowCount: 1,
      })
      continue
    }
    existing.total = Math.round((existing.total + r.total) * 100) / 100
    if (r.method && !existing.methods.includes(r.method)) existing.methods.push(r.method)
    if (r.publicToken && !existing.token) existing.token = r.publicToken
    existing.rowCount++
  }
  return [...byKey.values()]
}

export interface ExpenseDocument {
  id: string
  url: string
  kind: string
  contentType: string
  caption: string | null
  createdAt: Date
}

export interface ExpenseRecord {
  id: string
  date: Date
  category: string
  vendor: string | null
  amount: number
  notes: string | null
  paid: boolean
  documents: ExpenseDocument[]
}

/**
 * Every expense in the period with whatever has been filed against it.
 *
 * Expenses WITHOUT a document are the point of the screen, so they are returned
 * alongside the rest rather than filtered out — a folder that only shows what
 * you remembered to file cannot tell you what you forgot.
 */
export async function expenseRecordsForPeriod(period: Period): Promise<ExpenseRecord[]> {
  const { start, end } = periodRange(period)
  const expenses = await db.expense.findMany({
    where: { date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
  })
  if (expenses.length === 0) return []

  const assets = await db.mediaAsset.findMany({
    where: { ownerType: 'expense', ownerId: { in: expenses.map(e => e.id) } },
    select: { id: true, url: true, kind: true, contentType: true, caption: true, createdAt: true, ownerId: true },
    orderBy: { createdAt: 'asc' },
  })
  const byExpense = new Map<string, ExpenseDocument[]>()
  for (const a of assets) {
    const list = byExpense.get(a.ownerId) ?? []
    list.push({ id: a.id, url: a.url, kind: a.kind, contentType: a.contentType, caption: a.caption, createdAt: a.createdAt })
    byExpense.set(a.ownerId, list)
  }

  return expenses.map(e => ({
    id: e.id, date: e.date, category: e.category, vendor: e.vendor,
    amount: e.amount, notes: e.notes, paid: e.paid,
    documents: byExpense.get(e.id) ?? [],
  }))
}

export interface PeriodSummary {
  period: Period
  salesCount: number
  salesTotal: number
  expenseCount: number
  expenseTotal: number
  /** Expenses with at least one document filed. */
  documented: number
  documentedTotal: number
}

export function summarise(period: Period, receipts: SaleReceipt[], expenses: ExpenseRecord[]): PeriodSummary {
  const round = (n: number) => Math.round(n * 100) / 100
  const documented = expenses.filter(e => e.documents.length > 0)
  return {
    period,
    salesCount: receipts.length,
    salesTotal: round(receipts.reduce((s, r) => s + r.total, 0)),
    expenseCount: expenses.length,
    expenseTotal: round(expenses.reduce((s, e) => s + e.amount, 0)),
    documented: documented.length,
    // Coverage by VALUE, not just by count: twenty small documented expenses and
    // one large undocumented one is not 95% covered in any sense the owner cares
    // about at close.
    documentedTotal: round(documented.reduce((s, e) => s + e.amount, 0)),
  }
}

/**
 * The periods worth offering, newest first — every month that has a sale or an
 * expense in it, plus the current one so a fresh month is never missing.
 */
export async function availablePeriods(): Promise<Period[]> {
  const [txn, exp] = await Promise.all([
    db.transaction.findMany({ select: { date: true }, orderBy: { date: 'desc' } }),
    db.expense.findMany({ select: { date: true }, orderBy: { date: 'desc' } }),
  ])
  const set = new Set<string>([periodOf(new Date())])
  for (const r of [...txn, ...exp]) set.add(periodOf(r.date))
  return [...set].sort().reverse()
}
