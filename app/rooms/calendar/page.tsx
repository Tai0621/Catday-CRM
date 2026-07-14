import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { SEGMENTS } from '@/lib/segments'

const DAY = 24 * 60 * 60 * 1000
const DAYS_SHOWN = 14

// Room availability across dates — "is Suite 2 free from the 18th to the 23rd?"
export default async function RoomCalendarPage() {
  await requireAuth()
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + DAYS_SHOWN * DAY)

  const [rooms, bookings] = await Promise.all([
    db.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.appointment.findMany({
      where: {
        type: 'Boarding',
        status: { notIn: ['Cancelled', 'NoShow', 'Completed'] },
        scheduledAt: { lt: end },
        OR: [{ endsAt: { gte: start } }, { endsAt: null, scheduledAt: { gte: start } }],
      },
      include: { cat: true, room: true },
    }),
  ])

  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => new Date(start.getTime() + i * DAY))
  const seg = SEGMENTS.boarding
  const unassigned = bookings.filter(b => !b.roomId)

  function stayFor(roomId: string, day: Date) {
    const dayEnd = new Date(day.getTime() + DAY)
    return bookings.find(b =>
      b.roomId === roomId &&
      b.scheduledAt < dayEnd &&
      (b.endsAt ? b.endsAt > day : b.scheduledAt >= day),
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Room Calendar
          </h1>
          <p className="text-sm cd-muted">Next {DAYS_SHOWN} days · shaded = booked. Use this before promising boarding dates.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/rooms" className="cd-btn-sec text-sm">Room status</Link>
          <Link href="/appointments/new" className="cd-btn text-sm">+ Book boarding</Link>
        </div>
      </div>

      {unassigned.length > 0 && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(231,206,122,0.3)', border: '1px solid rgba(231,206,122,0.5)', color: '#2D1907' }}>
          <strong>{unassigned.length} boarding booking{unassigned.length === 1 ? '' : 's'} without a room:</strong>{' '}
          {unassigned.map(b => (
            <Link key={b.id} href={`/appointments/${b.id}`} className="cd-link">
              {b.cat.name} ({b.scheduledAt.toLocaleDateString('en-MY')})
            </Link>
          )).reduce((acc: React.ReactNode[], el, i) => (i === 0 ? [el] : [...acc, ' · ', el]), [])}
        </div>
      )}

      <div className="cd-card overflow-x-auto">
        <table className="text-xs" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead>
            <tr className="cd-thead">
              <th style={{ position: 'sticky', left: 0, background: '#ECDBB6' }}>Room</th>
              {days.map(d => (
                <th key={d.getTime()} className="text-center" style={{ minWidth: '4.2rem', padding: '0.5rem 0.25rem' }}>
                  <div>{d.toLocaleDateString('en-MY', { weekday: 'short' })}</div>
                  <div style={{ fontWeight: 700 }}>{d.getDate()}/{d.getMonth() + 1}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="cd-tbody">
            {rooms.length === 0 && (
              <tr><td colSpan={DAYS_SHOWN + 1} className="px-4 py-8 text-center cd-muted">
                No rooms set up · <Link href="/rooms/new" className="cd-link">Add room</Link>
              </td></tr>
            )}
            {rooms.map(room => (
              <tr key={room.id}>
                <td className="px-3 py-2 font-medium whitespace-nowrap"
                  style={{ color: '#2D1907', position: 'sticky', left: 0, background: '#ECDBB6' }}>
                  {room.name}
                  <span className="cd-muted font-normal"> · {room.type}</span>
                </td>
                {days.map(d => {
                  const stay = stayFor(room.id, d)
                  return (
                    <td key={d.getTime()} className="text-center" style={{ padding: '0.2rem' }}>
                      {stay ? (
                        <Link href={`/appointments/${stay.id}`}
                          className="block rounded px-1 py-1.5 truncate font-medium hover:opacity-80"
                          style={{ background: seg.bg, color: seg.text, maxWidth: '5rem' }}
                          title={`${stay.cat.name} · ${stay.scheduledAt.toLocaleDateString('en-MY')} → ${stay.endsAt?.toLocaleDateString('en-MY') ?? '?'}`}>
                          {stay.cat.name}
                        </Link>
                      ) : (
                        <div className="rounded" style={{ height: '1.9rem', background: 'rgba(45,25,7,0.03)' }} />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
