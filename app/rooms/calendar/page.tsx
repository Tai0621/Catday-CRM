import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { SEGMENTS } from '@/lib/segments'
import { RESIDENCY_TYPE } from '@/lib/constants'

const DAY = 24 * 60 * 60 * 1000
const DAYS_SHOWN = 14
const GROOM_TYPES = ['Grooming', 'Bath', 'Diagnosis']
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Room availability across dates — "is Suite 2 free from the 18th to the 23rd?"
// Weeks are visually divided; boarding stays that also have a grooming session
// in the window are flagged (✂) so front desk sees the cross-over at a glance.
export default async function RoomCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ free?: string }>
}) {
  await requireAuth()
  const { free } = await searchParams
  const freeOnly = free === '1'

  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + DAYS_SHOWN * DAY)
  const todayKey = dayKey(now)

  const [rooms, bookings, grooming] = await Promise.all([
    db.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.appointment.findMany({
      where: {
        type: { in: ['Boarding', RESIDENCY_TYPE] },
        status: { notIn: ['Cancelled', 'NoShow', 'Completed'] },
        scheduledAt: { lt: end },
        OR: [{ endsAt: { gte: start } }, { endsAt: null, scheduledAt: { gte: start } }],
      },
      include: { cat: true, room: true },
    }),
    // Grooming/bath/diagnosis in the same window — linked onto boarding stays
    db.appointment.findMany({
      where: {
        type: { in: GROOM_TYPES },
        status: { notIn: ['Cancelled', 'NoShow'] },
        scheduledAt: { gte: start, lt: end },
      },
      select: { catId: true, scheduledAt: true },
    }),
  ])

  // catId → sorted list of grooming day-keys within the window
  const groomByCat = new Map<string, string[]>()
  for (const g of grooming) {
    const k = dayKey(g.scheduledAt)
    const arr = groomByCat.get(g.catId) ?? []
    if (!arr.includes(k)) arr.push(k)
    groomByCat.set(g.catId, arr)
  }

  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => new Date(start.getTime() + i * DAY))
  const seg = SEGMENTS.boarding
  const groomColor = SEGMENTS.grooming.color
  const unassigned = bookings.filter(b => !b.roomId)

  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6
  const isToday = (d: Date) => dayKey(d) === todayKey
  const weekDivider = (d: Date, i: number) => i > 0 && d.getDay() === 1 // Monday starts a new week
  const dayBg = (d: Date) => (isToday(d) ? 'rgba(177,73,25,0.10)' : isWeekend(d) ? 'rgba(45,25,7,0.05)' : 'transparent')
  const dividerLeft = (d: Date, i: number) => (weekDivider(d, i) ? '2px solid rgba(45,25,7,0.28)' : undefined)

  // Rooms hold multiple cats, so each stay gets its own bar-row under the room.
  type Stay = (typeof bookings)[number]
  const staysByRoom = new Map<string, Stay[]>()
  for (const b of bookings) {
    if (!b.roomId) continue
    const arr = staysByRoom.get(b.roomId) ?? []
    arr.push(b)
    staysByRoom.set(b.roomId, arr)
  }

  // A stay's contiguous bar within the visible window, or null if off-window.
  function stayBar(stay: Stay) {
    let startIdx = -1, endIdx = -1
    for (let idx = 0; idx < DAYS_SHOWN; idx++) {
      const day = days[idx], dayEnd = new Date(day.getTime() + DAY)
      const covers = stay.scheduledAt < dayEnd && (stay.endsAt ? stay.endsAt > day : stay.scheduledAt >= day)
      if (covers) { if (startIdx < 0) startIdx = idx; endIdx = idx }
    }
    if (startIdx < 0) return null
    const span = endIdx - startIdx + 1
    const spanKeys = new Set(Array.from({ length: span }, (_, k) => dayKey(days[startIdx + k])))
    return {
      startIdx, span,
      startsBefore: stay.scheduledAt < days[startIdx],
      endsAfter: stay.endsAt != null && stay.endsAt > new Date(days[startIdx + span - 1].getTime() + DAY),
      groomDays: (groomByCat.get(stay.catId) ?? []).filter(k => spanKeys.has(k)),
    }
  }
  type Bar = NonNullable<ReturnType<typeof stayBar>>

  // "Empty" = no stays at all in the window (the toggle keeps its meaning).
  const bookedRoomIds = new Set(bookings.filter(b => b.roomId).map(b => b.roomId as string))
  const freeRoomCount = rooms.filter(r => !bookedRoomIds.has(r.id)).length
  const shownRooms = freeOnly ? rooms.filter(r => !bookedRoomIds.has(r.id)) : rooms

  const emptyTd = (i: number) => (
    <td key={`e${i}`} className="text-center" style={{ padding: '0.2rem', background: dayBg(days[i]), borderLeft: dividerLeft(days[i], i) }}>
      <div className="rounded" style={{ height: '1.9rem', background: 'rgba(45,25,7,0.03)' }} />
    </td>
  )
  const barTd = (stay: Stay, bar: Bar) => (
    <td key="bar" colSpan={bar.span} style={{ padding: '0.2rem', borderLeft: dividerLeft(days[bar.startIdx], bar.startIdx) }}>
      <Link href={`/appointments/${stay.id}`}
        className="flex items-center gap-1 px-2 truncate font-medium hover:opacity-80"
        style={{
          background: seg.bg, color: seg.text, height: '1.9rem',
          borderRadius: `${bar.startsBefore ? 0 : 6}px ${bar.endsAfter ? 0 : 6}px ${bar.endsAfter ? 0 : 6}px ${bar.startsBefore ? 0 : 6}px`,
          borderLeft: bar.startsBefore ? `3px solid ${seg.color}` : undefined,
          borderRight: bar.endsAfter ? `3px solid ${seg.color}` : undefined,
          boxShadow: bar.groomDays.length > 0 ? `inset 0 -3px 0 ${groomColor}` : undefined,
        }}
        title={`${stay.cat.name} · ${stay.scheduledAt.toLocaleDateString('en-MY')} → ${stay.endsAt?.toLocaleDateString('en-MY') ?? '?'}`
          + (bar.groomDays.length > 0 ? `\n✂ Grooming: ${bar.groomDays.map(k => { const [, m, d] = k.split('-'); return `${Number(d)}/${Number(m)}` }).join(', ')}` : '')}>
        {bar.startsBefore && '← '}
        {bar.groomDays.length > 0 && <span style={{ color: groomColor, fontWeight: 700 }}>✂</span>}
        <span className="truncate">{stay.cat.name}</span>
        {bar.endsAfter && ' →'}
      </Link>
    </td>
  )
  const stayRowCells = (stay: Stay, bar: Bar) => {
    const cells: React.ReactNode[] = []
    for (let i = 0; i < bar.startIdx; i++) cells.push(emptyTd(i))
    cells.push(barTd(stay, bar))
    for (let i = bar.startIdx + bar.span; i < DAYS_SHOWN; i++) cells.push(emptyTd(i))
    return cells
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#2D1907' }}>
            <span className="rounded-full" style={{ width: 8, height: 8, background: seg.color }} />
            Room Calendar
          </h1>
          <p className="text-sm cd-muted">Next {DAYS_SHOWN} days · one bar = one stay. Use this before promising boarding dates.</p>
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

      {/* Free-rooms toggle + legend */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/rooms/calendar" className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={!freeOnly
            ? { background: '#2D1907', color: '#ECDBB6', fontWeight: 600 }
            : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' }}>
          All rooms ({rooms.length})
        </Link>
        <Link href="/rooms/calendar?free=1" className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={freeOnly
            ? { background: seg.color, color: '#F2EDE0', fontWeight: 600 }
            : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.55)', border: '1px solid rgba(45,25,7,0.12)' }}>
          Free next {DAYS_SHOWN} days ({freeRoomCount})
        </Link>
        <span className="ml-auto flex items-center gap-3 text-xs cd-muted">
          <span className="flex items-center gap-1"><span className="rounded" style={{ width: 14, height: 10, background: seg.bg, border: `1px solid ${seg.color}` }} /> boarding</span>
          <span className="flex items-center gap-1" style={{ color: groomColor }}>✂ grooming</span>
          <span className="flex items-center gap-1"><span className="rounded" style={{ width: 12, height: 10, background: 'rgba(177,73,25,0.10)' }} /> today</span>
        </span>
      </div>

      <div className="cd-card overflow-x-auto">
        <table className="text-xs" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead>
            <tr className="cd-thead">
              <th style={{ position: 'sticky', left: 0, background: '#ECDBB6', zIndex: 1 }}>Room</th>
              {days.map((d, i) => (
                <th key={d.getTime()} className="text-center"
                  style={{ minWidth: '4.2rem', padding: '0.5rem 0.25rem', background: dayBg(d), borderLeft: dividerLeft(d, i) }}>
                  <div style={{ color: isToday(d) ? '#B14919' : isWeekend(d) ? 'rgba(45,25,7,0.45)' : undefined, fontWeight: isToday(d) ? 700 : 400 }}>
                    {isToday(d) ? 'Today' : d.toLocaleDateString('en-MY', { weekday: 'short' })}
                  </div>
                  <div style={{ fontWeight: 700, color: isToday(d) ? '#B14919' : undefined }}>{d.getDate()}/{d.getMonth() + 1}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="cd-tbody">
            {shownRooms.length === 0 && (
              <tr><td colSpan={DAYS_SHOWN + 1} className="px-4 py-8 text-center cd-muted">
                {rooms.length === 0
                  ? <>No rooms set up · <Link href="/rooms/new" className="cd-link">Add room</Link></>
                  : `No rooms are free for the whole ${DAYS_SHOWN}-day window.`}
              </td></tr>
            )}
            {shownRooms.flatMap(room => {
              const bars = (staysByRoom.get(room.id) ?? [])
                .map(s => ({ stay: s, bar: stayBar(s) }))
                .filter((x): x is { stay: Stay; bar: Bar } => x.bar !== null)
                .sort((a, b) => a.bar.startIdx - b.bar.startIdx)
              const rowCount = Math.max(1, bars.length)
              const nameTd = (
                <td rowSpan={rowCount} className="px-3 py-2 font-medium whitespace-nowrap align-top"
                  style={{ color: '#2D1907', position: 'sticky', left: 0, background: '#ECDBB6', zIndex: 1 }}>
                  {room.name}
                  <span className="cd-muted font-normal"> · {room.type}</span>
                  <div className="text-[10px] cd-muted font-normal">holds {room.capacity}</div>
                </td>
              )
              if (bars.length === 0) {
                return [
                  <tr key={room.id}>{nameTd}{days.map((_, i) => emptyTd(i))}</tr>,
                ]
              }
              return bars.map(({ stay, bar }, ri) => (
                <tr key={stay.id}>
                  {ri === 0 && nameTd}
                  {stayRowCells(stay, bar)}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
