import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { REVENUE_CATEGORIES } from '@/lib/constants'
import { RevenueChart } from './RevenueChart'

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ months?: string }> }) {
  await requireAuth()
  const { months: monthsStr } = await searchParams
  const months = parseInt(monthsStr ?? '6', 10)

  const since = new Date()
  since.setMonth(since.getMonth() - months)

  const transactions = await db.transaction.findMany({
    where: { date: { gte: since } },
    orderBy: { date: 'asc' },
  })

  const byMonthCategory: Record<string, Record<string, number>> = {}
  const byCategory: Record<string, number> = {}
  let totalRevenue = 0

  for (const tx of transactions) {
    const month = tx.date.toISOString().slice(0, 7)
    if (!byMonthCategory[month]) byMonthCategory[month] = {}
    byMonthCategory[month][tx.category] = (byMonthCategory[month][tx.category] ?? 0) + tx.total
    byCategory[tx.category] = (byCategory[tx.category] ?? 0) + tx.total
    totalRevenue += tx.total
  }

  const chartData = Object.entries(byMonthCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cats]) => ({ month, ...cats }))

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Revenue</h1>
        <div className="flex gap-2 text-sm">
          {[3, 6, 12].map(m => (
            <a key={m} href={`?months=${m}`}
              className="px-3 py-1.5 rounded-lg transition-colors"
              style={months === m
                ? { background: '#B14919', color: '#ECDBB6', border: '1px solid #B14919' }
                : { background: 'rgba(45,25,7,0.07)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }
              }>
              {m}m
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="cd-card px-4 py-3 col-span-2 md:col-span-1">
          <div className="text-xs cd-muted mb-1">Total</div>
          <div className="text-xl font-bold" style={{ color: '#2D1907' }}>RM {totalRevenue.toFixed(0)}</div>
        </div>
        {REVENUE_CATEGORIES.map(cat => (
          <div key={cat} className="cd-card px-4 py-3">
            <div className="text-xs cd-muted mb-1">{cat}</div>
            <div className="text-lg font-bold" style={{ color: '#2D1907' }}>RM {(byCategory[cat] ?? 0).toFixed(0)}</div>
            <div className="text-xs cd-muted">{totalRevenue > 0 ? ((byCategory[cat] ?? 0) / totalRevenue * 100).toFixed(1) : 0}%</div>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <div className="cd-card p-6">
          <h2 className="font-semibold mb-4" style={{ color: '#2D1907' }}>Monthly Breakdown</h2>
          <RevenueChart data={chartData} categories={REVENUE_CATEGORIES as unknown as string[]} />
        </div>
      )}

      <div className="cd-card overflow-hidden">
        <div className="cd-section-header">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Recent Transactions</h2>
          <a href="/revenue/new" className="cd-btn text-xs" style={{ padding: '0.35rem 0.75rem' }}>+ Add</a>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="cd-thead">
            <th>Date</th>
            <th>Category</th>
            <th>Reference</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr></thead>
          <tbody className="cd-tbody">
            {transactions.slice(-20).reverse().map(tx => (
              <tr key={tx.id}>
                <td className="px-4 py-2 cd-muted">{tx.date.toLocaleDateString('en-MY')}</td>
                <td className="px-4 py-2">
                  <span className="cd-pill" style={categoryStyle(tx.category)}>{tx.category}</span>
                </td>
                <td className="px-4 py-2 cd-muted">{tx.reference ?? '—'}</td>
                <td className="px-4 py-2 text-right font-medium" style={{ color: '#2D1907' }}>RM {tx.total.toFixed(2)}</td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center cd-muted">No transactions yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function categoryStyle(cat: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    Grooming:   { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Boarding:   { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    Membership: { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    Academy:    { background: 'rgba(45,25,7,0.1)', color: '#2D1907' },
    Other:      { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)' },
  }
  return m[cat] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)' }
}
