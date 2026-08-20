import Link from 'next/link'
import type { WallRoom } from '@/lib/boarding-wall'

// One unit of the boarding wall, drawn as the cabinet the maker is building:
// cream carcass, slatted vent capsule, glass door on hinges, the grey arch, the
// pale-green litter tray, and a porthole panel on the banks that have one.
//
// ONLY THE GLASS TAKES THE STATUS COLOUR. The cabinet is constant furniture.
// That is how the wall reads in life — you look through the door to see whether
// anyone is home — and it stops shelf brackets competing with the one signal
// that has to carry across the room.

const CARCASS = '#F3EBD0'
const OUTLINE = 'rgba(45,25,7,0.72)'
const HAIR = 'rgba(45,25,7,0.34)'
const PANEL = 'rgba(45,25,7,0.16)'
const TRAY = 'rgba(150,168,120,0.5)'

const SLATS = `repeating-linear-gradient(90deg, ${HAIR} 0 1px, transparent 1px 4px)`
const SLATS_VERT = `repeating-linear-gradient(0deg, ${HAIR} 0 1px, transparent 1px 4px)`

export const GLASS: Record<string, { glass: string; edge: string; fg: string; chip: string; pill: string }> = {
  Occupied:    { glass: 'rgba(177,73,25,0.30)',   edge: 'rgba(177,73,25,0.6)',   fg: '#5e2710',           chip: 'rgba(177,73,25,0.15)',   pill: '#8d3a14' },
  Available:   { glass: 'rgba(114,144,148,0.20)', edge: 'rgba(114,144,148,0.5)', fg: 'rgba(45,25,7,0.45)', chip: 'rgba(114,144,148,0.16)', pill: 'rgba(45,25,7,0.5)' },
  Cleaning:    { glass: 'rgba(231,206,122,0.55)', edge: 'rgba(184,144,43,0.6)',  fg: '#6b5000',           chip: 'rgba(231,206,122,0.4)',  pill: '#7a5c00' },
  Maintenance: { glass: 'rgba(45,25,7,0.12)',     edge: 'rgba(45,25,7,0.3)',     fg: 'rgba(45,25,7,0.38)', chip: 'rgba(45,25,7,0.07)',     pill: 'rgba(45,25,7,0.4)' },
}

const BADGE: Record<string, { bg: string; fg: string; title: string }> = {
  Health:  { bg: '#B14919', fg: '#ECDBB6', title: 'A red flag was raised on today’s care log' },
  Out:     { bg: '#B8902B', fg: '#2D1907', title: 'Leaving today' },
  Late:    { bg: 'rgba(177,73,25,0.85)', fg: '#ECDBB6', title: 'Care not finished and it is past mid-afternoon' },
  In:      { bg: 'rgba(45,25,7,0.4)', fg: '#ECDBB6', title: 'Arriving today, not checked in yet' },
}

export function CabinetUnit({ room, href, gridded = true }: { room: WallRoom; href: string; gridded?: boolean }) {
  const g = GLASS[room.status] ?? GLASS.Available
  const porthole = room.unitKind === 'porthole' || room.unitKind === 'suite'
  const cubby = room.unitKind === 'cubby'
  const suite = room.unitKind === 'suite'
  const arch = !porthole && !cubby
  const pct = room.careTotal > 0 ? Math.round((room.careDone / room.careTotal) * 100) : 0
  const complete = room.careTotal > 0 && room.careDone >= room.careTotal

  return (
    <Link
      href={href}
      title={`${room.name}${room.occupant ? ` · ${room.occupant}` : ''}`}
      style={{
        ...(gridded
          ? {
              gridColumn: `${room.col} / span ${room.colSpan}`,
              gridRow: `${room.row} / span ${room.rowSpan}`,
            }
          : {}),
        background: CARCASS,
        border: `1.5px solid ${OUTLINE}`,
        borderRadius: 7,
        padding: 4.5,
        display: 'flex',
        flexDirection: porthole ? 'row' : 'column',
        gap: 3,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55)',
        minWidth: 0,
      }}
      className="cd-unit"
    >
      {porthole && (
        <div style={{ width: '31%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ height: '28%', borderRadius: 3, border: `1px solid ${HAIR}`, background: SLATS_VERT }} />
          <div style={{ flexGrow: 1, borderRadius: 3, background: PANEL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: '76%', aspectRatio: '1', borderRadius: '50%',
              background: 'radial-gradient(circle at 32% 28%, #ffffff, rgba(255,255,255,0.7))',
              border: `1.5px solid ${OUTLINE}`,
            }} />
          </div>
        </div>
      )}

      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div style={{
          height: cubby ? 7 : 10, flexShrink: 0, borderRadius: 999,
          border: `1px solid ${HAIR}`, background: cubby ? PANEL : SLATS,
        }} />

        <div style={{
          position: 'relative', flexGrow: 1, overflow: 'hidden', borderRadius: 5,
          background: g.glass, border: `1px solid ${g.edge}`, color: g.fg,
        }}>
          {arch && <div style={{ position: 'absolute', right: '7%', top: '5%', width: '33%', height: '50%', borderRadius: '50% 50% 0 0', background: 'rgba(45,25,7,0.13)' }} />}
          <div style={{ position: 'absolute', left: '37%', top: 0, bottom: 0, width: 1, background: 'rgba(45,25,7,0.15)' }} />
          <div style={{ position: 'absolute', left: '7%', right: '7%', top: '53%', height: 2, borderRadius: 2, background: 'rgba(45,25,7,0.2)' }} />
          <div style={{
            position: 'absolute', left: '9%', right: '24%', bottom: '5%', height: '21%',
            background: TRAY, border: '1px solid rgba(45,25,7,0.18)', borderRadius: 2,
            clipPath: 'polygon(7% 0, 93% 0, 100% 100%, 0 100%)',
          }} />
          <div style={{ position: 'absolute', left: -3, top: '50%', width: 6, height: 6, marginTop: -3, borderRadius: '50%', border: `1px solid ${HAIR}`, background: CARCASS }} />
          <div style={{ position: 'absolute', right: -3, top: '50%', width: 6, height: 6, marginTop: -3, borderRadius: '50%', border: `1px solid ${HAIR}`, background: CARCASS }} />

          <div style={{ position: 'relative', zIndex: 2, height: '100%', boxSizing: 'border-box', padding: '4px 5px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.03em', opacity: 0.55, fontFamily: 'var(--font-brand)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {room.name}
              </span>
              {room.badge && (
                <span
                  title={BADGE[room.badge].title}
                  style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    padding: '1px 4px', borderRadius: 999, whiteSpace: 'nowrap',
                    background: BADGE[room.badge].bg, color: BADGE[room.badge].fg,
                  }}>
                  {room.badge}
                </span>
              )}
            </div>

            <span style={{
              flexGrow: 1, display: 'flex', alignItems: 'center',
              fontSize: suite ? 15 : 12.5, fontWeight: 700, lineHeight: 1.1,
              textShadow: '0 1px 2px rgba(243,235,208,0.9)',
              overflow: 'hidden',
            }}>
              {room.occupant ?? ''}
            </span>

            {room.status === 'Occupied' && room.careTotal > 0 && (
              <div title={`${room.careDone} of ${room.careTotal} care tasks done`}
                style={{ height: 3, borderRadius: 999, background: 'rgba(45,25,7,0.16)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: complete ? 'rgba(110,128,72,0.95)' : '#B14919' }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {(suite || room.rowSpan > 1) && (
        <div style={{
          height: suite ? 16 : 11, flexShrink: 0, borderRadius: 3, background: PANEL,
          border: `1px solid ${HAIR}`,
          backgroundImage: `linear-gradient(90deg, transparent 49.5%, ${HAIR} 49.5% 50.5%, transparent 50.5%)`,
        }} />
      )}
    </Link>
  )
}
