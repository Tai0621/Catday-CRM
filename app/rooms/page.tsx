import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { buildWall, wallDays, type WallRoom } from '@/lib/boarding-wall'
import { CabinetUnit, GLASS } from '@/app/components/CabinetUnit'

// The Boarding Wall — the boarding landing page, and now the only rooms tab.
//
// It replaces a table of room names with the wall itself, because a carer who
// wants to know whether Mochi is in 12 or 14 should not have to match a number
// to a door. Every unit is a button into that room.
//
// The old /rooms/list lives on at the bottom of this page rather than as its
// own tab. Two tabs for one set of rooms made a reader choose between them, and
// the list counted occupancy off `Room.status` while the wall derived it from
// the day's stays — so the two could disagree about the same morning. Both now
// read one `buildWall`, which makes that disagreement impossible rather than
// merely unlikely.
//
// The geometry comes from RoomZone / Room, never from a traced picture of the
// maker's drawing: these cabinets are still being built, and a traced elevation
// would freeze the layout behind a deploy the first time one moves.
export default async function BoardingWallPage({ searchParams }: {
  searchParams: Promise<{ date?: string; q?: string }>
}) {
  await requireAuth()
  const { date, q } = await searchParams
  const query = (q ?? '').trim()

  const [wall, days] = await Promise.all([buildWall(date), wallDays(14)])
  // Changing the day keeps the search: losing it would silently widen a result
  // somebody was reading.
  const to = (d: string) => {
    const p = new URLSearchParams()
    if (d !== wall.todayKey) p.set('date', d)
    if (query) p.set('q', query)
    const s = p.toString()
    return s ? `/rooms?${s}` : '/rooms'
  }
  const roomHref = (id: string) => (wall.isToday ? `/rooms/${id}` : `/rooms/${id}?date=${wall.dayKey}`)

  const tiles = [
    { label: 'Rooms in use', n: wall.totals.occupied, key: 'Occupied' },
    { label: 'Free', n: wall.totals.available, key: 'Available' },
    { label: 'Cleaning', n: wall.totals.cleaning, key: 'Cleaning' },
    { label: 'Out today', n: wall.totals.leaving, key: 'Out' },
  ]

  const empty = wall.zones.length === 0

  // Setting a room's standing flag — the one thing the old list page could do
  // that nothing else non-manager could (room settings are manager-only).
  //
  // `Occupied` is deliberately not offered even though it is a valid value in
  // ROOM_STATUSES. Occupancy is derived from the day's stays, so writing the
  // flag by hand changes nothing the wall reads — a control that appears to
  // work and does nothing is worse than no control.
  async function setRoomStatus(data: FormData) {
    'use server'
    const roomId = data.get('roomId') as string
    const status = data.get('status') as string
    if (!SETTABLE.includes(status as (typeof SETTABLE)[number])) return
    await db.room.update({ where: { id: roomId }, data: { status } })
    revalidatePath('/rooms')
    revalidatePath(`/rooms/${roomId}`)
  }

  const matches = (r: WallRoom) => {
    if (!query) return true
    const hay = `${r.name} ${r.type} ${r.occupant ?? ''} ${r.description ?? ''}`.toLowerCase()
    return hay.includes(query.toLowerCase())
  }
  const listed = wall.rooms.filter(matches)
  const byType = groupByType(listed)

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Boarding Wall</h1>
          <p className="text-sm cd-muted">
            {wall.isToday ? 'Today' : wall.dayKey} · every unit opens its room
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {tiles.map(t => (
            <div key={t.label} className="rounded-xl px-3.5 py-2 text-center"
              style={{
                minWidth: 88,
                background: GLASS[t.key]?.chip ?? 'rgba(184,144,43,0.2)',
                border: '1px solid rgba(45,25,7,0.12)',
              }}>
              <div className="text-xl font-bold" style={{ color: t.key === 'Occupied' ? '#8d3a14' : '#2D1907' }}>{t.n}</div>
              <div className="text-xs cd-muted">{t.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* The day being shown. A wall answers "now"; boarding mostly asks about
          later, so the strip is what stops this needing a second page. */}
      <div className="cd-card p-2.5 flex items-center gap-2.5">
        <span className="cd-label mb-0 whitespace-nowrap">Showing</span>
        <div className="flex gap-1 flex-grow overflow-x-auto">
          {days.map(d => {
            const on = d.key === wall.dayKey
            return (
              <Link key={d.key} href={to(d.key)} className="flex-grow text-center rounded-lg py-1 px-1.5"
                style={{
                  background: on ? '#B14919' : 'rgba(45,25,7,0.05)',
                  color: on ? '#ECDBB6' : 'rgba(45,25,7,0.6)',
                  border: `1px solid ${on ? '#B14919' : 'transparent'}`,
                  minWidth: 40,
                }}>
                <div className="text-[9px] uppercase tracking-wider opacity-70">{d.dow}</div>
                <div className="text-sm font-semibold leading-tight">{d.dom}</div>
              </Link>
            )
          })}
        </div>
      </div>

      {empty && (
        <div className="cd-card px-4 py-10 text-center space-y-3">
          <p className="text-sm cd-muted">
            No cabinet banks are set up yet, so there is nothing to draw.
          </p>
          <Link href="/rooms/arrange" className="cd-btn inline-block">Set up the wall</Link>
        </div>
      )}

      {wall.zones.map(z => {
        const occ = z.rooms.filter(r => r.status === 'Occupied').length
        return (
          <section key={z.id} className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold" style={{ fontFamily: 'var(--font-brand)', color: '#2D1907' }}>{z.code}</span>
              <span className="text-xs cd-muted">{z.name}</span>
              <span className="flex-grow" />
              <span className="text-xs cd-muted">
                {occ} of {z.rooms.length} {z.kind === 'Staging' ? 'cubbies in use' : 'occupied'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${z.cols}, ${z.kind === 'Staging' ? 150 : z.rooms.some(r => r.unitKind === 'suite') ? 232 : z.rooms.some(r => r.unitKind === 'porthole') ? 174 : 116}px)`,
                gridAutoRows: `${z.kind === 'Staging' ? 71 : z.rooms.some(r => r.unitKind === 'suite') ? 147 : z.rooms.some(r => r.unitKind === 'porthole') ? 105 : 84}px`,
                gap: 7,
                justifyContent: 'start',
                padding: 7,
                borderRadius: 9,
                background: '#F3EBD0',
                border: '1.5px solid rgba(45,25,7,0.72)',
                width: 'fit-content',
              }}>
                {z.rooms.map(r => <CabinetUnit key={r.id} room={r} href={roomHref(r.id)} />)}
              </div>
            </div>
          </section>
        )
      })}

      {/* Rooms with no place on the wall. Never hidden: a cat in a room the
          screen does not draw is the one failure mode that could harm an animal. */}
      {wall.unplaced.length > 0 && (
        <section className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-bold" style={{ color: '#B14919' }}>Unplaced</span>
            <span className="text-xs cd-muted">
              {wall.unplaced.length} room{wall.unplaced.length === 1 ? '' : 's'} not yet given a place on the wall
            </span>
            <span className="flex-grow" />
            <Link href="/rooms/arrange" className="cd-link text-xs">Arrange the wall →</Link>
          </div>
          <div className="flex flex-wrap gap-2" style={{ padding: 7, borderRadius: 9, background: 'rgba(177,73,25,0.06)', border: '1px dashed rgba(177,73,25,0.35)' }}>
            {wall.unplaced.map(r => (
              <div key={r.id} style={{ width: 116, height: 84, display: 'flex' }}>
                <CabinetUnit room={r} href={roomHref(r.id)} gridded={false} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-4 flex-wrap pt-1">
        {[
          { label: 'In house', key: 'Occupied' },
          { label: 'Free', key: 'Available' },
          { label: 'Cleaning', key: 'Cleaning' },
          { label: 'Out of service', key: 'Maintenance' },
        ].map(l => (
          <div key={l.key} className="flex items-center gap-1.5">
            <span style={{
              width: 16, height: 12, borderRadius: 3, display: 'inline-block',
              background: GLASS[l.key].glass, border: `1px solid ${GLASS[l.key].edge}`,
            }} />
            <span className="text-xs cd-muted">{l.label}</span>
          </div>
        ))}
        <span className="flex-grow" />
        <Link href="/rooms/calendar" className="cd-link text-xs">Room calendar</Link>
        <Link href="/rooms/arrange" className="cd-link text-xs">Arrange</Link>
      </div>

      {/* The list, folded in from what used to be its own tab. Kept because it
          is faster to search than a picture, it is what a screen reader reads,
          and it is the fallback when the wall looks wrong. Closed by default so
          the landing page stays the wall; a search opens it. */}
      <details id="all-rooms" open={!!query} className="cd-card">
        <summary className="px-4 py-3 cursor-pointer select-none flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: '#2D1907' }}>All rooms</span>
          <span className="text-xs cd-muted">
            {wall.rooms.length} room{wall.rooms.length === 1 ? '' : 's'} · {wall.totals.available} free
            {wall.totals.maintenance > 0 && ` · ${wall.totals.maintenance} out of service`}
          </span>
          <span className="flex-grow" />
          <span className="text-xs cd-muted">search, set cleaning, add a room</span>
        </summary>

        <div className="px-4 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(45,25,7,0.08)', paddingTop: '0.9rem' }}>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            {/* Plain GET, so a search is a link somebody can keep. The day rides
                along or searching would silently drop them back to today. */}
            <form method="get" action="/rooms" className="flex gap-2 items-center">
              {!wall.isToday && <input type="hidden" name="date" value={wall.dayKey} />}
              <input name="q" defaultValue={query} placeholder="Room, type, or cat"
                className="cd-input" style={{ width: 220, padding: '0.4rem 0.7rem', fontSize: '0.8rem' }} />
              <button type="submit" className="cd-btn-sec text-xs">Search</button>
              {query && <Link href={wall.isToday ? '/rooms' : `/rooms?date=${wall.dayKey}`} className="cd-link text-xs">Clear</Link>}
            </form>
            <Link href="/rooms/new" className="cd-btn text-xs">+ Add Room</Link>
          </div>

          {listed.length === 0 ? (
            <p className="text-sm cd-muted py-6 text-center">
              {wall.rooms.length === 0 ? 'No rooms set up yet.' : `Nothing matches “${query}”.`}
            </p>
          ) : (
            byType.map(([type, group]) => (
              <section key={type} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold uppercase" style={{ color: '#2D1907', letterSpacing: '0.08em' }}>
                    {TYPE_LABEL[type] ?? type}
                  </h3>
                  <span className="text-xs cd-muted">
                    {group.filter(r => r.status === 'Available').length}/{group.length} free
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid rgba(45,25,7,0.1)' }}>
                  <table className="w-full text-sm">
                    <thead><tr className="cd-thead">
                      <th>Room</th>
                      <th>{wall.isToday ? 'In today' : `In on ${wall.dayKey}`}</th>
                      <th>State</th>
                      <th>Set</th>
                    </tr></thead>
                    <tbody className="cd-tbody">
                      {group.map(r => {
                        const g = GLASS[r.status] ?? GLASS.Available
                        return (
                          <tr key={r.id}>
                            <td className="px-4 py-2">
                              <div className="whitespace-nowrap">
                                <Link href={roomHref(r.id)} className="font-medium cd-link">{r.name}</Link>
                                <span className="cd-muted text-xs"> · {r.capacity} cat{r.capacity === 1 ? '' : 's'}</span>
                                {!r.zoneId && <span className="cd-muted text-xs"> · unplaced</span>}
                              </div>
                              {/* The only place a room's own notes are readable.
                                  Settings can edit them, but that is manager-only. */}
                              {r.description && <div className="text-xs cd-muted">{r.description}</div>}
                            </td>
                            <td className="px-4 py-2" style={{ color: '#2D1907' }}>
                              {r.occupant ?? <span className="cd-muted">—</span>}
                            </td>
                            <td className="px-4 py-2">
                              <span className="cd-pill" style={{ background: g.chip, color: g.pill }}>{r.status}</span>
                            </td>
                            <td className="px-4 py-2">
                              {/* Occupancy is not a flag, so a room with a cat
                                  in it has nothing to set — say why rather than
                                  showing buttons that would not take. */}
                              {r.status === 'Occupied' ? (
                                <span className="text-xs cd-muted">occupied — set from the stay</span>
                              ) : (
                                <form action={setRoomStatus} className="flex gap-1 flex-wrap">
                                  <input type="hidden" name="roomId" value={r.id} />
                                  {SETTABLE.map(s => (
                                    <button key={s} name="status" value={s} type="submit"
                                      disabled={r.roomStatus === s}
                                      className="text-xs px-2 py-1 rounded"
                                      style={r.roomStatus === s
                                        ? { background: 'rgba(45,25,7,0.08)', color: 'rgba(45,25,7,0.35)', cursor: 'default', border: '1px solid rgba(45,25,7,0.08)' }
                                        : { background: '#F2EDE0', color: '#2D1907', border: '1px solid rgba(45,25,7,0.2)' }}>
                                      {SETTABLE_LABEL[s]}
                                    </button>
                                  ))}
                                </form>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </div>
      </details>
    </div>
  )
}

/** The statuses that are actually a standing flag somebody sets by hand. */
const SETTABLE = ['Available', 'Cleaning', 'Maintenance'] as const
const SETTABLE_LABEL: Record<string, string> = {
  Available: 'Ready', Cleaning: 'Cleaning', Maintenance: 'Out of service',
}

const TYPE_ORDER = ['Suite', 'Standard', 'DayStay']
const TYPE_LABEL: Record<string, string> = { Suite: 'Suites', Standard: 'Standard Rooms', DayStay: 'Day Stay' }

function groupByType(rooms: WallRoom[]): [string, WallRoom[]][] {
  const map = new Map<string, WallRoom[]>()
  for (const r of rooms) {
    if (!map.has(r.type)) map.set(r.type, [])
    map.get(r.type)!.push(r)
  }
  return [...map.entries()].sort(
    (a, b) => (TYPE_ORDER.indexOf(a[0]) + 1 || 99) - (TYPE_ORDER.indexOf(b[0]) + 1 || 99),
  )
}
