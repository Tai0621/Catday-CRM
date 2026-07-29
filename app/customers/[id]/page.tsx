import { requireAuth, isManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { displayPhone, whatsappUrl } from '@/lib/phone'
import { predictNextGrooming } from '@/lib/grooming-reminder'
import { awardPoints, trailingAnnualSpend, goldProgress } from '@/lib/loyalty'
import { topUpWallet, spendWallet } from '@/lib/wallet'
import { recordAudit } from '@/lib/audit'
import {
  POINTS_REASON_LABELS, GOLD_SPEND_THRESHOLD, WALLET_PACKAGES,
  PRIVATE_CLUB_TIER, PRIVATE_CLUB_SPEND, PRIVATE_CLUB_VISITS,
} from '@/lib/constants'
import { buildCustomerIntel, segmentStyle } from '@/lib/intelligence'
import { customerReceivable } from '@/lib/aging'
import { SEGMENTS } from '@/lib/segments'
import { AwardPointsForm } from './AwardPointsForm'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth()
  const canExport = isManager(session)
  const { id } = await params

  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      cats: {
        include: {
          appointments: { where: { type: 'Grooming', status: 'Completed' }, orderBy: { scheduledAt: 'desc' }, take: 1 },
        },
      },
      memberships: { include: { tier: true }, orderBy: { createdAt: 'desc' } },
      appointments: { include: { cat: true, room: true }, orderBy: { scheduledAt: 'desc' }, take: 10 },
      transactions: { where: { date: { gte: yearAgo } }, select: { date: true, total: true } },
      loyaltyEntries: { orderBy: { createdAt: 'desc' }, take: 8 },
      walletEntries: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  })

  if (!customer) notFound()

  const [allAppts, allTx] = await Promise.all([
    db.appointment.findMany({ where: { customerId: id }, select: { scheduledAt: true, status: true } }),
    db.transaction.findMany({ where: { customerId: id }, select: { total: true } }),
  ])
  const intel = buildCustomerIntel({
    createdAt: customer.createdAt,
    appointments: allAppts,
    transactions: allTx,
    memberships: customer.memberships.map(m => ({ status: m.status, tier: { name: m.tier.name } })),
  })

  const receivable = await customerReceivable(id)

  const activeMembership = customer.memberships.find(m => m.status === 'Active')
  const tierName = activeMembership?.tier.name ?? 'Essential'
  const cardType = activeMembership?.tier.cardType ?? 'Digital'
  const annualSpend = trailingAnnualSpend(customer.transactions)
  const gold = goldProgress(annualSpend)
  const isGoldOrAbove = ['Gold', 'Black Circle'].includes(tierName)

  async function award(data: FormData) {
    'use server'
    const points = parseInt((data.get('points') as string) || '0', 10)
    const reason = (data.get('reason') as string) || 'Manual'
    const note = (data.get('note') as string) || undefined
    if (points !== 0) {
      await awardPoints(id, points, reason, note)
      await recordAudit({ action: 'loyalty.adjust', entityType: 'Customer', entityId: id, summary: `${points > 0 ? 'Awarded' : 'Deducted'} ${Math.abs(points)} pts (${reason})`, detail: { points, reason, note } })
    }
    revalidatePath(`/customers/${id}`)
  }

  async function walletTopUp(data: FormData) {
    'use server'
    const amount = parseFloat((data.get('amount') as string) || '0')
    const bonus = parseFloat((data.get('bonus') as string) || '0')
    if (amount > 0) {
      await topUpWallet(id, amount, Math.max(0, bonus))
      await recordAudit({ action: 'wallet.topup', entityType: 'Customer', entityId: id, summary: `Wallet top-up RM ${amount.toFixed(2)}${bonus > 0 ? ` (+RM ${bonus.toFixed(2)} bonus)` : ''}`, detail: { amount, bonus } })
    }
    revalidatePath(`/customers/${id}`)
  }

  async function walletSpend(data: FormData) {
    'use server'
    const amount = parseFloat((data.get('amount') as string) || '0')
    const note = ((data.get('note') as string) || '').trim() || undefined
    try {
      if (amount > 0) {
        await spendWallet(id, amount, note)
        await recordAudit({ action: 'wallet.spend', entityType: 'Customer', entityId: id, summary: `Wallet charge RM ${amount.toFixed(2)}${note ? ` — ${note}` : ''}`, detail: { amount, note } })
      }
    } catch {
      // insufficient balance — nothing charged
    }
    revalidatePath(`/customers/${id}`)
  }

  const isPrivateClub = customer.memberships.some(m => m.status === 'Active' && m.tier.name === PRIVATE_CLUB_TIER)
  const clubEligible = !isPrivateClub && (intel.ltv >= PRIVATE_CLUB_SPEND || intel.visits >= PRIVATE_CLUB_VISITS)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Link href="/customers" className="text-xs cd-muted hover:underline">Customers</Link>
            <span className="text-xs cd-muted">›</span>
            <span className="text-xs cd-muted">{customer.name ?? 'Unnamed'}</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>{customer.name ?? 'Unnamed Customer'}</h1>
          <p className="text-sm cd-muted">{displayPhone(customer.phone)}{customer.email && ` · ${customer.email}`}</p>
        </div>
        <div className="flex gap-2">
          <a href={whatsappUrl(customer.phone)} target="_blank" rel="noopener noreferrer"
            className="text-sm px-3 py-2 rounded-lg" style={{ background: '#729094', color: '#F2EDE0' }}>
            WhatsApp
          </a>
          {canExport && (
            <a href={`/api/customers/${id}/export`} download
              className="cd-btn-sec text-sm" title="Download this customer's complete data (JSON) — right of access / portability">
              Export data
            </a>
          )}
          <Link href={`/customers/${id}/edit`} className="cd-btn-sec text-sm">Edit</Link>
          <Link href={`/appointments/new?customerId=${id}`} className="cd-btn text-sm">+ Book</Link>
        </div>
      </div>

      {/* Intelligence strip */}
      <div className="cd-card px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="cd-pill text-sm" style={segmentStyle(intel.segment)}>{intel.segment}</span>
        <IntelStat label="Lifetime value" value={`RM ${intel.ltv.toFixed(0)}`} />
        <IntelStat label="Visits" value={String(intel.visits)} />
        <IntelStat label="Avg ticket" value={intel.avgTicket > 0 ? `RM ${intel.avgTicket.toFixed(0)}` : '—'} />
        <IntelStat label="Visit cadence" value={`~${intel.personalCadenceDays}d`} />
        <IntelStat label="Last visit" value={intel.daysSinceLastVisit === null ? 'Never' : intel.daysSinceLastVisit === 0 ? 'Today' : `${intel.daysSinceLastVisit}d ago`}
          accent={intel.churnRisk === 'Lost' ? '#B14919' : intel.churnRisk === 'At-risk' ? '#8a6c00' : undefined} />
      </div>

      {/* Membership card + loyalty */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Personalised membership card */}
        <div className="rounded-2xl p-5 flex flex-col justify-between" style={{ background: 'linear-gradient(135deg, #2D1907 0%, #4a2d10 100%)', minHeight: '11rem' }}>
          <div className="flex items-start justify-between">
            <span className="text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-brand)', color: '#ECDBB6', letterSpacing: '0.18em' }}>cat day</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(236,219,182,0.15)', color: '#ECDBB6' }}>{cardType}</span>
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: '#F2EDE0' }}>{customer.name ?? displayPhone(customer.phone)}</div>
            <div className="text-sm" style={{ color: '#E7CE7A' }}>{tierName} Member</div>
          </div>
          <div className="flex items-end justify-between">
            <span className="text-xs" style={{ color: 'rgba(236,219,182,0.7)' }}>
              {activeMembership?.memberNumber ? `Member #${String(activeMembership.memberNumber).padStart(3, '0')}` : 'Auto-enrolled'}
            </span>
            <span className="text-xs" style={{ color: 'rgba(236,219,182,0.7)' }}>
              Since {(activeMembership?.startDate ?? customer.createdAt).getFullYear()}
            </span>
          </div>
        </div>

        {/* Loyalty panel */}
        <div className="cd-card p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider cd-muted">Loyalty Points</span>
            <span className="text-2xl font-bold" style={{ color: '#B14919' }}>{customer.pointsBalance.toLocaleString()}</span>
          </div>
          <AwardPointsForm action={award} />
        </div>

        {/* Outstanding balance (accounts receivable) */}
        {receivable.total > 0 && (
          <div className="cd-card p-5 space-y-2 md:col-span-2" style={{ borderLeft: '3px solid #B14919' }}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider" style={{ color: '#B14919' }}>Outstanding balance</span>
              <span className="text-2xl font-bold" style={{ color: '#B14919' }}>RM {receivable.total.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
            </div>
            <ul className="text-sm space-y-0.5">
              {receivable.items.map(i => (
                <li key={i.apptId} className="flex items-center justify-between">
                  <span style={{ color: '#2D1907' }}>{i.type} · {i.catName} <span className="cd-muted">· {i.date.toLocaleDateString('en-MY')} · {i.days}d</span></span>
                  <span className="font-medium tabular-nums" style={{ color: '#2D1907' }}>RM {i.amount.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/pos?customerId=${id}`} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: '#2D1907', color: '#ECDBB6' }}>Collect at POS →</Link>
              <a href={whatsappUrl(customer.phone, `Hi! A friendly reminder from Cat Day 🐾 — there's an outstanding balance of RM ${receivable.total.toLocaleString('en-MY')} on your account. Let us know if you'd like to settle it. Thank you!`)}
                target="_blank" rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg" style={{ background: '#729094', color: '#F2EDE0' }}>WhatsApp reminder</a>
            </div>
          </div>
        )}

        {/* Cat Day Wallet (stored value) */}
        <div className="cd-card p-5 space-y-3 md:col-span-2" style={{ borderLeft: `3px solid ${SEGMENTS.membership.color}` }}>
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider" style={{ color: SEGMENTS.membership.text }}>Cat Day Wallet</span>
            <span className="text-2xl font-bold" style={{ color: SEGMENTS.membership.text }}>
              RM {customer.walletBalance.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {WALLET_PACKAGES.map(p => (
              <form key={p.pay} action={walletTopUp}>
                <input type="hidden" name="amount" value={p.pay} />
                <input type="hidden" name="bonus" value={p.bonus} />
                <button type="submit" className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: SEGMENTS.membership.bg, color: SEGMENTS.membership.text, border: `1px solid ${SEGMENTS.membership.color}55` }}>
                  Top up RM {p.pay} <span style={{ opacity: 0.75 }}>+{p.bonus} free</span>
                </button>
              </form>
            ))}
            <form action={walletTopUp} className="flex items-center gap-1.5">
              <input name="amount" type="number" min="1" step="0.01" placeholder="Custom RM" className="cd-input" style={{ width: '7rem' }} />
              <input type="hidden" name="bonus" value="0" />
              <button type="submit" className="cd-btn-sec text-xs">Top up</button>
            </form>
          </div>
          <form action={walletSpend} className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: '1px solid rgba(45,25,7,0.08)' }}>
            <input name="amount" type="number" min="0.01" step="0.01" placeholder="Charge RM" className="cd-input" style={{ width: '7rem' }} />
            <input name="note" placeholder="What for? e.g. Grooming — Mochi" className="cd-input" style={{ width: '14rem' }} />
            <button type="submit" className="cd-btn text-xs">Pay from wallet</button>
            <span className="text-xs cd-muted">Charges are declined if the balance is too low.</span>
          </form>
          {customer.walletEntries.length > 0 && (
            <div className="space-y-1 pt-1">
              {customer.walletEntries.map(e => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span className="cd-muted">
                    {e.createdAt.toLocaleDateString('en-MY')} · {e.kind}{e.note ? ` — ${e.note}` : ''}
                  </span>
                  <span className="font-semibold" style={{ color: e.amount >= 0 ? '#5c6b3c' : '#B14919' }}>
                    {e.amount >= 0 ? '+' : ''}RM {Math.abs(e.amount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Private Club */}
      {isPrivateClub && (
        <div className="rounded-xl px-4 py-3 text-sm flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #2D1907 0%, #4a2d10 100%)', color: '#E7CE7A' }}>
          <span><strong>Private Club member</strong> — no automated blasts. Personal one-to-one care only (see monthly check-in in Actions).</span>
        </div>
      )}
      {clubEligible && (
        <div className="rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2"
          style={{ background: SEGMENTS.membership.bg, border: `1px solid ${SEGMENTS.membership.color}55` }}>
          <span className="text-sm" style={{ color: '#2D1907' }}>
            <strong>Private Club eligible</strong> — {intel.ltv >= PRIVATE_CLUB_SPEND
              ? `RM ${intel.ltv.toFixed(0)} lifetime spend`
              : `${intel.visits} visits`} (threshold: RM {PRIVATE_CLUB_SPEND} or {PRIVATE_CLUB_VISITS} visits). Invite personally, never by broadcast.
          </span>
          <Link href="/memberships/new" className="text-xs cd-link font-medium">Create {PRIVATE_CLUB_TIER} membership →</Link>
        </div>
      )}

      {/* Gold eligibility */}
      {!isGoldOrAbove && (
        <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(231,206,122,0.3)', border: '1px solid rgba(231,206,122,0.5)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-semibold" style={{ color: '#2D1907' }}>
              {gold.qualifies ? '🏅 Eligible for Gold!' : 'Gold tier progress'}
            </span>
            <span className="text-xs cd-muted">RM {annualSpend.toFixed(0)} / RM {GOLD_SPEND_THRESHOLD} (12 mo)</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(45,25,7,0.1)' }}>
            <div className="h-full rounded-full" style={{ width: `${gold.pct}%`, background: '#B8902B' }} />
          </div>
          {gold.qualifies ? (
            <p className="text-xs mt-1.5" style={{ color: '#2D1907' }}>
              This customer qualifies for Gold. <Link href="/memberships/new" className="cd-link font-medium">Upgrade membership →</Link>
            </p>
          ) : (
            <p className="text-xs mt-1.5 cd-muted">RM {gold.remaining.toFixed(0)} more annual spend to reach Gold.</p>
          )}
        </div>
      )}

      {/* Info strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfoCard label="Source" value={customer.source} />
        <InfoCard label="Membership"
          value={activeMembership
            ? `${activeMembership.tier.name} · expires ${activeMembership.expiryDate.toLocaleDateString('en-MY')}`
            : 'Essential (auto)'} />
        <InfoCard label="Cats" value={String(customer.cats.length)} />
      </div>

      {customer.notes && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(231,206,122,0.3)', border: '1px solid rgba(231,206,122,0.5)', color: '#2D1907' }}>
          <strong>Notes:</strong> {customer.notes}
        </div>
      )}

      {/* Cats */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>
            Cats <span className="font-normal text-sm cd-muted">({customer.cats.length})</span>
          </h2>
          <Link href={`/cats/new?customerId=${id}`} className="text-xs cd-link">+ Add cat</Link>
        </div>
        {customer.cats.length === 0 ? (
          <p className="text-sm cd-muted">No cats on file · <Link href={`/cats/new?customerId=${id}`} className="cd-link">Add one</Link></p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {customer.cats.map(cat => {
              const lastGroomed = cat.appointments[0]?.scheduledAt ?? null
              const nextDue = predictNextGrooming(lastGroomed, cat.breed, cat.groomingInterval, cat.coatType)
              const daysUntil = Math.ceil((nextDue.getTime() - Date.now()) / 86400000)
              const overdue = daysUntil < 0

              return (
                <Link key={cat.id} href={`/cats/${cat.id}`}
                  className="cd-card px-4 py-3 block hover:opacity-90 transition-opacity">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold flex items-center gap-1.5" style={{ color: '#2D1907' }}>
                        {cat.name}
                        {cat.foundingNumber != null && (
                          <span className="cd-pill" style={{ background: 'rgba(231,206,122,0.45)', color: '#8a6c00' }}>
                            ★ #{String(cat.foundingNumber).padStart(3, '0')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs cd-muted">{cat.breed ?? 'Unknown breed'} · {cat.lifeStage ?? '—'} · {cat.gender ?? '—'}</div>
                    </div>
                    <span className="text-xs font-medium" style={{ color: overdue ? '#B14919' : daysUntil <= 7 ? '#8a6c00' : '#729094' }}>
                      {lastGroomed
                        ? overdue ? `${Math.abs(daysUntil)}d overdue` : `${daysUntil}d`
                        : 'No history'}
                    </span>
                  </div>
                  {lastGroomed && (
                    <div className="text-xs cd-muted mt-1">Last groomed: {lastGroomed.toLocaleDateString('en-MY')}</div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Recent Appointments */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Recent Appointments</h2>
        <div className="cd-card overflow-hidden">
          {customer.appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">No appointments yet</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="cd-tbody">
                {customer.appointments.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 cd-muted">{a.scheduledAt.toLocaleDateString('en-MY')}</td>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/cats/${a.catId}`} className="cd-link">{a.cat.name}</Link>
                    </td>
                    <td className="px-4 py-2 cd-muted">{a.type}{a.room && ` · ${a.room.name}`}</td>
                    <td className="px-4 py-2">
                      <span className="cd-pill" style={apptStatusStyle(a.status)}>{a.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/appointments/${a.id}`} className="text-xs cd-link">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Loyalty ledger */}
      <section>
        <h2 className="font-semibold mb-3" style={{ color: '#2D1907' }}>Points History</h2>
        <div className="cd-card overflow-hidden">
          {customer.loyaltyEntries.length === 0 ? (
            <p className="px-4 py-6 text-sm cd-muted text-center">No points activity yet</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="cd-tbody">
                {customer.loyaltyEntries.map(e => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 cd-muted">{e.createdAt.toLocaleDateString('en-MY')}</td>
                    <td className="px-4 py-2" style={{ color: '#2D1907' }}>
                      {POINTS_REASON_LABELS[e.reason] ?? e.reason}
                      {e.note && <span className="cd-muted"> · {e.note}</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold" style={{ color: e.points >= 0 ? '#729094' : '#B14919' }}>
                      {e.points >= 0 ? '+' : ''}{e.points}
                    </td>
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

function IntelStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-xs cd-muted">{label}</div>
      <div className="text-sm font-semibold" style={{ color: accent ?? '#2D1907' }}>{value}</div>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-sm font-medium" style={{ color: '#2D1907' }}>{value}</div>
    </div>
  )
}

function apptStatusStyle(s: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    Scheduled:  { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    CheckedIn:  { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    InService:  { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    QualityCheck: { background: 'rgba(231,206,122,0.5)', color: '#7a5c00' },
    Ready:      { background: 'rgba(122,138,79,0.22)', color: '#5c6b3c' },
    Completed:  { background: 'rgba(45,25,7,0.12)', color: '#2D1907' },
    NoShow:     { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Cancelled:  { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' },
  }
  return m[s] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' }
}
