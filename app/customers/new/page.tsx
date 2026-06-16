import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { normalisePhone } from '@/lib/phone'
import { CUSTOMER_SOURCES } from '@/lib/constants'

export default async function NewCustomerPage() {
  await requireAuth()

  async function create(data: FormData) {
    'use server'
    const phone = normalisePhone(data.get('phone') as string)
    await db.customer.create({
      data: {
        phone,
        name: (data.get('name') as string) || null,
        email: (data.get('email') as string) || null,
        address: (data.get('address') as string) || null,
        source: (data.get('source') as string) || 'WalkIn',
        marketingConsent: data.get('marketingConsent') === 'on',
        notes: (data.get('notes') as string) || null,
        needsDetails: false,
      },
    })
    redirect('/customers')
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">New Customer</h1>
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
