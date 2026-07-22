import { db } from './db'
import { buildIncomeStatement } from './finance'
import { payablesTotal } from './aging'
import { fetchAssetCores, fixedAssetsNBV } from './assets'

// The Balance Sheet — a finance-only overlay. It READS operational data
// (unpaid appointments, the wallet ledger, the income statement) but never
// writes it, and lets the accountant hard-key the rest (cash, inventory,
// fixed assets, loans, capital, opening balances). Nothing here changes what
// operations & sales shows.

export type BSLine = {
  key: string
  label: string
  value: number
  auto: boolean          // true = derived live from the OS (black); false = accountant-keyed (blue)
  hint?: string          // for keyed lines: a computed suggestion
}
export type BSSection = { title: string; lines: BSLine[]; subtotal: number }
export type BalanceSheet = {
  asOf: string
  asOfLabel: string
  assets: BSSection[]
  liabilities: BSSection[]
  equity: BSSection[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  check: number          // assets − (liabilities + equity); 0 = balanced
  balanced: boolean
  availableMonths: string[]
}

// Keyed line definitions (blue). Auto lines are injected by the builder.
const KEYED = {
  assets: {
    'Current Assets': [
      { key: 'a.cash', label: 'Cash & bank' },
      { key: 'a.inventory', label: 'Inventory (at cost)' },
      { key: 'a.prepaid', label: 'Prepayments & deposits paid' },
      { key: 'a.otherCurrent', label: 'Other current assets' },
    ],
    'Non-current Assets': [
      { key: 'a.fixedAssets', label: 'Fixed assets (net of depreciation)' },
      { key: 'a.otherNonCurrent', label: 'Other non-current assets' },
    ],
  },
  liabilities: {
    'Current Liabilities': [
      { key: 'l.payables', label: 'Accounts payable' },
      { key: 'l.deposits', label: 'Unearned booking deposits' },
      { key: 'l.otherCurrent', label: 'Other current liabilities' },
    ],
    'Non-current Liabilities': [
      { key: 'l.loans', label: 'Loans & borrowings' },
    ],
  },
  equity: {
    'Equity': [
      { key: 'e.capital', label: 'Owner capital' },
      { key: 'e.openingRetained', label: 'Opening retained earnings' },
    ],
  },
}

const r2 = (v: number) => Math.round(v * 100) / 100
const monthEnd = (asOf: string) => { const [y, m] = asOf.split('-').map(Number); return new Date(y, m, 1) } // first of next month = exclusive upper bound
const rm = (v: number) => `RM ${Math.round(v).toLocaleString('en-MY')}`

export async function buildBalanceSheet(asOf: string): Promise<BalanceSheet> {
  const end = monthEnd(asOf) // exclusive
  const [y, m] = asOf.split('-').map(Number)

  const [cells, unpaidAppts, walletAgg, futureDeposits, payables, products, firstTxn, firstExp, assetCores] = await Promise.all([
    db.balanceSheetCell.findMany({ where: { asOf }, select: { lineKey: true, amount: true } }),
    // Accounts receivable: completed but unpaid, up to the as-of date
    db.appointment.findMany({
      where: { status: 'Completed', paid: false, price: { not: null }, scheduledAt: { lt: end } },
      select: { price: true },
    }),
    // Wallet liability: the stored-value ledger balance as of the date
    db.walletEntry.aggregate({ _sum: { amount: true }, where: { createdAt: { lt: end } } }),
    // Hint for unearned deposits: deposits on bookings not yet fulfilled by the date
    db.appointment.findMany({
      where: { depositRM: { not: null }, paid: false, status: { notIn: ['Cancelled', 'NoShow', 'Completed'] }, OR: [{ endsAt: { gte: end } }, { endsAt: null, scheduledAt: { gte: end } }] },
      select: { depositRM: true },
    }),
    payablesTotal(end), // unpaid expenses as of the date
    db.product.findMany({ where: { active: true }, select: { stockQty: true, costPrice: true } }),
    db.transaction.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
    db.expense.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
    fetchAssetCores(),
  ])
  const fixedAssets = assetCores

  const keyed = new Map(cells.map(c => [c.lineKey, c.amount]))
  const receivables = r2(unpaidAppts.reduce((s, a) => s + (a.price ?? 0), 0))
  const inventoryAtCost = r2(products.reduce((s, p) => s + p.stockQty * p.costPrice, 0))
  const walletLiability = r2(walletAgg._sum.amount ?? 0)
  const depositHint = r2(futureDeposits.reduce((s, a) => s + (a.depositRM ?? 0), 0))

  // Retained earnings from the OS: cumulative net income across recorded years,
  // and this year split into "prior years" (auto opening) vs "current year".
  const earliest = Math.min(firstTxn?.date.getFullYear() ?? y, firstExp?.date.getFullYear() ?? y)
  let priorYearsNet = 0
  let currentYearNet = 0
  for (let yr = earliest; yr <= y; yr++) {
    const is = await buildIncomeStatement(yr)
    if (yr < y) {
      priorYearsNet += is.netIncome.total
    } else {
      // only months up to and including the as-of month
      currentYearNet += is.netIncome.values.slice(0, m).reduce((s, v) => s + v, 0)
    }
  }
  priorYearsNet = r2(priorYearsNet)
  currentYearNet = r2(currentYearNet)

  // ── assemble sections ──
  const keyedLine = (key: string, label: string, hint?: string): BSLine =>
    ({ key, label, value: r2(keyed.get(key) ?? 0), auto: false, hint })
  const autoLine = (key: string, label: string, value: number): BSLine =>
    ({ key, label, value: r2(value), auto: true })

  const section = (title: string, lines: BSLine[]): BSSection =>
    ({ title, lines, subtotal: r2(lines.reduce((s, l) => s + l.value, 0)) })

  const assets: BSSection[] = [
    section('Current Assets', [
      keyedLine('a.cash', 'Cash & bank'),
      autoLine('a.receivables', 'Accounts receivable', receivables),
      autoLine('a.inventory', 'Inventory (at cost)', inventoryAtCost),
      keyedLine('a.prepaid', 'Prepayments & deposits paid'),
      keyedLine('a.otherCurrent', 'Other current assets'),
    ]),
    // Fixed assets come from the Asset Register once it's in use (net book value,
    // black/auto). While the register is empty, the line stays accountant-keyed
    // so nothing changes for a business that hasn't adopted it yet.
    section('Non-current Assets', [
      fixedAssets.length > 0
        ? autoLine('a.fixedAssets', 'Fixed assets (net of depreciation)', fixedAssetsNBV(fixedAssets, asOf))
        : keyedLine('a.fixedAssets', 'Fixed assets (net of depreciation)'),
      keyedLine('a.otherNonCurrent', 'Other non-current assets'),
    ]),
  ]

  const liabilities: BSSection[] = [
    section('Current Liabilities', [
      autoLine('l.payables', 'Accounts payable', payables),
      autoLine('l.wallet', 'Customer wallet balances', walletLiability),
      keyedLine('l.deposits', 'Unearned booking deposits', depositHint > 0 ? `unfulfilled deposits ≈ ${rm(depositHint)}` : undefined),
      keyedLine('l.otherCurrent', 'Other current liabilities'),
    ]),
    section('Non-current Liabilities', [keyedLine('l.loans', 'Loans & borrowings')]),
  ]

  const osRetained = r2(priorYearsNet + currentYearNet)
  const equity: BSSection[] = [
    section('Equity', [
      keyedLine('e.capital', 'Owner capital'),
      keyedLine('e.openingRetained', 'Retained earnings — opening (pre-system)'),
      autoLine('e.osRetained', 'Retained earnings — recorded in system', osRetained),
    ]),
  ]

  const totalAssets = r2(assets.reduce((s, sec) => s + sec.subtotal, 0))
  const totalLiabilities = r2(liabilities.reduce((s, sec) => s + sec.subtotal, 0))
  const totalEquity = r2(equity.reduce((s, sec) => s + sec.subtotal, 0))
  const check = r2(totalAssets - (totalLiabilities + totalEquity))

  // Selectable month-ends: from the first recorded month to the current month
  const now = new Date()
  const months: string[] = []
  for (let yr = earliest; yr <= now.getFullYear(); yr++) {
    const lastM = yr === now.getFullYear() ? now.getMonth() + 1 : 12
    for (let mm = 1; mm <= lastM; mm++) months.push(`${yr}-${String(mm).padStart(2, '0')}`)
  }

  return {
    asOf,
    asOfLabel: new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' }),
    assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity,
    check, balanced: Math.abs(check) < 0.5,
    availableMonths: months.reverse(),
  }
}

// Keys the accountant may hard-key (guard for the save action)
export const KEYED_BS_KEYS = [
  'a.cash', 'a.prepaid', 'a.otherCurrent', 'a.fixedAssets', 'a.otherNonCurrent',
  'l.deposits', 'l.otherCurrent', 'l.loans',
  'e.capital', 'e.openingRetained',
]

export function balanceSheetToCsv(bs: BalanceSheet): string {
  const num = (v: number) => (v < 0 ? `(${Math.abs(Math.round(v))})` : String(Math.round(v)))
  const out: string[] = [`CAT DAY — Balance Sheet as at end ${bs.asOfLabel} (RM)`, '']
  const block = (secs: BSSection[], heading: string, totalLabel: string, total: number) => {
    out.push(heading)
    for (const sec of secs) {
      out.push(sec.title)
      for (const l of sec.lines) out.push(`${l.label},${num(l.value)}`)
      out.push(`  ${sec.title} subtotal,${num(sec.subtotal)}`)
    }
    out.push(`${totalLabel},${num(total)}`, '')
  }
  block(bs.assets, 'ASSETS', 'TOTAL ASSETS', bs.totalAssets)
  block(bs.liabilities, 'LIABILITIES', 'TOTAL LIABILITIES', bs.totalLiabilities)
  block(bs.equity, 'EQUITY', 'TOTAL EQUITY', bs.totalEquity)
  out.push(`Liabilities + Equity,${num(bs.totalLiabilities + bs.totalEquity)}`)
  out.push(`Balance check (Assets − L − E),${num(bs.check)}`)
  return out.join('\r\n')
}
