import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'

export default async function MembershipsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAuth()
  const { status } = await searchParams
  const where = status ? { status } : {}

  const [memberships, tiers, stats] = await Promise.all([
    db.membership.findMany({
      where,
      include: { customer: true, tier: true },
      orderBy: { expiryDate: 'asc' },
    }),
    db.membershipTier.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.membership.groupBy({ by: ['status'], _count: true }),
  ])

  const statMap = Object.fromEntries(stats.map(s => [s.status, s._count]))

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Memberships</h1>
        <div className="flex gap-2">
          <Link href="/memberships/tiers" className="cd-btn-sec text-sm">Manage Tiers</Link>
          <Link href="/memberships/new" className="cd-btn">+ New Membership</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiers.map(tier => {
          const count = memberships.filter(m => m.tierId === tier.id && m.status === 'Active').length
          const benefits = tier.benefits ? JSON.parse(tier.benefits) as string[] : []
          const price = tier.monthlyPrice > 0 ? `RM ${tier.monthlyPrice}/mo` : tier.annualPrice ? `RM ${tier.annualPrice}/yr` : 'Free'
          return (
            <Link key={tier.id} href={`/memberships/tiers/${tier.id}`} className="rounded-xl border-2 p-4 block hover:opacity-90 transition-opacity" style={{ background: '#ECDBB6', borderColor: tier.color ?? 'rgba(45,25,7,0.15)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold" style={{ color: '#2D1907' }}>{tier.name}</span>
                <span className="cd-pill text-white" style={{ background: tier.color ?? '#2D1907' }}>
                  {count} active
                </span>
              </div>
              {tier.tagline && <div className="text-xs italic cd-muted mb-1.5">{tier.tagline}</div>}
              <div className="text-sm font-semibold" style={{ color: '#2D1907' }}>{price}</div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.6)' }}>{tier.cardType} card</span>
                {tier.pointsMultiplier !== 1 && (
                  <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919' }}>{tier.pointsMultiplier}× points</span>
                )}
              </div>
              <div className="mt-2 space-y-0.5">
                {tier.groomingCredits > 0 && <div className="text-xs cd-muted">✓ {tier.groomingCredits} grooming/mo</div>}
                {tier.boardingDiscount > 0 && <div className="text-xs cd-muted">✓ {tier.boardingDiscount}% boarding discount</div>}
                {benefits.slice(0, 3).map((b, i) => (
                  <div key={i} className="text-xs cd-muted">✓ {b}</div>
                ))}
              </div>
              <div className="text-xs mt-2 font-medium" style={{ color: '#B14919' }}>View members →</div>
            </Link>
          )
        })}
      </div>

      <div className="flex gap-2 text-sm">
        {['', 'Active', 'Expired', 'Cancelled', 'Paused'].map(s => (
          <Link key={s} href={s ? `?status=${s}` : '/memberships'}
            className="px-3 py-1.5 rounded-lg transition-colors"
            style={status === s || (!status && !s)
              ? { background: '#B14919', color: '#ECDBB6', border: '1px solid #B14919' }
              : { background: 'rgba(45,25,7,0.06)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }
            }>
            {s || 'All'} {s && statMap[s] ? `(${statMap[s]})` : ''}
          </Link>
        ))}
      </div>

      <div className="cd-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="cd-thead">
            <th>Customer</th>
            <th>Tier</th>
            <th>Start</th>
            <th>Expiry</th>
            <th>Status</th>
            <th>Credits Used</th>
            <th></th>
          </tr></thead>
          <tbody className="cd-tbody">
            {memberships.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center cd-muted">No memberships found</td></tr>
            )}
            {memberships.map(m => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/customers/${m.customerId}`} className="cd-link">
                    {m.customer.name ?? m.customer.phone}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="cd-pill text-white" style={{ background: m.tier.color ?? '#2D1907' }}>{m.tier.name}</span>
                </td>
                <td className="px-4 py-3 cd-muted">{m.startDate.toLocaleDateString('en-MY')}</td>
                <td className="px-4 py-3 cd-muted">{m.expiryDate.toLocaleDateString('en-MY')}</td>
                <td className="px-4 py-3">
                  <span className="cd-pill" style={membershipStatusStyle(m.status)}>{m.status}</span>
                </td>
                <td className="px-4 py-3 cd-muted">{m.creditsUsed} / {m.tier.groomingCredits}</td>
                <td className="px-4 py-3">
                  <Link href={`/memberships/${m.id}`} className="text-xs cd-link">Manage</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
