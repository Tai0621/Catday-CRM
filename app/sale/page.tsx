import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { spendWallet } from '@/lib/wallet'
import { REVENUE_CATEGORIES, PAY_METHODS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'

const DAY = 24 * 60 * 60 * 1000

// Quick sale — walk-in retail, add-ons, anything sold over the counter.
// Creates a revenue transaction with a payment method (feeds the cash-up).
export default async function QuickSalePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireAuth()
  const { err } = await searchParams
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [customers, todaySales] = await Promise.all([
    db.customer.findMany({ orderBy: { name: 'asc' } }),
    db.transaction.findMany({
      where: { date: { gte: todayStart, lt: new Date(todayStart.getTime() + DAY) } },
      include: { customer: true },
      orderBy: { date: 'desc' },
      take: 20,
    }),
  ])

  async function recordSale(data: FormData) {
    'use server'
    const total = parseFloat((data.get('total') as string) || '0')
    const method = (data.get('method') as string) || 'Cash'
    const customerId = (data.get('customerId') as string) || null
    const description = ((data.get('description') as string) ?? '').trim()
    if (total <= 0) return

    if (method === 'Wallet') {
      if (!customerId) redirect('/sale?err=wallet-customer')
      try {
        await spendWallet(customerId!, total, description || 'Quick sale')
      } catch {
        redirect('/sale?err=wallet-balance')
      }
    }
    await db.transaction.create({
      data: {
        customerId,
        date: new Date(),
        total,
        category: (data.get('category') as string) || 'Retail',
        method,
        notes: description || null,
      },
    })
    redirect('/sale')
  }

  const todayTotal = todaySales.reduce((s, t) => s + t.total, 0)
  const seg = SEGMENTS.business

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Quick Sale
        </h1>
        <p className="text-sm cd-muted">Walk-in retail and over-the-counter charges. Wallet payments deduct the customer&apos;s stored value.</p>
      </div>

      {err === 'wallet-customer' && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}>
          Wallet payments need a customer selected.
        </div>
      )}
      {err === 'wallet-balance' && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}>
          Not enough wallet balance — nothing was charged.
        </div>
      )}

      <form action={recordSale} className="cd-card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Amount (RM) *</label>
            <input name="total" type="number" min="0.01" step="0.01" required className="cd-input" placeholder="0.00" autoFocus />
          </div>
          <div>
            <label className="cd-label">Payment method *</label>
            <select name="method" className="cd-input">
              {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Category</label>
            <select name="category" defaultValue="Retail" className="cd-input">
              {REVENUE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Customer (needed for Wallet)</label>
            <select name="customerId" className="cd-input">
              <option value="">Walk-in / anonymous</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="cd-label">What was sold</label>
          <input name="description" className="cd-input" placeholder="e.g. OKANA gift box · shampoo 250ml" />
        </div>
        <button type="submit" className="cd-btn w-full">Record sale</button>
      </form>

      <section>
        <h2 className="font-semibold mb-2 text-sm" style={{ color: '#2D1907' }}>
          Today&apos;s sales <span className="cd-muted font-normal">· RM {todayTotal.toFixed(2)}</span>
        </h2>
        <div className="cd-card overflow-hidden">
          {todaySales.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">Nothing recorded today yet</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="cd-tbody">
                {todaySales.map(t => (
                  <tr key={t.id}>
                    <td className="px-4 py-2 cd-muted">{t.date.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-2" style={{ color: '#2D1907' }}>{t.notes ?? t.category}</td>
                    <td className="px-4 py-2 cd-muted">{t.customer?.name ?? 'Walk-in'}</td>
                    <td className="px-4 py-2">
                      <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.6)' }}>{t.method ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold" style={{ color: '#2D1907' }}>RM {t.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
