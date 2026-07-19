import { requireManager } from '@/lib/auth'
import { buildBalanceSheet } from '@/lib/balance-sheet'
import { monthKey } from '@/lib/plan'
import { SEGMENTS } from '@/lib/segments'
import Link from 'next/link'
import { BalanceSheetTable } from './BalanceSheetTable'
import { StatementTabs } from '../StatementTabs'

// Balance Sheet — finance-only. Reads operations read-only (receivables, wallet
// ledger, income statement); the accountant keys the rest. Nothing written back
// to operations & sales.
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>
}) {
  await requireManager()
  const { asOf: asOfParam } = await searchParams
  const asOf = /^\d{4}-\d{2}$/.test(asOfParam ?? '') ? asOfParam! : monthKey(new Date())
  const bs = await buildBalanceSheet(asOf)
  const seg = SEGMENTS.business

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <StatementTabs />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Balance Sheet
          </h1>
          <p className="text-sm cd-muted">
            As at end of <strong>{bs.asOfLabel}</strong> · one of the three statements. Pairs with the{' '}
            <Link href="/finance/income-statement" className="cd-link">Income Statement</Link> and{' '}
            <Link href="/finance/cash-flow" className="cd-link">Cash Flow</Link>. All figures in RM.
          </p>
        </div>
        <a href={`/finance/balance-sheet/export?asOf=${bs.asOf}`} className="cd-btn text-sm">⤓ Export to Excel</a>
      </div>

      <MonthPicker current={bs.asOf} months={bs.availableMonths} />

      <BalanceSheetTable sheet={bs} />

      <p className="text-xs cd-muted">
        Read-only from operations — receivables (unpaid completed visits), customer wallet balances, and retained earnings
        (from the income statement) update automatically. The accountant keys cash, inventory, fixed assets, loans, capital
        and opening balances. These figures never change what Operations &amp; Sales shows.
      </p>
    </div>
  )
}

// Server-friendly month picker (chips) — avoids client JS for navigation
function MonthPicker({ current, months }: { current: string; months: string[] }) {
  const show = months.slice(0, 12)
  return (
    <div className="flex flex-wrap gap-1.5">
      {show.map(m => (
        <Link key={m} href={`/finance/balance-sheet?asOf=${m}`}
          className="text-xs px-2.5 py-1 rounded-lg"
          style={m === current
            ? { background: '#2D1907', color: '#ECDBB6', fontWeight: 600 }
            : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' }}>
          {monthLabelShort(m)}
        </Link>
      ))}
    </div>
  )
}

function monthLabelShort(m: string) {
  const [y, mm] = m.split('-').map(Number)
  return new Date(y, mm - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: '2-digit' })
}
