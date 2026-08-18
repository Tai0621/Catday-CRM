import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { LIFE_STAGES, GENDERS, DIET_TYPES } from '@/lib/constants'
import { NOT_HOUSE } from '@/lib/cat-stock'

const COAT_TYPES = ['Short', 'Long']
const asDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')

export default async function EditCatPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const [cat, customers] = await Promise.all([
    db.cat.findUnique({
      where: { id },
      select: {
        id: true, name: true, breed: true, gender: true, lifeStage: true, coatType: true,
        dateOfBirth: true, vaccinationExpiry: true, careNotes: true, healthNotes: true,
        groomingInterval: true, customerId: true,
        lastDewormAt: true, lastDefleaAt: true, dietType: true, mealsPerDay: true,
        portion: true, feedingNotes: true, medication: true,
      },
    }),
    db.customer.findMany({ where: NOT_HOUSE, select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } }),
  ])
  if (!cat) notFound()

  async function save(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) || '').trim()
    if (!name) redirect(`/cats/${id}/edit`)
    const dob = data.get('dateOfBirth') as string
    const vax = data.get('vaccinationExpiry') as string
    await db.cat.update({
      where: { id },
      data: {
        name,
        breed: ((data.get('breed') as string) || '').trim() || null,
        gender: (data.get('gender') as string) || null,
        lifeStage: (data.get('lifeStage') as string) || null,
        coatType: (data.get('coatType') as string) || null,
        dateOfBirth: dob ? new Date(dob) : null,
        vaccinationExpiry: vax ? new Date(vax) : null,
        careNotes: ((data.get('careNotes') as string) || '').trim() || null,
        healthNotes: ((data.get('healthNotes') as string) || '').trim() || null,
        groomingInterval: data.get('groomingInterval') ? parseInt(data.get('groomingInterval') as string, 10) : null,
        customerId: (data.get('customerId') as string) || cat!.customerId,
        lastDewormAt: (data.get('lastDewormAt') as string) ? new Date(data.get('lastDewormAt') as string) : null,
        lastDefleaAt: (data.get('lastDefleaAt') as string) ? new Date(data.get('lastDefleaAt') as string) : null,
        dietType: (data.get('dietType') as string) || null,
        mealsPerDay: data.get('mealsPerDay') ? parseInt(data.get('mealsPerDay') as string, 10) : null,
        portion: ((data.get('portion') as string) || '').trim() || null,
        feedingNotes: ((data.get('feedingNotes') as string) || '').trim() || null,
        medication: ((data.get('medication') as string) || '').trim() || null,
      },
    })
    redirect(`/cats/${id}`)
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/cats/${id}`} className="text-xs cd-muted hover:underline">{cat.name}</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">Edit</span>
        </div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Edit Cat</h1>
      </div>

      <form action={save} className="cd-card p-5 space-y-4">
        <div>
          <label className="cd-label">Owner *</label>
          <select name="customerId" required defaultValue={cat.customerId} className="cd-input">
            {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Cat name *</label>
            <input name="name" required defaultValue={cat.name} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Breed</label>
            <input name="breed" defaultValue={cat.breed ?? ''} placeholder="e.g. Persian" className="cd-input" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="cd-label">Gender</label>
            <select name="gender" defaultValue={cat.gender ?? ''} className="cd-input">
              <option value="">—</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Life stage</label>
            <select name="lifeStage" defaultValue={cat.lifeStage ?? ''} className="cd-input">
              <option value="">—</option>
              {LIFE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Coat</label>
            <select name="coatType" defaultValue={cat.coatType ?? ''} className="cd-input">
              <option value="">—</option>
              {COAT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Date of birth</label>
            <input name="dateOfBirth" type="date" defaultValue={asDate(cat.dateOfBirth)} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Vaccination expiry</label>
            <input name="vaccinationExpiry" type="date" defaultValue={asDate(cat.vaccinationExpiry)} className="cd-input" />
          </div>
        </div>
        <div>
          <label className="cd-label">Grooming interval (days)</label>
          <input name="groomingInterval" type="number" min="1" defaultValue={cat.groomingInterval ?? ''} placeholder="Blank = coat/breed default" className="cd-input" />
        </div>
        {/* Parasite control (monthly per boarding SOP) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Last dewormed</label>
            <input name="lastDewormAt" type="date" defaultValue={asDate(cat.lastDewormAt)} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Last flea treatment</label>
            <input name="lastDefleaAt" type="date" defaultValue={asDate(cat.lastDefleaAt)} className="cd-input" />
          </div>
        </div>

        {/* Feeding profile (boarding SOP S002) */}
        <div className="rounded-lg p-3 space-y-3" style={{ background: 'rgba(114,144,148,0.08)', border: '1px solid rgba(114,144,148,0.2)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#5c7378' }}>Feeding profile</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="cd-label">Diet type</label>
              <select name="dietType" defaultValue={cat.dietType ?? ''} className="cd-input">
                <option value="">—</option>
                {DIET_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="cd-label">Meals/day</label>
              <input name="mealsPerDay" type="number" min="1" max="6" defaultValue={cat.mealsPerDay ?? ''} placeholder="by life stage" className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Portion/meal</label>
              <input name="portion" defaultValue={cat.portion ?? ''} placeholder="e.g. 60g" className="cd-input" />
            </div>
          </div>
          <div>
            <label className="cd-label">Medication / supplements</label>
            <input name="medication" defaultValue={cat.medication ?? ''} placeholder="given with food, if any" className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Special feeding instructions</label>
            <input name="feedingNotes" defaultValue={cat.feedingNotes ?? ''} placeholder="allergies, owner-supplied food, schedule…" className="cd-input" />
          </div>
        </div>

        <div>
          <label className="cd-label">Care notes (boarding)</label>
          <textarea name="careNotes" rows={2} defaultValue={cat.careNotes ?? ''} placeholder="Feeding, medication, quirks…" className="cd-input" />
        </div>
        <div>
          <label className="cd-label">Health notes</label>
          <textarea name="healthNotes" rows={2} defaultValue={cat.healthNotes ?? ''} placeholder="Allergies, conditions…" className="cd-input" />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" className="cd-btn">Save changes</button>
          <Link href={`/cats/${id}`} className="cd-btn-sec text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
