import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ROOM_STATUSES } from '@/lib/constants'

export default async function RoomsPage() {
  await requireAuth()

  const rooms = await db.room.findMany({
    where: { isActive: true },
    include: {
      appointments: {
        where: { status: 'CheckedIn' },
        include: { cat: true, customer: true },
        take: 1,
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  const stats = {
    available: rooms.filter(r => r.status === 'Available').length,
    occupied: rooms.filter(r => r.status === 'Occupied').length,
    cleaning: rooms.filter(r => r.status === 'Cleaning').length,
    maintenance: rooms.filter(r => r.status === 'Maintenance').length,
  }

  async function updateRoomStatus(data: FormData) {
    'use server'
    const roomId = data.get('roomId') as string
    const status = data.get('status') as string
    await db.room.update({ where: { id: roomId }, data: { status } })
    redirect('/rooms')
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Room Tracker</h1>
        <Link href="/rooms/new" className="bg-rose-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-rose-700">+ Add Room</Link>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-green-700">{stats.available}</div>
          <div className="text-xs text-green-600">Available</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-red-700">{stats.occupied}</div>
          <div className="text-xs text-red-600">Occupied</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{stats.cleaning}</div>
          <div className="text-xs text-amber-600">Cleaning</div>
        </div>
        <div className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-gray-600">{stats.maintenance}</div>
          <div className="text-xs text-gray-500">Maintenance</div>
        </div>
      </div>

      {rooms.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-gray-400 mb-3">No rooms set up yet</p>
          <Link href="/rooms/new" className="text-rose-600 hover:underline text-sm">Add your first room</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map(room => {
            const currentGuest = room.appointments[0]
            return (
              <div key={room.id} className={`bg-white rounded-xl border-2 p-4 space-y-3 ${roomBorderClass(room.status)}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{room.name}</div>
                    <div className="text-xs text-gray-400">{room.type}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roomBadgeClass(room.status)}`}>
                    {room.status}
                  </span>
                </div>

                {currentGuest && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <div className="font-medium">{currentGuest.cat.name}</div>
                    <div className="text-xs text-gray-500">{currentGuest.customer.name ?? currentGuest.customer.phone}</div>
                  </div>
                )}

                {room.description && (
                  <p className="text-xs text-gray-400">{room.description}</p>
                )}

                <form action={updateRoomStatus} className="flex gap-1 flex-wrap">
                  <input type="hidden" name="roomId" value={room.id} />
                  {ROOM_STATUSES.map(s => (
                    <button key={s} name="status" value={s} type="submit"
                      disabled={room.status === s}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${room.status === s ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-default' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
                      {s}
                    </button>
                  ))}
                </form>

                <Link href={`/rooms/${room.id}`} className="block text-xs text-rose-600 hover:underline">Edit room →</Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function roomBorderClass(status: string) {
  const m: Record<string, string> = {
    Available: 'border-green-200',
    Occupied: 'border-red-300',
    Cleaning: 'border-amber-200',
    Maintenance: 'border-gray-300',
  }
  return m[status] ?? 'border-gray-200'
}

function roomBadgeClass(status: string) {
  const m: Record<string, string> = {
    Available: 'bg-green-100 text-green-700',
    Occupied: 'bg-red-100 text-red-700',
    Cleaning: 'bg-amber-100 text-amber-700',
    Maintenance: 'bg-gray-100 text-gray-500',
  }
  return m[status] ?? 'bg-gray-100 text-gray-500'
}
