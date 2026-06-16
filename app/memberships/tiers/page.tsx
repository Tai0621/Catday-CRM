import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function MembershipTiersPage() {
  await requireAuth()

  const tiers = await db.membershipTier.findMany({ orderBy: { sortOrder: 'asc' } })

  async function create(data: FormData) {
    'use server'
    const benefits = (data.get('benefits') as string)
      .split('\n')
      .map(b => b.trim())
      .filter(Boolean)

    const count = await db.membershipTier.count()
    await db.membershipTier.create({
      data: {
        name: data.get('name') as string,
        monthlyPrice: parseFloat(data.get('monthlyPrice') as string),
        annualPrice: data.get('annualPrice') ? parseFloat(data.get('annualPrice') as string) : null,
        groomingCredits: parseInt(data.get('groomingCredits') as string || '0', 10),
        boardingDiscount: parseFloat(data.get('boardingDiscount') as string || '0'),
        benefits: JSON.stringify(benefits),
        color: (data.get('color') as string) || '#6b7280',
        sortOrder: count,
      },
    })
    redirect('/memberships/tiers')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Membership Tiers</h1>
        <Link href="/memberships" className="text-sm text-gray-500 hover:text-gray-700">← Back</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tiers.map(tier => (
          <div key={tier.id} className="bg-white rounded-xl border-2 p-4 space-y-2" style={{ borderColor: tier.color ?? '#e5e7eb' }}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: tier.color ?? '#6b7280' }} />
              <span className="font-bold text-gray-900">{tier.name}</span>
              {!tier.isActive && <span className="text-xs text-gray-400">(inactive)</span>}
            </div>
            <div className="text-sm">RM {tier.monthlyPrice}/mo {tier.annualPrice ? `· RM ${tier.annualPrice}/yr` : ''}</div>
            <div className="text-xs text-gray-500">{tier.groomingCredits} grooming credit/mo · {tier.boardingDiscount}% boarding off</div>
            {tier.benefits && (
              <ul className="text-xs text-gray-600 space-y-0.5">
                {(JSON.parse(tier.benefits) as string[]).map((b, i) => <li key={i}>• {b}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Add New Tier</h2>
        <form action={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tier Name *</label>
              <input name="name" required placeholder="e.g. Kitten, Cat, Lion"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Colour</label>
              <input name="color" type="color" defaultValue="#e11d48"
                className="h-10 w-full rounded-lg border border-gray-200 px-1 cursor-pointer" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Price (RM) *</label>
              <input name="monthlyPrice" type="number" step="0.01" required placeholder="0.00"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Annual Price (RM)</label>
              <input name="annualPrice" type="number" step="0.01" placeholder="Optional"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Grooming Credits / month</label>
              <input name="groomingCredits" type="number" min="0" defaultValue="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Boarding Discount (%)</label>
              <input name="boardingDiscount" type="number" min="0" max="100" step="5" defaultValue="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Benefits (one per line)</label>
            <textarea name="benefits" rows={4} placeholder="Priority booking&#10;Free nail trimming&#10;Monthly health check"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
          <button type="submit" className="bg-rose-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-rose-700">
            Create Tier
          </button>
        </form>
      </div>
    </div>
  )
}
