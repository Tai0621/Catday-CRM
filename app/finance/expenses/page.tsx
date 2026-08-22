import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { COGS_CATEGORIES, OPEX_CATEGORIES } from '@/lib/finance'
import { SEGMENTS } from '@/lib/segments'
import { addExpenseForm, togglePaid, removeExpense } from './actions'
import { MediaUpload } from '@/app/components/MediaUpload'
import { isMediaConfigured } from '@/lib/media'
import { SubmitButton } from '@/app/components/Pending'

// Cost entry for the income statement: variable costs (cost of services)
// and fixed operating expenses, per the owner's Excel model.
export default async function ExpensesPage() {
  await requireManager()
  const seg = SEGMENTS.business

  const expenses = await db.expense.findMany({ orderBy: { date: 'desc' }, take: 60 })

  // Every document for every listed expense in ONE query. A <MediaSection> per
  // row would have been a query per expense — sixty of them, each a serial round
  // trip on this adapter (docs/PERFORMANCE.md).
  const docs = expenses.length > 0
    ? await db.mediaAsset.findMany({
      where: { ownerType: 'expense', ownerId: { in: expenses.map(e => e.id) } },
      select: { id: true, ownerId: true, kind: true },
      orderBy: { createdAt: 'asc' },
    })
    : []
  const docsByExpense = new Map<string, typeof docs>()
  for (const d of docs) {
    const list = docsByExpense.get(d.ownerId) ?? []
    list.push(d)
    docsByExpense.set(d.ownerId, list)
  }
  const uploadsReady = isMediaConfigured()

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
        <div className="flex gap-2">
          <Link href="/finance/records" className="cd-btn-sec text-sm">Records →</Link>
          <Link href="/finance/income-statement" className="cd-btn-sec text-sm">Income Statement →</Link>
        </div>
      </div>

      <form action={addExpenseForm} className="cd-card p-5 space-y-4">
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Vendor / supplier</label>
            <input name="vendor" placeholder="e.g. OKANA, landlord…" className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Notes</label>
            <input name="notes" placeholder="e.g. July rent · Maybank transfer" className="cd-input" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 items-end">
          <div>
            <label className="cd-label">Status</label>
            <select name="paid" className="cd-input">
              <option value="paid">Paid (already settled)</option>
              <option value="unpaid">Unpaid — owe it (accounts payable)</option>
            </select>
          </div>
          <div>
            <label className="cd-label">Due date (if unpaid)</label>
            <input name="dueDate" type="date" className="cd-input" />
          </div>
        </div>
        <SubmitButton className="cd-btn" busyLabel="Working…">Record expense</SubmitButton>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody className="cd-tbody">
                      {list.map(e => (
                        <tr key={e.id}>
                          <td className="px-4 py-2 cd-muted whitespace-nowrap">{e.date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}</td>
                          <td className="px-4 py-2" style={{ color: '#2D1907' }}>
                            {e.vendor ? <span className="font-medium">{e.vendor}</span> : e.category}
                            {e.vendor && <span className="cd-muted"> · {e.category}</span>}
                            {e.notes && <span className="cd-muted"> · {e.notes}</span>}
                          </td>
                          <td className="px-4 py-2">
                            {e.paid ? (
                              <span className="cd-pill" style={{ background: 'rgba(122,138,79,0.18)', color: '#5c6b3c' }}>paid</span>
                            ) : (
                              <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>
                                unpaid{e.dueDate ? ` · due ${e.dueDate.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums whitespace-nowrap" style={{ color: '#2D1907' }}>
                            RM {e.amount.toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                          </td>
                          {/* Invoice / receipt — the paper behind the figure. It
                              files under this expense's own month, so an invoice
                              that arrives in April against a March cost still
                              lands in the March folder. */}
                          <td className="px-2 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 justify-end">
                              {(docsByExpense.get(e.id) ?? []).map(d => (
                                <a key={d.id} href={`/api/media/${d.id}/file`} target="_blank" rel="noopener noreferrer"
                                  className="text-xs px-1.5 py-0.5 rounded"
                                  style={{ background: 'rgba(114,144,148,0.16)', color: '#4a6265' }}>
                                  {d.kind === 'document' ? 'PDF' : 'IMG'}
                                </a>
                              ))}
                              {uploadsReady
                                ? <MediaUpload ownerType="expense" ownerId={e.id} accept="document" label="invoice" />
                                : <span className="text-xs cd-muted">storage off</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            <form action={togglePaid} className="inline">
                              <input type="hidden" name="id" value={e.id} />
                              <SubmitButton className="text-xs cd-link mr-2" busyLabel="Working…">{e.paid ? 'mark unpaid' : 'mark paid'}</SubmitButton>
                            </form>
                            <form action={removeExpense} className="inline">
                              <input type="hidden" name="id" value={e.id} />
                              <SubmitButton className="text-xs cd-muted hover:underline" busyLabel="Working…">remove</SubmitButton>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
