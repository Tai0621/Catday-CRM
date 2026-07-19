import { db } from './db'

// Accounts Receivable (money owed to us by customers) and Accounts Payable
// (money we owe suppliers), with standard aging buckets. A/R comes from unpaid
// completed appointments; A/P from unpaid expenses. Read-only over operations.

const DAY = 24 * 60 * 60 * 1000

export type AgingBucket = 'current' | 'd3160' | 'd6190' | 'd90'
export const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: '0–30 days', d3160: '31–60 days', d6190: '61–90 days', d90: '90+ days',
}
export function bucketOf(days: number): AgingBucket {
  if (days <= 30) return 'current'
  if (days <= 60) return 'd3160'
  if (days <= 90) return 'd6190'
  return 'd90'
}
const emptyBuckets = (): Record<AgingBucket, number> => ({ current: 0, d3160: 0, d6190: 0, d90: 0 })
const r2 = (v: number) => Math.round(v * 100) / 100

// ── Accounts Receivable ──
export type ARItem = { apptId: string; catName: string; type: string; date: Date; amount: number; days: number; bucket: AgingBucket }
export type ARCustomer = {
  customerId: string; name: string; phone: string
  total: number; oldestDays: number; buckets: Record<AgingBucket, number>; items: ARItem[]
}
export type Receivables = { total: number; buckets: Record<AgingBucket, number>; customers: ARCustomer[] }

export async function buildReceivables(now = new Date()): Promise<Receivables> {
  const appts = await db.appointment.findMany({
    where: { status: 'Completed', paid: false, price: { not: null } },
    select: { id: true, price: true, scheduledAt: true, type: true, customerId: true,
      cat: { select: { name: true } }, customer: { select: { name: true, phone: true } } },
    orderBy: { scheduledAt: 'asc' },
  })

  const byCustomer = new Map<string, ARCustomer>()
  const buckets = emptyBuckets()
  let total = 0
  for (const a of appts) {
    const amount = r2(a.price ?? 0)
    const days = Math.max(0, Math.floor((now.getTime() - a.scheduledAt.getTime()) / DAY))
    const bucket = bucketOf(days)
    total = r2(total + amount)
    buckets[bucket] = r2(buckets[bucket] + amount)
    let c = byCustomer.get(a.customerId)
    if (!c) {
      c = { customerId: a.customerId, name: a.customer.name ?? a.customer.phone, phone: a.customer.phone,
        total: 0, oldestDays: 0, buckets: emptyBuckets(), items: [] }
      byCustomer.set(a.customerId, c)
    }
    c.total = r2(c.total + amount)
    c.oldestDays = Math.max(c.oldestDays, days)
    c.buckets[bucket] = r2(c.buckets[bucket] + amount)
    c.items.push({ apptId: a.id, catName: a.cat.name, type: a.type, date: a.scheduledAt, amount, days, bucket })
  }
  const customers = [...byCustomer.values()].sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total)
  return { total, buckets, customers }
}

// One customer's receivable (for the customer detail page)
export async function customerReceivable(customerId: string, now = new Date()): Promise<{ total: number; items: ARItem[] }> {
  const appts = await db.appointment.findMany({
    where: { customerId, status: 'Completed', paid: false, price: { not: null } },
    select: { id: true, price: true, scheduledAt: true, type: true, cat: { select: { name: true } } },
    orderBy: { scheduledAt: 'asc' },
  })
  let total = 0
  const items: ARItem[] = appts.map(a => {
    const amount = r2(a.price ?? 0)
    const days = Math.max(0, Math.floor((now.getTime() - a.scheduledAt.getTime()) / DAY))
    total = r2(total + amount)
    return { apptId: a.id, catName: a.cat.name, type: a.type, date: a.scheduledAt, amount, days, bucket: bucketOf(days) }
  })
  return { total, items }
}

// Customers with any outstanding balance → { customerId: total } (for the list)
export async function receivableByCustomer(): Promise<Map<string, number>> {
  const appts = await db.appointment.findMany({
    where: { status: 'Completed', paid: false, price: { not: null } },
    select: { customerId: true, price: true },
  })
  const m = new Map<string, number>()
  for (const a of appts) m.set(a.customerId, r2((m.get(a.customerId) ?? 0) + (a.price ?? 0)))
  return m
}

// ── Accounts Payable ──
export type APItem = {
  expenseId: string; vendor: string | null; category: string; amount: number
  date: Date; dueDate: Date | null; days: number; bucket: AgingBucket; overdue: boolean
}
export type Payables = { total: number; buckets: Record<AgingBucket, number>; items: APItem[] }

export async function buildPayables(now = new Date()): Promise<Payables> {
  const expenses = await db.expense.findMany({
    where: { paid: false },
    select: { id: true, vendor: true, category: true, amount: true, date: true, dueDate: true },
    orderBy: [{ dueDate: 'asc' }, { date: 'asc' }],
  })
  const buckets = emptyBuckets()
  let total = 0
  const items: APItem[] = expenses.map(e => {
    const amount = r2(e.amount)
    const ref = e.dueDate ?? e.date // age from due date, else the expense date
    const days = Math.max(0, Math.floor((now.getTime() - ref.getTime()) / DAY))
    const bucket = bucketOf(days)
    total = r2(total + amount)
    buckets[bucket] = r2(buckets[bucket] + amount)
    return { expenseId: e.id, vendor: e.vendor, category: e.category, amount, date: e.date, dueDate: e.dueDate,
      days, bucket, overdue: e.dueDate != null && e.dueDate < now }
  })
  return { total, buckets, items }
}

// Total unpaid expenses (for the balance sheet's payables line)
export async function payablesTotal(asOf?: Date): Promise<number> {
  const agg = await db.expense.aggregate({
    _sum: { amount: true },
    where: { paid: false, ...(asOf ? { date: { lt: asOf } } : {}) },
  })
  return r2(agg._sum.amount ?? 0)
}
