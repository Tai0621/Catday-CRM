import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TIER_QUALIFICATIONS, TIER_QUALIFICATION_LABELS, CARD_TYPES } from '@/lib/constants'

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
    const threshold = data.get('annualSpendThreshold') as string
    await db.membershipTier.create({
      data: {
        name: data.get('name') as string,
        tagline: (data.get('tagline') as string) || null,
        monthlyPrice: parseFloat(data.get('monthlyPrice') as string),
        annualPrice: data.get('annualPrice') ? parseFloat(data.get('annualPrice') as string) : null,
        groomingCredits: parseInt(data.get('groomingCredits') as string || '0', 10),
        boardingDiscount: parseFloat(data.get('boardingDiscount') as string || '0'),
        qualification: (data.get('qualification') as string) || 'Manual',
        annualSpendThreshold: threshold ? parseFloat(threshold) : null,
        pointsMultiplier: parseFloat(data.get('pointsMultiplier') as string || '1'),
        cardType: (data.get('cardType') as string) || 'Digital',
        benefits: JSON.stringify(benefits),
        color: (data.get('color') as string) || '#2D1907',
        sortOrder: count,
      },
    })
    redirect('/memberships/tiers')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Membership Tiers</h1>
        <Link href="/memberships" className="text-sm cd-muted hover:underline">← Back</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tiers.map(tier => (
          <Link key={tier.id} href={`/memberships/tiers/${tier.id}`} className="rounded-xl border-2 p-4 space-y-2 block hover:opacity-90 transition-opacity" style={{ background: '#ECDBB6', borderColor: tier.color ?? 'rgba(45,25,7,0.15)' }}>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: tier.color ?? '#2D1907' }} />
              <span className="font-bold" style={{ color: '#2D1907' }}>{tier.name}</span>
              {!tier.isActive && <span className="text-xs cd-muted">(inactive)</span>}
              <span className="cd-pill ml-auto" style={{ background: 'rgba(45,25,7,0.1)', color: '#2D1907' }}>
                {tier.cardType}
              </span>
            </div>
            {tier.tagline && <div className="text-xs italic cd-muted">{tier.tagline}</div>}
            <div className="text-sm" style={{ color: '#2D1907' }}>
              {tier.monthlyPrice > 0 ? `RM ${tier.monthlyPrice}/mo` : tier.annualPrice ? `RM ${tier.annualPrice}/yr` : 'Free'}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs cd-muted">
              <span>{TIER_QUALIFICATION_LABELS[tier.qualification] ?? tier.qualification}</span>
              {tier.annualSpendThreshold ? <span>· RM {tier.annualSpendThreshold}/yr</span> : null}
              {tier.pointsMultiplier !== 1 ? <span>· {tier.pointsMultiplier}× points</span> : null}
              {tier.groomingCredits > 0 ? <span>· {tier.groomingCredits} credit/mo</span> : null}
            </div>
            {tier.benefits && (
              <ul className="text-xs space-y-0.5 pt-1" style={{ color: 'rgba(45,25,7,0.7)' }}>
                {(JSON.parse(tier.benefits) as string[]).map((b, i) => <li key={i}>• {b}</li>)}
              </ul>
            )}
            <div className="text-xs pt-1 font-medium" style={{ color: '#B14919' }}>View members →</div>
          </Link>
        ))}
      </div>

      <div className="cd-card p-6">
        <h2 className="font-semibold mb-4" style={{ color: '#2D1907' }}>Add New Tier</h2>
        <form action={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="cd-label">Tier Name *</label>
              <input name="name" required placeholder="e.g. Essential, Gold, Black Circle" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Colour</label>
              <input name="color" type="color" defaultValue="#2D1907" className="cd-input" style={{ height: '2.5rem', padding: '0.15rem', cursor: 'pointer' }} />
            </div>
          </div>
          <div>
            <label className="cd-label">Tagline</label>
            <input name="tagline" placeholder="e.g. By invitation only" className="cd-input" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="cd-label">Qualification</label>
              <select name="qualification" defaultValue="Manual" className="cd-input">
                {TIER_QUALIFICATIONS.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div>
              <label className="cd-label">Card Type</label>
              <select name="cardType" defaultValue="Digital" className="cd-input">
                {CARD_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="cd-label">Points Multiplier</label>
              <input name="pointsMultiplier" type="number" step="0.1" min="1" defaultValue="1" className="cd-input" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="cd-label">Monthly Price (RM) *</label>
              <input name="monthlyPrice" type="number" step="0.01" required defaultValue="0" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Annual Price (RM)</label>
              <input name="annualPrice" type="number" step="0.01" placeholder="Optional" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Spend Threshold (RM/yr)</label>
              <input name="annualSpendThreshold" type="number" step="100" placeholder="e.g. 3000" className="cd-input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="cd-label">Grooming Credits / month</label>
              <input name="groomingCredits" type="number" min="0" defaultValue="0" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Boarding Discount (%)</label>
              <input name="boardingDiscount" type="number" min="0" max="100" step="5" defaultValue="0" className="cd-input" />
            </div>
          </div>
          <div>
            <label className="cd-label">Benefits (one per line)</label>
            <textarea name="benefits" rows={4} placeholder="Priority booking&#10;FOC grooming add-ons&#10;Member-only events" className="cd-input" style={{ resize: 'none' }} />
          </div>
          <button type="submit" className="cd-btn">Create Tier</button>
        </form>
      </div>
    </div>
  )
}
