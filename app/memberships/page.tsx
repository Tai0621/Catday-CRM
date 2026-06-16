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
        <h1 className="text-xl font-bold text-gray-900">Memberships</h1>
        <div className="flex gap-2">
          <Link href="/memberships/tiers" className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200">Manage Tiers</Link>
          <Link href="/memberships/new" className="bg-rose-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-rose-700">+ New Membership</Link>
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiers.map(tier => {
          const count = memberships.filter(m => m.tierId === tier.id && m.status === 'Active').length
          const benefits = tier.benefits ? JSON.parse(tier.benefits) as string[] : []
          return (
            <div key={tier.id} className="bg-white rounded-xl border-2 p-4" style={{ borderColor: tier.color ?? '#e5e7eb' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-gray-900">{tier.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium text-white" style={{ background: tier.color ?? '#6b7280' }}>
                  {count} active
                </span>
              </div>
              <div className="text-sm font-semibold text-gray-700">RM {tier.monthlyPrice}/mo</div>
              {tier.annualPrice && <div className="text-xs text-gray-400">RM {tier.annualPrice}/yr</div>}
              <div className="mt-2 space-y-0.5">
                {tier.groomingCredits > 0 && (
                  <div className="text-xs text-gray-600">✓ {tier.groomingCredits} grooming/mo</div>
                )}
                {tier.boardingDiscount > 0 && (
                  <div className="text-xs text-gray-600">✓ {tier.boardingDiscount}% boarding discount</div>
                )}
                {benefits.slice(0, 2).map((b, i) => (
                  <div key={i} className="text-xs text-gray-600">✓ {b}</div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Status filters */}
      <div className="flex gap-2 text-sm">
        {['', 'Active', 'Expired', 'Cancelled', 'Paused'].map(s => (
          <Link key={s} href={s ? `?status=${s}` : '/memberships'}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${status === s || (!status && !s) ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {s || 'All'} {s && statMap[s] ? `(${statMap[s]})` : ''}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-left">Tier</th>
              <th className="px-4 py-3 text-left">Start</th>
              <th className="px-4 py-3 text-left">Expiry</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Credits Used</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {memberships.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No memberships found</td></tr>
            )}
            {memberships.map(m => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/customers/${m.customerId}`} className="hover:text-rose-600">
                    {m.customer.name ?? m.customer.phone}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                    style={{ background: m.tier.color ?? '#6b7280' }}>
                    {m.tier.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{m.startDate.toLocaleDateString('en-MY')}</td>
                <td className="px-4 py-3 text-gray-500">{m.expiryDate.toLocaleDateString('en-MY')}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusClass(m.status)}`}>{m.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{m.creditsUsed} / {m.tier.groomingCredits}</td>
                <td className="px-4 py-3">
                  <Link href={`/memberships/${m.id}`} className="text-xs text-rose-600 hover:underline">Manage</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function statusClass(s: string) {
  const m: Record<string, string> = {
    Active: 'bg-green-100 text-green-700',
    Expired: 'bg-red-100 text-red-700',
    Cancelled: 'bg-gray-100 text-gray-500',
    Paused: 'bg-amber-100 text-amber-700',
  }
  return m[s] ?? 'bg-gray-100 text-gray-500'
}
