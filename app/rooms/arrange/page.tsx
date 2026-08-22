import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import Link from 'next/link'
import { UNIT_KINDS, UNIT_KIND_LABELS, ZONE_KINDS } from '@/lib/constants'
import { saveZone, deleteZone, placeRoom } from './actions'
import { SubmitButton, ConfirmSubmit } from '@/app/components/Pending'

// Arrange the wall — where each unit physically sits.
//
// Deliberately a plain form rather than drag-and-drop: this is done once when
// the cabinets go in, and the printed check below matters more than the gesture.
// A room drawn in the wrong place means feeding the wrong cat, and unlike a
// wrong number in a report nobody notices.
export default async function ArrangeWallPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireManager()
  const { error } = await searchParams

  const [zones, rooms] = await Promise.all([
    db.roomZone.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { rooms: true } } } }),
    db.room.findMany({
      where: { isActive: true },
      select: { id: true, name: true, zoneId: true, gridCol: true, gridRow: true, colSpan: true, rowSpan: true, unitKind: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  const placed = rooms.filter(r => r.zoneId && r.gridCol && r.gridRow)
  const unplaced = rooms.filter(r => !(r.zoneId && r.gridCol && r.gridRow))

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <Link href="/rooms" className="text-xs cd-muted hover:underline">← Boarding Wall</Link>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Arrange the wall</h1>
        <p className="text-sm cd-muted">
          {placed.length} of {rooms.length} rooms placed. Anything unplaced still shows on the wall,
          in its own strip &mdash; a room is never hidden because nobody has filed it.
        </p>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.25)' }}>
          {error}
        </div>
      )}

      <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(114,144,148,0.13)', border: '1px solid rgba(114,144,148,0.3)' }}>
        <strong>Check it against the real wall before you trust it.</strong> Print this page, stand in
        the boarding room, and walk the units left to right. Every tile also carries its room number
        for exactly this reason &mdash; the picture is a shortcut, never the only identifier.
      </div>

      {/* ── banks ── */}
      <section className="space-y-2">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>Cabinet banks</h2>
        {zones.length === 0 && <p className="text-sm cd-muted">None yet. Add the first one below.</p>}
        {zones.map(z => (
          <form key={z.id} action={saveZone} className="cd-card p-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={z.id} />
            <div><label className="cd-label">Code</label><input name="code" defaultValue={z.code} className="cd-input" style={{ width: '4.5rem' }} /></div>
            <div className="flex-grow" style={{ minWidth: '9rem' }}><label className="cd-label">Name</label><input name="name" defaultValue={z.name} className="cd-input" /></div>
            <div>
              <label className="cd-label">Kind</label>
              <select name="kind" defaultValue={z.kind} className="cd-input" style={{ width: 'auto' }}>
                {ZONE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div><label className="cd-label">Cols</label><input name="cols" type="number" min="1" max="12" defaultValue={z.cols} className="cd-input" style={{ width: '4rem' }} /></div>
            <div><label className="cd-label">Rows</label><input name="rows" type="number" min="1" max="12" defaultValue={z.rows} className="cd-input" style={{ width: '4rem' }} /></div>
            <div><label className="cd-label">Order</label><input name="sortOrder" type="number" defaultValue={z.sortOrder} className="cd-input" style={{ width: '4rem' }} /></div>
            <SubmitButton className="cd-btn-sec" busyLabel="Working…">Save</SubmitButton>
            <span className="text-xs cd-muted pb-2">{z._count.rooms} room{z._count.rooms === 1 ? '' : 's'}</span>
          </form>
        ))}
        {zones.map(z => z._count.rooms === 0 && (
          <form key={`del-${z.id}`} action={deleteZone}>
            <input type="hidden" name="id" value={z.id} />
            <ConfirmSubmit className="text-xs cd-link" busyLabel="Working…"
              message={`Remove cabinet bank ${z.code} (${z.name})? Any room still placed in it returns to Unplaced.`}>Remove empty bank {z.code}</ConfirmSubmit>
          </form>
        ))}

        <details className="cd-card p-3">
          <summary className="text-sm font-semibold cursor-pointer" style={{ color: '#2D1907' }}>Add a bank</summary>
          <form action={saveZone} className="mt-3 flex flex-wrap items-end gap-2">
            <div><label className="cd-label">Code</label><input name="code" required placeholder="Z5" className="cd-input" style={{ width: '4.5rem' }} /></div>
            <div className="flex-grow" style={{ minWidth: '9rem' }}><label className="cd-label">Name</label><input name="name" required placeholder="Back wall" className="cd-input" /></div>
            <div>
              <label className="cd-label">Kind</label>
              <select name="kind" className="cd-input" style={{ width: 'auto' }}>
                {ZONE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div><label className="cd-label">Cols</label><input name="cols" type="number" min="1" max="12" defaultValue={3} className="cd-input" style={{ width: '4rem' }} /></div>
            <div><label className="cd-label">Rows</label><input name="rows" type="number" min="1" max="12" defaultValue={3} className="cd-input" style={{ width: '4rem' }} /></div>
            <div><label className="cd-label">Order</label><input name="sortOrder" type="number" defaultValue={zones.length} className="cd-input" style={{ width: '4rem' }} /></div>
            <SubmitButton className="cd-btn" busyLabel="Working…">Add bank</SubmitButton>
          </form>
        </details>
      </section>

      {/* ── rooms ── */}
      <section className="space-y-2">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>
          Rooms {unplaced.length > 0 && <span className="font-normal text-sm" style={{ color: '#B14919' }}>· {unplaced.length} unplaced</span>}
        </h2>
        <div className="cd-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="cd-thead">
              <th>Room</th><th>Bank</th><th>Col</th><th>Row</th><th>Wide</th><th>Tall</th><th>Drawn as</th><th></th>
            </tr></thead>
            <tbody className="cd-tbody">
              {[...unplaced, ...placed].map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium" style={{ color: '#2D1907' }}>
                    <Link href={`/rooms/${r.id}`} className="hover:underline">{r.name}</Link>
                  </td>
                  <td colSpan={7} className="px-2 py-1.5">
                    <form action={placeRoom} className="flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="zoneId" defaultValue={r.zoneId ?? ''} className="cd-input text-xs" style={{ width: '9rem', padding: '0.25rem 0.4rem' }}>
                        <option value="">— unplaced —</option>
                        {zones.map(z => <option key={z.id} value={z.id}>{z.code} {z.name}</option>)}
                      </select>
                      <input name="gridCol" type="number" min="1" defaultValue={r.gridCol ?? ''} placeholder="col" className="cd-input text-xs" style={{ width: '3.5rem', padding: '0.25rem 0.4rem' }} />
                      <input name="gridRow" type="number" min="1" defaultValue={r.gridRow ?? ''} placeholder="row" className="cd-input text-xs" style={{ width: '3.5rem', padding: '0.25rem 0.4rem' }} />
                      <input name="colSpan" type="number" min="1" defaultValue={r.colSpan} title="Columns wide" className="cd-input text-xs" style={{ width: '3.2rem', padding: '0.25rem 0.4rem' }} />
                      <input name="rowSpan" type="number" min="1" defaultValue={r.rowSpan} title="Rows tall" className="cd-input text-xs" style={{ width: '3.2rem', padding: '0.25rem 0.4rem' }} />
                      <select name="unitKind" defaultValue={r.unitKind} className="cd-input text-xs" style={{ width: '8rem', padding: '0.25rem 0.4rem' }}>
                        {UNIT_KINDS.map(k => <option key={k} value={k} title={UNIT_KIND_LABELS[k]}>{k}</option>)}
                      </select>
                      <SubmitButton className="cd-btn-sec text-xs" busyLabel="Working…">Place</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs cd-muted">
        Seeding the whole wall at once from the maker&rsquo;s drawing:
        <code className="ml-1">node scripts/seed-boarding-wall.mjs</code>
      </p>
    </div>
  )
}
