import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { PAY_METHODS } from '@/lib/constants'
import { SEGMENTS } from '@/lib/segments'

const DAY = 24 * 60 * 60 * 1000
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// End-of-day reconciliation: what the system expects vs what's in the till.
// Wallet-paid services are excluded from money-in (the cash arrived at top-up).
export default async function CashUpPage() {
  const session = await requireManager()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + DAY)
  const today = dateKey(now)

  const [transactions, topUps, existing, history, unpaid] = await Promise.all([
    db.transaction.findMany({ where: { date: { gte: todayStart, lt: todayEnd } } }),
    db.walletEntry.findMany({ where: { kind: 'TopUp', createdAt: { gte: todayStart, lt: todayEnd } } }),
    db.cashUp.findUnique({ where: { date: today } }),
    db.cashUp.findMany({ orderBy: { date: 'desc' }, take: 7 }),
    db.appointment.findMany({
      where: { status: 'Completed', paid: false, price: { not: null }, scheduledAt: { gte: todayStart, lt: todayEnd } },
      include: { cat: true, customer: true },
    }),
  ])

  const byMethod: Record<string, number> = {}
  for (const m of PAY_METHODS) byMethod[m] = 0
  byMethod['Unspecified'] = 0
  for (const t of transactions) byMethod[t.method && byMethod[t.method] !== undefined ? t.method : 'Unspecified'] += t.total

  const topUpTotal = topUps.reduce((s, e) => s + e.amount, 0)
  // Money physically received today = all non-wallet takings + wallet top-ups
  const expected = (Object.entries(byMethod).reduce((s, [m, v]) => (m === 'Wallet' ? s : s + v), 0)) + topUpTotal

  async function saveCashUp(data: FormData) {
    'use server'
    const counted = parseFloat((data.get('counted') as string) || '0')
    const note = ((data.get('note') as string) ?? '').trim() || null
    const exp = parseFloat((data.get('expected') as string) || '0')
    await db.cashUp.upsert({
      where: { date: today },
      create: { date: today, expectedRM: exp, countedRM: counted, variance: counted - exp, note, staffName: session.name },
      update: { expectedRM: exp, countedRM: counted, variance: counted - exp, note, staffName: session.name },
    })
    redirect('/cashup')
  }

  const seg = SEGMENTS.business

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
          Daily Cash-up
        </h1>
        <p className="text-sm cd-muted">{now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })} · confirm the till against what the system expects.</p>
      </div>

      {/* Expected breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {PAY_METHODS.filter(m => m !== 'Wallet').map(m => (
          <div key={m} className="cd-card px-4 py-3">
            <div className="text-xs cd-muted">{m}</div>
            <div className="text-lg font-bold" style={{ color: '#2D1907' }}>RM {byMethod[m].toFixed(2)}</div>
          </div>
        ))}
        <div className="cd-card px-4 py-3" style={{ borderLeft: `3px solid ${SEGMENTS.membership.color}` }}>
          <div className="text-xs" style={{ color: SEGMENTS.membership.text }}>Wallet top-ups (money in)</div>
          <div className="text-lg font-bold" style={{ color: '#2D1907' }}>RM {topUpTotal.toFixed(2)}</div>
        </div>
        <div className="cd-card px-4 py-3">
          <div className="text-xs cd-muted">Paid by wallet (not money in)</div>
          <div className="text-lg font-bold cd-muted">RM {byMethod['Wallet'].toFixed(2)}</div>
        </div>
        {byMethod['Unspecified'] > 0 && (
          <div className="cd-card px-4 py-3">
            <div className="text-xs" style={{ color: '#B14919' }}>No method recorded</div>
            <div className="text-lg font-bold" style={{ color: '#B14919' }}>RM {byMethod['Unspecified'].toFixed(2)}</div>
          </div>
        )}
      </div>

      {unpaid.length > 0 && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(177,73,25,0.1)', border: '1px solid rgba(177,73,25,0.25)', color: '#2D1907' }}>
          <strong style={{ color: '#B14919' }}>Collect before closing:</strong>{' '}
          {unpaid.map(a => `${a.cat.name} (RM ${a.price!.toFixed(0)} — ${a.customer.name ?? a.customer.phone})`).join(' · ')}
        </div>
      )}

      {/* Confirm */}
      <form action={saveCashUp} className="cd-card p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold" style={{ color: '#2D1907' }}>Expected money in today</span>
          <span className="text-2xl font-bold" style={{ color: seg.color }}>RM {expected.toFixed(2)}</span>
        </div>
        <input type="hidden" name="expected" value={expected.toFixed(2)} />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="cd-label">Counted (till + terminal + QR)</label>
            <input name="counted" type="number" step="0.01" required className="cd-input" style={{ width: '10rem' }}
              defaultValue={existing?.countedRM ?? ''} />
          </div>
          <div className="flex-1" style={{ minWidth: '10rem' }}>
            <label className="cd-label">Note (explain any variance)</label>
            <input name="note" className="cd-input" defaultValue={existing?.note ?? ''} />
          </div>
          <button type="submit" className="cd-btn">{existing ? 'Update cash-up' : 'Confirm cash-up'}</button>
        </div>
        {existing && (
          <p className="text-xs" style={{ color: Math.abs(existing.variance) < 0.01 ? '#5c6b3c' : '#B14919' }}>
            Recorded: counted RM {existing.countedRM.toFixed(2)} vs expected RM {existing.expectedRM.toFixed(2)} —
            variance {existing.variance >= 0 ? '+' : ''}RM {existing.variance.toFixed(2)}
            {existing.staffName && ` (by ${existing.staffName})`}
          </p>
        )}
      </form>

      {/* History */}
      <section>
        <h2 className="font-semibold mb-2 text-sm" style={{ color: '#2D1907' }}>Last 7 cash-ups</h2>
        <div className="cd-card overflow-hidden">
          {history.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">No cash-ups recorded yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="cd-thead"><th>Date</th><th>Expected</th><th>Counted</th><th>Variance</th><th>By</th></tr></thead>
              <tbody className="cd-tbody">
                {history.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-2" style={{ color: '#2D1907' }}>{c.date}</td>
                    <td className="px-4 py-2 cd-muted">RM {c.expectedRM.toFixed(2)}</td>
                    <td className="px-4 py-2 cd-muted">RM {c.countedRM.toFixed(2)}</td>
                    <td className="px-4 py-2 font-semibold" style={{ color: Math.abs(c.variance) < 0.01 ? '#5c6b3c' : '#B14919' }}>
                      {c.variance >= 0 ? '+' : ''}RM {c.variance.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 cd-muted">{c.staffName ?? '—'}</td>
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
