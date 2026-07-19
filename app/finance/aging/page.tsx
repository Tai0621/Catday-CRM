import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { buildReceivables, buildPayables, BUCKET_LABELS, type AgingBucket } from '@/lib/aging'
import { whatsappUrl } from '@/lib/phone'
import { SEGMENTS } from '@/lib/segments'

// Accounts Receivable & Payable — who owes us, and what we owe, aged.
export default async function AgingPage() {
  await requireManager()
  const now = new Date()
  const [ar, ap] = await Promise.all([buildReceivables(now), buildPayables(now)])
  const seg = SEGMENTS.business
  const rm = (v: number) => (v === 0 ? '–' : `RM ${v.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`)
  const BUCKETS: AgingBucket[] = ['current', 'd3160', 'd6190', 'd90']

  async function markPaid(data: FormData) {
    'use server'
    const id = data.get('id') as string
    if (id) await db.expense.update({ where: { id }, data: { paid: true } })
    revalidatePath('/finance/aging')
    revalidatePath('/finance/balance-sheet')
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Receivables &amp; Payables
        </h1>
        <p className="text-sm cd-muted">Money owed to you (from unpaid visits) and money you owe (unpaid expenses), aged. Feeds the balance sheet.</p>
      </div>

      {/* ── Accounts Receivable ── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Accounts Receivable <span className="text-sm font-normal cd-muted">· owed to you</span></h2>
          <span className="text-lg font-bold" style={{ color: ar.total > 0 ? '#B14919' : '#5c6b3c' }}>{rm(ar.total)}</span>
        </div>
        <AgingSummary buckets={ar.buckets} BUCKETS={BUCKETS} rm={rm} />

        <div className="cd-card overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '42rem' }}>
            <thead><tr className="cd-thead">
              <th>Customer</th><th className="text-center">Oldest</th>
              {BUCKETS.map(b => <th key={b} className="text-right px-2">{BUCKET_LABELS[b]}</th>)}
              <th className="text-right px-3">Total</th><th></th>
            </tr></thead>
            <tbody className="cd-tbody">
              {ar.customers.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center cd-muted">Nothing outstanding — all visits are paid up 🐾</td></tr>}
              {ar.customers.map(c => (
                <tr key={c.customerId}>
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/customers/${c.customerId}`} className="cd-link">{c.name}</Link>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className="cd-pill" style={agePill(c.oldestDays)}>{c.oldestDays}d</span>
                  </td>
                  {BUCKETS.map(b => (
                    <td key={b} className="px-2 py-2 text-right tabular-nums" style={{ color: c.buckets[b] > 0 ? (b === 'd90' ? '#B14919' : 'rgba(45,25,7,0.8)') : 'rgba(45,25,7,0.3)' }}>
                      {rm(c.buckets[b])}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: '#2D1907' }}>{rm(c.total)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <a href={whatsappUrl(c.phone, `Hi! A friendly reminder from Cat Day 🐾 — there's an outstanding balance of RM ${c.total.toLocaleString('en-MY')} on your account. Let us know if you'd like to settle it. Thank you!`)}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded mr-1" style={{ background: '#729094', color: '#F2EDE0' }}>Remind</a>
                    <Link href={`/pos?customerId=${c.customerId}`} className="text-xs px-2 py-1 rounded" style={{ background: '#2D1907', color: '#ECDBB6' }}>Collect</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Accounts Payable ── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Accounts Payable <span className="text-sm font-normal cd-muted">· you owe</span></h2>
          <span className="text-lg font-bold" style={{ color: ap.total > 0 ? '#B14919' : '#5c6b3c' }}>{rm(ap.total)}</span>
        </div>
        <AgingSummary buckets={ap.buckets} BUCKETS={BUCKETS} rm={rm} />

        <div className="cd-card overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '40rem' }}>
            <thead><tr className="cd-thead">
              <th>Vendor / Category</th><th>Due</th><th className="text-center">Age</th>
              <th className="text-right px-3">Amount</th><th></th>
            </tr></thead>
            <tbody className="cd-tbody">
              {ap.items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center cd-muted">No unpaid expenses. Record an unpaid bill on the <Link href="/finance/expenses" className="cd-link">Expenses</Link> page.</td></tr>}
              {ap.items.map(i => (
                <tr key={i.expenseId}>
                  <td className="px-4 py-2">
                    <span className="font-medium" style={{ color: '#2D1907' }}>{i.vendor ?? i.category}</span>
                    {i.vendor && <span className="cd-muted"> · {i.category}</span>}
                  </td>
                  <td className="px-4 py-2 cd-muted whitespace-nowrap">{i.dueDate ? i.dueDate.toLocaleDateString('en-MY') : '—'}</td>
                  <td className="px-2 py-2 text-center"><span className="cd-pill" style={agePill(i.days)}>{i.days}d{i.overdue ? ' overdue' : ''}</span></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: '#2D1907' }}>{rm(i.amount)}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={markPaid}>
                      <input type="hidden" name="id" value={i.expenseId} />
                      <button type="submit" className="text-xs px-2 py-1 rounded" style={{ background: '#7A8A4F', color: '#F2EDE0' }}>Mark paid</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs cd-muted">
        Receivables come from completed visits not yet paid — settle them at the <Link href="/pos" className="cd-link">POS</Link>.
        Payables are expenses marked unpaid on the <Link href="/finance/expenses" className="cd-link">Expenses</Link> page; both totals flow into the balance sheet automatically.
      </p>
    </div>
  )
}

function AgingSummary({ buckets, BUCKETS, rm }: { buckets: Record<AgingBucket, number>; BUCKETS: AgingBucket[]; rm: (v: number) => string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {BUCKETS.map(b => (
        <div key={b} className="cd-card px-4 py-2.5" style={{ borderLeft: `3px solid ${b === 'd90' ? '#B14919' : b === 'd6190' ? '#B8902B' : 'rgba(45,25,7,0.2)'}` }}>
          <div className="text-xs cd-muted">{BUCKET_LABELS[b]}</div>
          <div className="text-base font-bold tabular-nums" style={{ color: buckets[b] > 0 && b === 'd90' ? '#B14919' : '#2D1907' }}>{rm(buckets[b])}</div>
        </div>
      ))}
    </div>
  )
}

function agePill(days: number): React.CSSProperties {
  if (days > 90) return { background: 'rgba(177,73,25,0.15)', color: '#B14919' }
  if (days > 60) return { background: 'rgba(231,206,122,0.4)', color: '#7a5c00' }
  return { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.55)' }
}
