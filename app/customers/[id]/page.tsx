import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { displayPhone, whatsappUrl } from '@/lib/phone'
import { predictNextGrooming } from '@/lib/grooming-reminder'
import { awardPoints, trailingAnnualSpend, goldProgress } from '@/lib/loyalty'
import { POINTS_REASON_LABELS, GOLD_SPEND_THRESHOLD } from '@/lib/constants'
import { AwardPointsForm } from './AwardPointsForm'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
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
    },
  })

  if (!customer) notFound()

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
    if (points !== 0) await awardPoints(id, points, reason, note)
    revalidatePath(`/customers/${id}`)
  }

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
          <Link href={`/customers/${id}/edit`} className="cd-btn-sec text-sm">Edit</Link>
          <Link href={`/appointments/new?customerId=${id}`} className="cd-btn text-sm">+ Book</Link>
        </div>
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
      </div>

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
              const nextDue = predictNextGrooming(lastGroomed, cat.breed, cat.groomingInterval)
              const daysUntil = Math.ceil((nextDue.getTime() - Date.now()) / 86400000)
              const overdue = daysUntil < 0

              return (
                <Link key={cat.id} href={`/cats/${cat.id}`}
                  className="cd-card px-4 py-3 block hover:opacity-90 transition-opacity">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold" style={{ color: '#2D1907' }}>{cat.name}</div>
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
    Completed:  { background: 'rgba(45,25,7,0.12)', color: '#2D1907' },
    NoShow:     { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Cancelled:  { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' },
  }
  return m[s] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' }
}
