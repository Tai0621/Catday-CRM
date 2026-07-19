import { buildBalanceSheet, type BalanceSheet } from './balance-sheet'
import { buildIncomeStatement } from './finance'

// Cash Flow Statement — indirect method, derived from the movement between two
// balance sheets plus net income for the period. Because it's built from the
// balance-sheet deltas, ending cash necessarily ties back to the balance
// sheet's cash line (the integrity check every accountant runs at close).
// Finance-only: reads the other statements, writes nothing to operations.

export type CFLine = { label: string; value: number }
export type CFSection = { title: string; lines: CFLine[]; subtotal: number }
export type CashFlow = {
  from: string
  to: string
  fromLabel: string
  toLabel: string
  operating: CFSection
  investing: CFSection
  financing: CFSection
  netChange: number
  openingCash: number
  computedClosingCash: number
  balanceSheetClosingCash: number
  tie: number            // computed − balance-sheet cash; 0 = ties
  ties: boolean
  openBalanced: boolean
  closeBalanced: boolean
}

const r2 = (v: number) => Math.round(v * 100) / 100
const lineMap = (bs: BalanceSheet) =>
  new Map([...bs.assets, ...bs.liabilities, ...bs.equity].flatMap(s => s.lines.map(l => [l.key, l.value] as const)))
const label = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' }) }

export async function buildCashFlow(fromMonth: string, toMonth: string): Promise<CashFlow> {
  const [bsOpen, bsClose] = await Promise.all([buildBalanceSheet(fromMonth), buildBalanceSheet(toMonth)])
  const o = lineMap(bsOpen), c = lineMap(bsClose)
  const d = (k: string) => r2((c.get(k) ?? 0) - (o.get(k) ?? 0)) // change over the period

  // Net income across the period (month after `from` through `to`)
  const [fy, fmRaw] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  const isCache: Record<number, Awaited<ReturnType<typeof buildIncomeStatement>>> = {}
  let netIncome = 0
  let yy = fy, mm = fmRaw
  for (let guard = 0; guard < 240; guard++) {
    mm++; if (mm > 12) { mm = 1; yy++ }
    if (yy > ty || (yy === ty && mm > tm)) break
    if (!isCache[yy]) isCache[yy] = await buildIncomeStatement(yy)
    netIncome += isCache[yy].netIncome.values[mm - 1] ?? 0
  }
  netIncome = r2(netIncome)

  const sec = (title: string, lines: CFLine[]): CFSection =>
    ({ title, lines, subtotal: r2(lines.reduce((s, l) => s + l.value, 0)) })

  // Operating: net income, then working-capital movements
  const operating = sec('Operating activities', [
    { label: 'Net income for the period', value: netIncome },
    { label: '(Increase)/decrease in receivables', value: r2(-d('a.receivables')) },
    { label: '(Increase)/decrease in inventory', value: r2(-d('a.inventory')) },
    { label: '(Increase)/decrease in prepayments', value: r2(-d('a.prepaid')) },
    { label: '(Increase)/decrease in other current assets', value: r2(-d('a.otherCurrent')) },
    { label: 'Increase/(decrease) in payables', value: d('l.payables') },
    { label: 'Increase/(decrease) in customer wallet balances', value: d('l.wallet') },
    { label: 'Increase/(decrease) in unearned deposits', value: d('l.deposits') },
    { label: 'Increase/(decrease) in other current liabilities', value: d('l.otherCurrent') },
  ])

  // Investing: change in long-term assets (net of depreciation — see note)
  const investing = sec('Investing activities', [
    { label: 'Purchase/(disposal) of fixed assets', value: r2(-d('a.fixedAssets')) },
    { label: 'Other non-current assets', value: r2(-d('a.otherNonCurrent')) },
  ])

  // Financing: loans and owner capital
  const financing = sec('Financing activities', [
    { label: 'Loans drawn/(repaid)', value: d('l.loans') },
    { label: 'Owner capital injected/(withdrawn)', value: d('e.capital') },
  ])

  const netChange = r2(operating.subtotal + investing.subtotal + financing.subtotal)
  const openingCash = r2(o.get('a.cash') ?? 0)
  const computedClosingCash = r2(openingCash + netChange)
  const balanceSheetClosingCash = r2(c.get('a.cash') ?? 0)
  const tie = r2(computedClosingCash - balanceSheetClosingCash)

  return {
    from: fromMonth, to: toMonth, fromLabel: label(fromMonth), toLabel: label(toMonth),
    operating, investing, financing,
    netChange, openingCash, computedClosingCash, balanceSheetClosingCash,
    tie, ties: Math.abs(tie) < 0.5,
    openBalanced: bsOpen.balanced, closeBalanced: bsClose.balanced,
  }
}

export function cashFlowToCsv(cf: CashFlow): string {
  const num = (v: number) => (v < 0 ? `(${Math.abs(Math.round(v))})` : String(Math.round(v)))
  const out: string[] = [`CAT DAY — Cash Flow Statement`, `Period: end ${cf.fromLabel} → end ${cf.toLabel} (RM)`, '']
  for (const s of [cf.operating, cf.investing, cf.financing]) {
    out.push(s.title)
    for (const l of s.lines) out.push(`${l.label},${num(l.value)}`)
    out.push(`  Net cash from ${s.title.toLowerCase()},${num(s.subtotal)}`, '')
  }
  out.push(`Net change in cash,${num(cf.netChange)}`)
  out.push(`Opening cash,${num(cf.openingCash)}`)
  out.push(`Closing cash (computed),${num(cf.computedClosingCash)}`)
  out.push(`Closing cash (balance sheet),${num(cf.balanceSheetClosingCash)}`)
  out.push(`Tie check,${num(cf.tie)}`)
  return out.join('\r\n')
}
