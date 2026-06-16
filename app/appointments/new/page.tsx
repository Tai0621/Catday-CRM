import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { APPOINTMENT_TYPES } from '@/lib/constants'

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; catId?: string }>
}) {
  await requireAuth()
  const { customerId, catId } = await searchParams

  const [customers, cats, rooms] = await Promise.all([
    db.customer.findMany({ orderBy: { name: 'asc' } }),
    db.cat.findMany({ include: { customer: true }, orderBy: { name: 'asc' } }),
    db.room.findMany({ where: { isActive: true, status: 'Available' }, orderBy: { sortOrder: 'asc' } }),
  ])

  async function create(data: FormData) {
    'use server'
    const scheduledAt = new Date(data.get('scheduledAt') as string)
    const duration = parseInt(data.get('duration') as string || '60', 10)
    const endsAt = new Date(scheduledAt.getTime() + duration * 60 * 1000)

    await db.appointment.create({
      data: {
        customerId: data.get('customerId') as string,
        catId: data.get('catId') as string,
        type: data.get('type') as string,
        scheduledAt,
        endsAt,
        roomId: (data.get('roomId') as string) || null,
        price: data.get('price') ? parseFloat(data.get('price') as string) : null,
        notes: (data.get('notes') as string) || null,
        status: 'Scheduled',
      },
    })
    redirect('/appointments')
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Book Appointment</h1>
      <form action={create} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
          <select name="customerId" required defaultValue={customerId ?? ''}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cat *</label>
          <select name="catId" required defaultValue={catId ?? ''}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">Select cat…</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name} ({c.customer.name ?? c.customer.phone})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
          <select name="type" required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time *</label>
          <input name="scheduledAt" type="datetime-local" required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Duration (min)</label>
            <input name="duration" type="number" defaultValue="60" min="15" step="15"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price (RM)</label>
            <input name="price" type="number" step="0.01" placeholder="0.00"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Room (boarding)</label>
          <select name="roomId"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            <option value="">No room</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.type})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea name="notes" rows={3} placeholder="Special instructions…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="bg-rose-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-rose-700">Book</button>
          <a href="/appointments" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Cancel</a>
        </div>
      </form>
    </div>
  )
}
