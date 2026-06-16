import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'

export default async function NewMembershipPage() {
  await requireAuth()

  const [customers, tiers] = await Promise.all([
    db.customer.findMany({ orderBy: { name: 'asc' } }),
    db.membershipTier.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ])

  async function create(data: FormData) {
    'use server'
    const startDate = new Date(data.get('startDate') as string)
    const months = parseInt(data.get('months') as string || '1', 10)
    const expiryDate = new Date(startDate)
    expiryDate.setMonth(expiryDate.getMonth() + months)

    await db.membership.create({
      data: {
        customerId: data.get('customerId') as string,
        tierId: data.get('tierId') as string,
        startDate,
        expiryDate,
        autoRenew: data.get('autoRenew') === 'on',
        notes: (data.get('notes') as string) || null,
      },
    })
    redirect('/memberships')
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">New Membership</h1>
      <form action={create} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
          <select name="customerId" required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tier *</label>
          <select name="tierId" required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">Select tier…</option>
            {tiers.map(t => <option key={t.id} value={t.id}>{t.name} — RM {t.monthlyPrice}/mo</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
            <input name="startDate" type="date" required defaultValue={today}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duration (months)</label>
            <input name="months" type="number" min="1" max="24" defaultValue="1"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="autoRenew" className="rounded" />
          Auto-renew
        </label>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input name="notes" placeholder="Optional notes…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="bg-rose-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-rose-700">Create</button>
          <a href="/memberships" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Cancel</a>
        </div>
      </form>
    </div>
  )
}
