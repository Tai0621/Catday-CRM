import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { ROOM_TYPES } from '@/lib/constants'

export default async function NewRoomPage() {
  await requireAuth()

  async function create(data: FormData) {
    'use server'
    const count = await db.room.count()
    const type = (data.get('type') as string) || 'Standard'
    const capRaw = parseInt((data.get('capacity') as string) || '', 10)
    const capacity = Number.isFinite(capRaw) && capRaw >= 1 ? capRaw : type === 'Suite' ? 6 : type === 'DayStay' ? 1 : 2
    await db.room.create({
      data: {
        name: data.get('name') as string,
        type,
        capacity,
        description: (data.get('description') as string) || null,
        sortOrder: count,
      },
    })
    redirect('/rooms')
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Add Room</h1>
      <form action={create} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Room Name *</label>
          <input name="name" required placeholder="e.g. Suite A, Room 1, Day Stay 3"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select name="type" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300">
            {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Capacity (cats)</label>
          <input name="capacity" type="number" min="1" max="10" placeholder="blank = by type (Standard 2, Suite 6)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <input name="description" placeholder="Optional notes about this room"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="bg-rose-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-rose-700">Add Room</button>
          <a href="/rooms" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">Cancel</a>
        </div>
      </form>
    </div>
  )
}
