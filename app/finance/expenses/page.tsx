import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { COGS_CATEGORIES, OPEX_CATEGORIES } from '@/lib/finance'
import { SEGMENTS } from '@/lib/segments'

// Cost entry for the income statement: variable costs (cost of services)
// and fixed operating expenses, per the owner's Excel model.
export default async function ExpensesPage() {
  await requireManager()
  const seg = SEGMENTS.business

  const expenses = await db.expense.findMany({ orderBy: { date: 'desc' }, take: 60 })

  async function addExpense(data: FormData) {
    'use server'
    const amount = parseFloat((data.get('amount') as string) || '0')
    const dateStr = (data.get('date') as string) || ''
    const category = (data.get('category') as string) || ''
    if (!(amount > 0) || !dateStr || !category) return
    await db.expense.create({
      data: {
        date: new Date(`${dateStr}T12:00:00`),
        category,
        amount: Math.round(amount * 100) / 100,
        notes: ((data.get('notes') as string) || '').trim() || null,
      },
    })
    revalidatePath('/finance/expenses')
    redirect('/finance/expenses')
  }

  async function removeExpense(data: FormData) {
    'use server'
    await db.expense.delete({ where: { id: data.get('id') as string } })
    revalidatePath('/finance/expenses')
  }

  // Group listing by month for scanning
  const byMonth = new Map<string, typeof expenses>()
  for (const e of expenses) {
    const k = e.date.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
    if (!byMonth.has(k)) byMonth.set(k, [])
    byMonth.get(k)!.push(e)
  }
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Expenses
          </h1>
          <p className="text-sm cd-muted">Costs recorded here flow straight into the <Link href="/finance/income-statement" className="cd-link">Income Statement</Link>.</p>
        </div>
        <Link href="/finance/income-statement" className="cd-btn-sec text-sm">Income Statement →</Link>
      </div>

      <form action={addExpense} className="cd-card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Date *</label>
            <input name="date" type="date" required defaultValue={today} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Amount (RM) *</label>
            <input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" className="cd-input" />
          </div>
        </div>
        <div>
          <label className="cd-label">Category *</label>
          <select name="category" required className="cd-input">
            <optgroup label="Cost of Services (variable)">
              {COGS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
            <optgroup label="Operating Expenses (fixed)">
              {OPEX_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="cd-label">Notes</label>
          <input name="notes" placeholder="e.g. July rent · Maybank transfer" className="cd-input" />
        </div>
        <button type="submit" className="cd-btn">Record expense</button>
      </form>

      {expenses.length === 0 ? (
        <div className="cd-card py-12 text-center">
          <p className="cd-muted text-sm">Nothing recorded yet. Start with this month&apos;s rent and salaries — the income statement fills in as you go.</p>
        </div>
      ) : (
        [...byMonth.entries()].map(([month, list]) => {
          const monthTotal = list.reduce((s, e) => s + e.amount, 0)
          return (
            <section key={month}>
              <h2 className="font-semibold mb-2 text-sm" style={{ color: '#2D1907' }}>
                {month} <span className="cd-muted font-normal">· RM {monthTotal.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
              </h2>
              <div className="cd-card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="cd-tbody">
                    {list.map(e => (
                      <tr key={e.id}>
                        <td className="px-4 py-2 cd-muted whitespace-nowrap">{e.date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}</td>
                        <td className="px-4 py-2" style={{ color: '#2D1907' }}>
                          {e.category}
                          {e.notes && <span className="cd-muted"> · {e.notes}</span>}
                        </td>
                        <td className="px-4 py-2">
                          <span className="cd-pill" style={
                            (COGS_CATEGORIES as readonly string[]).includes(e.category)
                              ? { background: 'rgba(177,73,25,0.12)', color: '#B14919' }
                              : { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.55)' }
                          }>
                            {(COGS_CATEGORIES as readonly string[]).includes(e.category) ? 'variable' : 'fixed'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums whitespace-nowrap" style={{ color: '#2D1907' }}>
                          RM {e.amount.toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <form action={removeExpense}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" className="text-xs cd-muted hover:underline">remove</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
