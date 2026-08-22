import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { TIER_QUALIFICATION_LABELS } from '@/lib/constants'

export default async function TierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string }>
}) {
  await requireAuth()
  const { id } = await params
  const { status } = await searchParams

  const tier = await db.membershipTier.findUnique({
    where: { id },
    include: {
      memberships: {
        where: status ? { status } : {},
        include: { customer: true },
        orderBy: [{ status: 'asc' }, { expiryDate: 'asc' }],
      },
    },
  })

  if (!tier) notFound()

  // Count by status across the whole tier (independent of filter)
  const allStatuses = await db.membership.groupBy({
    by: ['status'],
    where: { tierId: id },
    _count: true,
  })
  const statMap = Object.fromEntries(allStatuses.map(s => [s.status, s._count]))
  const totalMembers = allStatuses.reduce((sum, s) => sum + s._count, 0)
  const activeCount = statMap['Active'] ?? 0

  const benefits = tier.benefits ? (JSON.parse(tier.benefits) as string[]) : []
  const price = tier.monthlyPrice > 0 ? `RM ${tier.monthlyPrice}/mo` : tier.annualPrice ? `RM ${tier.annualPrice}/yr` : 'Free'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Link href="/memberships" className="text-xs cd-muted hover:underline">Memberships</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">{tier.name}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full" style={{ background: tier.color ?? '#2D1907' }} />
            <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>{tier.name}</h1>
            <span className="cd-pill text-white" style={{ background: tier.color ?? '#2D1907' }}>{activeCount} active</span>
          </div>
          <Link href="/memberships/new" className="cd-btn text-sm">+ New Membership</Link>
        </div>
        {tier.tagline && <p className="text-sm italic cd-muted mt-1">{tier.tagline}</p>}
      </div>

      {/* Tier summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Price" value={price} />
        <SummaryCard label="Qualification" value={TIER_QUALIFICATION_LABELS[tier.qualification] ?? tier.qualification} />
        <SummaryCard label="Card Type" value={tier.cardType} />
        <SummaryCard label="Total Members" value={String(totalMembers)} />
      </div>

      {benefits.length > 0 && (
        <div className="cd-card p-5">
          <h2 className="font-semibold mb-2" style={{ color: '#2D1907' }}>Benefits</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {benefits.map((b, i) => (
              <li key={i} className="text-sm" style={{ color: 'rgba(45,25,7,0.75)' }}>✓ {b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2 text-sm">
        {['', 'Active', 'Expired', 'Cancelled', 'Paused'].map(s => (
          <Link key={s} href={s ? `?status=${s}` : `/memberships/tiers/${id}`}
            className="px-3 py-1.5 rounded-lg transition-colors"
            style={status === s || (!status && !s)
              ? { background: '#B14919', color: '#ECDBB6', border: '1px solid #B14919' }
              : { background: 'rgba(45,25,7,0.06)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }
            }>
            {s || 'All'} {s && statMap[s] ? `(${statMap[s]})` : ''}
          </Link>
        ))}
      </div>

      {/* Members table */}
      <div className="cd-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="cd-thead">
              <th>Member</th>
              <th>Card No.</th>
              <th>Phone</th>
              <th>Start</th>
              <th>Expiry</th>
              <th>Status</th>
              <th></th>
            </tr></thead>
            <tbody className="cd-tbody">
              {tier.memberships.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center cd-muted">No members in this tier{status ? ` with status “${status}”` : ''}</td></tr>
              )}
              {tier.memberships.map(m => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/customers/${m.customerId}`} className="cd-link">
                      {m.customer.name ?? m.customer.phone}
                    </Link>
                  </td>
                  <td className="px-4 py-3 cd-muted">{m.memberNumber ? `#${String(m.memberNumber).padStart(3, '0')}` : '—'}</td>
                  <td className="px-4 py-3 cd-muted">{m.customer.phone}</td>
                  <td className="px-4 py-3 cd-muted">{m.startDate.toLocaleDateString('en-MY')}</td>
                  <td className="px-4 py-3 cd-muted">{m.expiryDate.toLocaleDateString('en-MY')}</td>
                  <td className="px-4 py-3">
                    <span className="cd-pill" style={membershipStatusStyle(m.status)}>{m.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/memberships/${m.id}`} className="text-xs cd-link">Manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-sm font-medium" style={{ color: '#2D1907' }}>{value}</div>
    </div>
  )
}

function membershipStatusStyle(s: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    Active:    { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    Expired:   { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Cancelled: { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' },
    Paused:    { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
  }
  return m[s] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' }
}
