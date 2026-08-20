import { requireAuth } from '@/lib/auth'
import Link from 'next/link'
import { buildWall, wallDays } from '@/lib/boarding-wall'
import { CabinetUnit, GLASS } from '@/app/components/CabinetUnit'

// The Boarding Wall — the boarding landing page.
//
// It replaces a table of room names with the wall itself, because a carer who
// wants to know whether Mochi is in 12 or 14 should not have to match a number
// to a door. Every unit is a button into that room.
//
// The geometry comes from RoomZone / Room, never from a traced picture of the
// maker's drawing: these cabinets are still being built, and a traced elevation
// would freeze the layout behind a deploy the first time one moves.
export default async function BoardingWallPage({ searchParams }: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireAuth()
  const { date } = await searchParams

  const [wall, days] = await Promise.all([buildWall(date), wallDays(14)])
  const to = (d: string) => (d === wall.todayKey ? '/rooms' : `/rooms?date=${d}`)
  const roomHref = (id: string) => (wall.isToday ? `/rooms/${id}` : `/rooms/${id}?date=${wall.dayKey}`)

  const tiles = [
    { label: 'Rooms in use', n: wall.totals.occupied, key: 'Occupied' },
    { label: 'Free', n: wall.totals.available, key: 'Available' },
    { label: 'Cleaning', n: wall.totals.cleaning, key: 'Cleaning' },
    { label: 'Out today', n: wall.totals.leaving, key: 'Out' },
  ]

  const empty = wall.zones.length === 0

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
        <Link href="/rooms/list" className="cd-link text-xs">List view</Link>
        <Link href="/rooms/calendar" className="cd-link text-xs">Room calendar</Link>
        <Link href="/rooms/arrange" className="cd-link text-xs">Arrange</Link>
      </div>
    </div>
  )
}
