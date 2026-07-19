import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { LIFE_STAGES, GENDERS } from '@/lib/constants'

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
      },
    }),
    db.customer.findMany({ select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } }),
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
