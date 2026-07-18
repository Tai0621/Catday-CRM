import { db } from './db'
import { REVENUE_CATEGORIES } from './constants'

// Mirrors the owner's "CATDAY Income Statement.xlsx":
// Revenue → Cost of Services (variable) → Gross Profit → Operating Expenses
// (fixed) → EBITDA → Tax → Net Income, with monthly columns.

export const TAX_RATE = 0.24 // Malaysian corporate rate, per the model's assumptions

// Expense categories from the Excel's OPEX BASE, split the way its
// Income Statement sheet splits them.
export const COGS_CATEGORIES = ['Grooming Supplies', 'Food & Litter', 'Vet Visit', 'Retail Stock'] as const
export const OPEX_CATEGORIES = ['Rent', 'Salaries', 'Cleaning Supplies', 'Utilities', 'Marketing', 'Maintenance', 'Other Expense'] as const
export const EXPENSE_CATEGORIES = [...COGS_CATEGORIES, ...OPEX_CATEGORIES] as const
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// One row of the statement: a label + 12 monthly values + year total.
// key: leaf rows the accountant can hard-key (blue); derived rows have none.
// overridden[m]: true where the value is a manual entry replacing the OS figure.
// autoValues[m]: what the OS says, kept for "revert" tooltips.
export type StatementRow = {
  label: string
  values: number[]
  total: number
  key?: string
  overridden?: boolean[]
  autoValues?: number[]
}

export const statementRowKeys = (): string[] => [
  ...REVENUE_CATEGORIES.map(c => `rev:${c}`),
  ...COGS_CATEGORIES.map(c => `cogs:${c}`),
  ...OPEX_CATEGORIES.map(c => `opex:${c}`),
  'tax',
]

export type IncomeStatement = {
  year: number
  months: string[]
  revenue: StatementRow[]
  totalRevenue: StatementRow
  cogs: StatementRow[]
  totalCogs: StatementRow
  grossProfit: StatementRow
  grossMarginPct: number[]          // per month, -1 where no revenue
  opex: StatementRow[]
  totalOpex: StatementRow
  ebitda: StatementRow
  ebitdaMarginPct: number[]
  tax: StatementRow
  netIncome: StatementRow
  cumulativeNet: number[]
  yearGrossMarginPct: number | null
  yearEbitdaMarginPct: number | null
  yearNetMarginPct: number | null
  availableYears: number[]
}

const row = (label: string, values: number[]): StatementRow => ({
  label,
  values,
  total: Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100,
})
const blank12 = () => Array.from({ length: 12 }, () => 0)
const addRows = (label: string, rows: StatementRow[]): StatementRow =>
  row(label, blank12().map((_, m) => rows.reduce((s, r) => s + r.values[m], 0)))

export async function buildIncomeStatement(year: number): Promise<IncomeStatement> {
  const from = new Date(year, 0, 1)
  const to = new Date(year + 1, 0, 1)

  const [txns, expenses, overrides, firstTxn, firstExp, firstCell] = await Promise.all([
    db.transaction.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, total: true, category: true } }),
    db.expense.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, category: true } }),
    db.statementCell.findMany({ where: { year }, select: { month: true, rowKey: true, amount: true } }),
    db.transaction.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
    db.expense.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
    db.statementCell.findFirst({ orderBy: { year: 'asc' }, select: { year: true } }),
  ])

  // Accountant's hard-keyed cells (blue) replace the OS figure for that month
  const ovr = new Map<string, number>()
  for (const o of overrides) ovr.set(`${o.rowKey}|${o.month}`, o.amount)
  const applyOvr = (key: string, label: string, auto: number[]): StatementRow => {
    const overridden = auto.map((_, m) => ovr.has(`${key}|${m}`))
    const values = auto.map((v, m) => (overridden[m] ? ovr.get(`${key}|${m}`)! : v))
    return { ...row(label, values), key, overridden, autoValues: auto }
  }

  // ── Revenue by stream (live from the same transactions the POS writes) ──
  const revMap = new Map<string, number[]>(REVENUE_CATEGORIES.map(c => [c, blank12()]))
  for (const t of txns) {
    const key = (REVENUE_CATEGORIES as readonly string[]).includes(t.category) ? t.category : 'Other'
    revMap.get(key)![t.date.getMonth()] += t.total
  }
  const revenue = REVENUE_CATEGORIES.map(c => applyOvr(`rev:${c}`, `${c} Revenue`, revMap.get(c)!))
  const totalRevenue = addRows('Total Revenue', revenue)

  // ── Expenses, split variable vs fixed per the Excel ──
  const expMap = new Map<string, number[]>(EXPENSE_CATEGORIES.map(c => [c, blank12()]))
  for (const e of expenses) {
    const key = (EXPENSE_CATEGORIES as readonly string[]).includes(e.category) ? e.category : 'Other Expense'
    expMap.get(key)![e.date.getMonth()] += e.amount
  }
  const cogs = COGS_CATEGORIES.map(c => applyOvr(`cogs:${c}`, c, expMap.get(c)!))
  const totalCogs = addRows('Total Cost of Services', cogs)
  const opex = OPEX_CATEGORIES.map(c => applyOvr(`opex:${c}`, c, expMap.get(c)!))
  const totalOpex = addRows('Total Operating Expenses', opex)

  // ── Derived lines ──
  const grossProfit = row('Gross Profit', blank12().map((_, m) => totalRevenue.values[m] - totalCogs.values[m]))
  const ebitda = row('EBITDA (Operating Income)', blank12().map((_, m) => grossProfit.values[m] - totalOpex.values[m]))
  // Provision: 24% of each profitable month (actual LHDN computation is annual);
  // the accountant can hard-key the real assessed figure per month.
  const taxAuto = ebitda.values.map(v => (v > 0 ? Math.round(v * TAX_RATE * 100) / 100 : 0))
  const tax = applyOvr('tax', 'Tax Provision @ 24%', taxAuto)
  const netIncome = row('Net Income', blank12().map((_, m) => ebitda.values[m] - tax.values[m]))

  const cumulativeNet: number[] = []
  netIncome.values.reduce((acc, v, i) => { cumulativeNet[i] = Math.round((acc + v) * 100) / 100; return cumulativeNet[i] }, 0)

  const pct = (num: number[], den: number[]) => num.map((v, i) => (den[i] > 0 ? Math.round((v / den[i]) * 1000) / 10 : -1))
  const yearPct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)

  // Year switcher: every year between the first recorded figure and now
  const nowYear = new Date().getFullYear()
  const earliest = Math.min(
    firstTxn?.date.getFullYear() ?? nowYear,
    firstExp?.date.getFullYear() ?? nowYear,
    firstCell?.year ?? nowYear,
  )
  const availableYears = Array.from({ length: nowYear - earliest + 1 }, (_, i) => earliest + i)

  return {
    year,
    months: MONTH_LABELS,
    revenue, totalRevenue,
    cogs, totalCogs,
    grossProfit,
    grossMarginPct: pct(grossProfit.values, totalRevenue.values),
    opex, totalOpex,
    ebitda,
    ebitdaMarginPct: pct(ebitda.values, totalRevenue.values),
    tax, netIncome, cumulativeNet,
    yearGrossMarginPct: yearPct(grossProfit.total, totalRevenue.total),
    yearEbitdaMarginPct: yearPct(ebitda.total, totalRevenue.total),
    yearNetMarginPct: yearPct(netIncome.total, totalRevenue.total),
    availableYears,
  }
}

// CSV export — opens straight in Excel, mirroring the statement layout.
export function statementToCsv(s: IncomeStatement): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const num = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
  const line = (r: StatementRow) => [r.label, ...r.values.map(num), num(r.total)].map(esc).join(',')
  const pctLine = (label: string, values: number[], yearVal: number | null) =>
    [label, ...values.map(v => (v < 0 ? '' : `${v}%`)), yearVal == null ? '' : `${yearVal}%`].map(esc).join(',')

  const out: string[] = []
  out.push(`CAT DAY — Income Statement ${s.year} (RM)`)
  out.push(['', ...s.months, 'Year Total'].join(','))
  out.push('REVENUE')
  for (const r of s.revenue) out.push(line(r))
  out.push(line(s.totalRevenue))
  out.push('')
  out.push('COST OF SERVICES (Variable)')
  for (const r of s.cogs) out.push(line(r))
  out.push(line(s.totalCogs))
  out.push(line(s.grossProfit))
  out.push(pctLine('Gross Margin %', s.grossMarginPct, s.yearGrossMarginPct))
  out.push('')
  out.push('OPERATING EXPENSES (Fixed)')
  for (const r of s.opex) out.push(line(r))
  out.push(line(s.totalOpex))
  out.push('')
  out.push(line(s.ebitda))
  out.push(pctLine('EBITDA Margin %', s.ebitdaMarginPct, s.yearEbitdaMarginPct))
  out.push(line(s.tax))
  out.push(line(s.netIncome))
  out.push(['Cumulative Net Income', ...s.cumulativeNet.map(num), num(s.netIncome.total)].join(','))
  return out.join('\r\n')
}
