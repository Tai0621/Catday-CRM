import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { REVENUE_CATEGORIES } from '@/lib/constants'

export default async function NewTransactionPage() {
  await requireAuth()

  const customers = await db.customer.findMany({ orderBy: { name: 'asc' } })

  async function create(data: FormData) {
    'use server'
    await db.transaction.create({
      data: {
        date: new Date(data.get('date') as string),
        total: parseFloat(data.get('total') as string),
        category: data.get('category') as string,
        customerId: (data.get('customerId') as string) || null,
        reference: (data.get('reference') as string) || null,
        notes: (data.get('notes') as string) || null,
      },
    })
    redirect('/revenue')
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Add Transaction</h1>
      <form action={create} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
          <input name="date" type="date" required defaultValue={today}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
          <select name="category" required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            {REVENUE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (RM) *</label>
          <input name="total" type="number" step="0.01" required placeholder="0.00"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
          <select name="customerId"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">— Anonymous —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
          <input name="reference" placeholder="Receipt no., invoice…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="bg-rose-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-rose-700">Save</button>
          <a href="/revenue" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Cancel</a>
        </div>
      </form>
    </div>
  )
}
