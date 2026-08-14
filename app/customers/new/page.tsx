import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { normalisePhone, displayPhone } from '@/lib/phone'
import { CUSTOMER_SOURCES } from '@/lib/constants'
import { consentUpdate } from '@/lib/consent'

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ exists?: string; erased?: string }>
}) {
  await requireAuth()
  const { exists, erased } = await searchParams

  const duplicate = exists
    ? await db.customer.findUnique({
        where: { id: exists },
        select: { id: true, name: true, phone: true },
      })
    : null

  async function create(data: FormData) {
    'use server'
    const phone = normalisePhone(data.get('phone') as string)

    // Phone is @unique, so a blind create threw P2002 across the action
    // boundary and into app/error.tsx — which told staff the app had been
    // updated when the number was simply already on file. Every other create
    // path (lib/customer-resolve, appointments/new) looks the phone up first;
    // this one now matches them.
    const existing = await db.customer.findUnique({
      where: { phone },
      select: { id: true, erasedAt: true },
    })
    if (existing?.erasedAt) redirect('/customers/new?erased=1')
    if (existing) redirect(`/customers/new?exists=${existing.id}`)

    await db.customer.create({
      data: {
        phone,
        name: (data.get('name') as string) || null,
        email: (data.get('email') as string) || null,
        address: (data.get('address') as string) || null,
        source: (data.get('source') as string) || 'WalkIn',
        ...consentUpdate(data.get('marketingConsent') === 'on', 'Staff'),
        notes: (data.get('notes') as string) || null,
        needsDetails: false,
      },
    })
    redirect('/customers')
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">New Customer</h1>
      {duplicate && (
        <div
          className="rounded-xl px-4 py-2.5 text-sm mb-4"
          style={{ background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.35)', color: '#B14919' }}
        >
          {displayPhone(duplicate.phone)} is already on file
          {duplicate.name ? ` for ${duplicate.name}` : ''}.{' '}
          <a href={`/customers/${duplicate.id}`} className="underline font-medium">
            Open their profile
          </a>
        </div>
      )}
      {erased && (
        <div
          className="rounded-xl px-4 py-2.5 text-sm mb-4"
          style={{ background: 'rgba(177,73,25,0.12)', border: '1px solid rgba(177,73,25,0.35)', color: '#B14919' }}
        >
          That number belongs to an erased record and cannot be reused.
        </div>
      )}
      <form action={create} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <Field label="Phone *" name="phone" type="tel" required placeholder="012-3456789" />
        <Field label="Name" name="name" placeholder="Full name" />
        <Field label="Email" name="email" type="email" placeholder="email@example.com" />
        <Field label="Address" name="address" placeholder="Home address" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
          <select name="source" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            {CUSTOMER_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Field label="Notes" name="notes" placeholder="Any special notes…" />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="marketingConsent" className="rounded" />
          Marketing consent given
        </label>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="bg-rose-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-rose-700">
            Create Customer
          </button>
          <a href="/customers" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Cancel</a>
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
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
      />
    </div>
  )
}
