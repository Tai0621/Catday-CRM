import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { LIFE_STAGES, GENDERS } from '@/lib/constants'
import { NOT_HOUSE } from '@/lib/cat-stock'
import { SubmitButton } from '@/app/components/Pending'

export default async function NewCatPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  await requireAuth()
  const { customerId } = await searchParams

  const customers = await db.customer.findMany({ where: NOT_HOUSE, orderBy: { name: 'asc' } })

  async function create(data: FormData) {
    'use server'
    const dob = data.get('dateOfBirth') as string
    const vax = data.get('vaccinationExpiry') as string
    await db.cat.create({
      data: {
        name: data.get('name') as string,
        breed: (data.get('breed') as string) || null,
        gender: (data.get('gender') as string) || null,
        lifeStage: (data.get('lifeStage') as string) || null,
        dateOfBirth: dob ? new Date(dob) : null,
        vaccinationExpiry: vax ? new Date(vax) : null,
        healthNotes: (data.get('healthNotes') as string) || null,
        groomingInterval: data.get('groomingInterval') ? parseInt(data.get('groomingInterval') as string, 10) : null,
        customerId: data.get('customerId') as string,
      },
    })
    redirect('/cats')
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">New Cat</h1>
      <form action={create} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Owner *</label>
          <select name="customerId" required defaultValue={customerId ?? ''}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">Select customer…</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>
            ))}
          </select>
        </div>
        <Field label="Cat Name *" name="name" required placeholder="e.g. Mochi" />
        <Field label="Breed" name="breed" placeholder="e.g. Persian, Scottish Fold" />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
            <select name="gender" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
              <option value="">—</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Life Stage</label>
            <select name="lifeStage" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
              <option value="">—</option>
              {LIFE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date of Birth" name="dateOfBirth" type="date" />
          <Field label="Vaccination Expiry" name="vaccinationExpiry" type="date" />
        </div>
        <Field label="Custom Grooming Interval (days)" name="groomingInterval" type="number" placeholder="Leave blank to use breed default" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Health Notes</label>
          <textarea name="healthNotes" rows={3} placeholder="Allergies, conditions, medication…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div className="flex gap-3 pt-2">
          <SubmitButton className="bg-rose-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-rose-700" busyLabel="Working…">Add Cat</SubmitButton>
          <a href="/cats" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Cancel</a>
        </div>
      </form>
    </div>
  )
}

function Field({ label, name, type = 'text', placeholder, required }: {
  label: string; name: string; type?: string; placeholder?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input name={name} type={type} placeholder={placeholder} required={required}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
    </div>
  )
}
