import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { nextMemberNumber } from '@/lib/loyalty'

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

    const memberNumber = data.get('issueCard') === 'on' ? await nextMemberNumber() : null

    await db.membership.create({
      data: {
        customerId: data.get('customerId') as string,
        tierId: data.get('tierId') as string,
        memberNumber,
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
      <h1 className="text-xl font-bold mb-6" style={{ color: '#2D1907' }}>New Membership</h1>
      <form action={create} className="cd-card p-6 space-y-4">
        <div>
          <label className="cd-label">Customer *</label>
          <select name="customerId" required className="cd-input">
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">Tier *</label>
          <select name="tierId" required className="cd-input">
            <option value="">Select tier…</option>
            {tiers.map(t => {
              const price = t.monthlyPrice > 0 ? `RM ${t.monthlyPrice}/mo` : t.annualPrice ? `RM ${t.annualPrice}/yr` : 'Free'
              return <option key={t.id} value={t.id}>{t.name} — {price}</option>
            })}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Start Date *</label>
            <input name="startDate" type="date" required defaultValue={today} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Duration (months)</label>
            <input name="months" type="number" min="1" max="24" defaultValue="12" className="cd-input" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: '#2D1907' }}>
          <input type="checkbox" name="issueCard" defaultChecked className="rounded" />
          Issue numbered member card (Founder Circle / collectible)
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: '#2D1907' }}>
          <input type="checkbox" name="autoRenew" className="rounded" />
          Auto-renew
        </label>
        <div>
          <label className="cd-label">Notes</label>
          <input name="notes" placeholder="Optional notes…" className="cd-input" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="cd-btn">Create</button>
          <a href="/memberships" className="text-sm cd-muted hover:underline px-3 py-2">Cancel</a>
        </div>
      </form>
    </div>
  )
}
