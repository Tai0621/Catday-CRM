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

  // Aggregate by month + category
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
        <h1 className="text-xl font-bold text-gray-900">Revenue</h1>
        <div className="flex gap-2 text-sm">
          {[3, 6, 12].map(m => (
            <a key={m} href={`?months=${m}`}
              className={`px-3 py-1.5 rounded-lg border ${months === m ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {m}m
            </a>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 col-span-2 md:col-span-1">
          <div className="text-xs text-gray-400 mb-1">Total</div>
          <div className="text-xl font-bold text-gray-900">RM {totalRevenue.toFixed(0)}</div>
        </div>
        {REVENUE_CATEGORIES.map(cat => (
          <div key={cat} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-400 mb-1">{cat}</div>
            <div className="text-lg font-bold text-gray-900">RM {(byCategory[cat] ?? 0).toFixed(0)}</div>
            <div className="text-xs text-gray-400">{totalRevenue > 0 ? ((byCategory[cat] ?? 0) / totalRevenue * 100).toFixed(1) : 0}%</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Monthly Breakdown</h2>
          <RevenueChart data={chartData} categories={REVENUE_CATEGORIES as unknown as string[]} />
        </div>
      )}

      {/* Recent transactions */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Transactions</h2>
          <a href="/revenue/new" className="text-xs bg-rose-600 text-white px-3 py-1.5 rounded-lg hover:bg-rose-700">+ Add</a>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Category</th>
              <th className="px-4 py-3 text-left">Reference</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {transactions.slice(-20).reverse().map(tx => (
              <tr key={tx.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-600">{tx.date.toLocaleDateString('en-MY')}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${categoryClass(tx.category)}`}>{tx.category}</span>
                </td>
                <td className="px-4 py-2 text-gray-500">{tx.reference ?? '—'}</td>
                <td className="px-4 py-2 text-right font-medium">RM {tx.total.toFixed(2)}</td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No transactions yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function categoryClass(cat: string) {
  const m: Record<string, string> = {
    Grooming: 'bg-rose-100 text-rose-700',
    Boarding: 'bg-blue-100 text-blue-700',
    Membership: 'bg-purple-100 text-purple-700',
    Academy: 'bg-amber-100 text-amber-700',
    Other: 'bg-gray-100 text-gray-600',
  }
  return m[cat] ?? 'bg-gray-100 text-gray-600'
}
