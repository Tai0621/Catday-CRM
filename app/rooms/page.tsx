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

  const statCards = [
    { label: 'Available', value: stats.available, bg: 'rgba(114,144,148,0.18)', color: '#2D1907', border: 'rgba(114,144,148,0.3)' },
    { label: 'Occupied', value: stats.occupied, bg: 'rgba(177,73,25,0.15)', color: '#B14919', border: 'rgba(177,73,25,0.25)' },
    { label: 'Cleaning', value: stats.cleaning, bg: 'rgba(231,206,122,0.35)', color: '#7a5c00', border: 'rgba(231,206,122,0.5)' },
    { label: 'Maintenance', value: stats.maintenance, bg: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)', border: 'rgba(45,25,7,0.12)' },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Room Tracker</h1>
        <Link href="/rooms/new" className="cd-btn">+ Add Room</Link>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {statCards.map(s => (
          <div key={s.label} className="rounded-xl px-4 py-3 text-center"
            style={{ background: s.bg, border: `1px solid ${s.border}` }}>
            <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs" style={{ color: s.color, opacity: 0.75 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {rooms.length === 0 ? (
        <div className="cd-card py-16 text-center">
          <p className="cd-muted mb-3">No rooms set up yet</p>
          <Link href="/rooms/new" className="cd-link text-sm">Add your first room</Link>
        </div>
      ) : (
        groupByType(rooms).map(([type, group]) => {
          const avail = group.filter(r => r.status === 'Available').length
          return (
            <section key={type} className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#2D1907', letterSpacing: '0.08em' }}>
                  {TYPE_LABEL[type] ?? type}
                </h2>
                <span className="text-xs cd-muted">{avail}/{group.length} free</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.map(room => {
                  const currentGuest = room.appointments[0]
                  const { borderColor, badgeStyle } = roomStyles(room.status)
                  return (
                    <div key={room.id} className="rounded-xl border-2 p-4 space-y-3"
                      style={{ background: '#ECDBB6', borderColor }}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-semibold" style={{ color: '#2D1907' }}>{room.name}</div>
                          <div className="text-xs cd-muted">{room.type}</div>
                        </div>
                        <span className="cd-pill" style={badgeStyle}>{room.status}</span>
                      </div>

                      {currentGuest && (
                        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(45,25,7,0.06)' }}>
                          <div className="font-medium" style={{ color: '#2D1907' }}>{currentGuest.cat.name}</div>
                          <div className="text-xs cd-muted">{currentGuest.customer.name ?? currentGuest.customer.phone}</div>
                        </div>
                      )}

                      {room.description && <p className="text-xs cd-muted">{room.description}</p>}

                      <form action={updateRoomStatus} className="flex gap-1 flex-wrap">
                        <input type="hidden" name="roomId" value={room.id} />
                        {ROOM_STATUSES.map(s => (
                          <button key={s} name="status" value={s} type="submit"
                            disabled={room.status === s}
                            className="text-xs px-2 py-1 rounded transition-opacity"
                            style={room.status === s
                              ? { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.35)', cursor: 'default', border: '1px solid rgba(45,25,7,0.08)' }
                              : { background: '#F2EDE0', color: '#2D1907', border: '1px solid rgba(45,25,7,0.2)' }
                            }>
                            {s}
                          </button>
                        ))}
                      </form>

                      <Link href={`/rooms/${room.id}`} className="block text-xs cd-link">Edit room →</Link>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

// Group rooms by type, in a stable display order (Suites first, then Standard, then anything else)
const TYPE_ORDER = ['Suite', 'Standard', 'DayStay']
const TYPE_LABEL: Record<string, string> = { Suite: 'Suites', Standard: 'Standard Rooms', DayStay: 'Day Stay' }
function groupByType<T extends { type: string }>(rooms: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const r of rooms) {
    if (!map.has(r.type)) map.set(r.type, [])
    map.get(r.type)!.push(r)
  }
  return [...map.entries()].sort(
    (a, b) => (TYPE_ORDER.indexOf(a[0]) + 1 || 99) - (TYPE_ORDER.indexOf(b[0]) + 1 || 99),
  )
}

function roomStyles(status: string) {
  const map: Record<string, { borderColor: string; badgeStyle: React.CSSProperties }> = {
    Available:   { borderColor: 'rgba(114,144,148,0.4)', badgeStyle: { background: 'rgba(114,144,148,0.2)', color: '#729094' } },
    Occupied:    { borderColor: 'rgba(177,73,25,0.4)',   badgeStyle: { background: 'rgba(177,73,25,0.15)', color: '#B14919' } },
    Cleaning:    { borderColor: 'rgba(231,206,122,0.6)', badgeStyle: { background: 'rgba(231,206,122,0.4)', color: '#7a5c00' } },
    Maintenance: { borderColor: 'rgba(45,25,7,0.18)',    badgeStyle: { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.5)' } },
  }
  return map[status] ?? { borderColor: 'rgba(45,25,7,0.18)', badgeStyle: { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.5)' } }
}
