import { requireManager } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ROOM_TYPES, ROOM_STATUSES } from '@/lib/constants'

export default async function RoomSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ err?: string }>
}) {
  await requireManager()
  const { id } = await params
  const { err } = await searchParams

  const room = await db.room.findUnique({
    where: { id },
    include: {
      appointments: {
        where: { status: 'CheckedIn' },
        include: { cat: true, customer: true },
        take: 1,
      },
      _count: { select: { appointments: true } },
    },
  })
  if (!room) notFound()

  const currentGuest = room.appointments[0]
  const bookingCount = room._count.appointments

  async function save(data: FormData) {
    'use server'
    const name = ((data.get('name') as string) ?? '').trim()
    if (!name) redirect(`/rooms/${id}/settings?err=name`)
    try {
      await db.room.update({
        where: { id },
        data: {
          name,
          type: (data.get('type') as string) || 'Standard',
          capacity: Math.max(1, parseInt((data.get('capacity') as string) || '2', 10) || 2),
          status: (data.get('status') as string) || 'Available',
          description: ((data.get('description') as string) || '').trim() || null,
          isActive: data.get('isActive') === 'on',
        },
      })
    } catch {
      redirect(`/rooms/${id}/settings?err=name-taken`) // unique name clash
    }
    redirect('/rooms')
  }

  async function remove() {
    'use server'
    // Guard: never delete a room that has booking history — deactivate instead
    const count = await db.appointment.count({ where: { roomId: id } })
    if (count > 0) redirect(`/rooms/${id}/settings?err=has-bookings`)
    await db.room.delete({ where: { id } })
    redirect('/rooms')
  }

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/rooms/${id}`} className="text-xs cd-muted hover:underline">← Back to the room</Link>
          <span className="text-xs cd-muted">›</span>
          <span className="text-xs cd-muted">{room.name}</span>
        </div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Edit Room</h1>
      </div>

      {err === 'name' && <Notice>Room name can’t be empty.</Notice>}
      {err === 'name-taken' && <Notice>Another room already uses that name.</Notice>}
      {err === 'has-bookings' && (
        <Notice>
          This room has {bookingCount} booking{bookingCount === 1 ? '' : 's'} on record, so it can’t be deleted.
          Untick <strong>Active</strong> and save to retire it instead — history stays intact.
        </Notice>
      )}

      {currentGuest && (
        <div className="cd-card p-4" style={{ borderLeft: '3px solid #B14919' }}>
          <div className="text-xs cd-muted mb-0.5">Currently occupied</div>
          <div className="font-medium" style={{ color: '#2D1907' }}>{currentGuest.cat.name}</div>
          <div className="text-xs cd-muted">{currentGuest.customer.name ?? currentGuest.customer.phone}</div>
        </div>
      )}

      <form action={save} className="cd-card p-5 space-y-4">
        <div>
          <label className="cd-label">Room name *</label>
          <input name="name" required defaultValue={room.name} className="cd-input" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Type</label>
            <select name="type" defaultValue={room.type} className="cd-input">
              {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Status</label>
            <select name="status" defaultValue={room.status} className="cd-input">
              {ROOM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Capacity <span className="cd-muted font-normal">· cats at once</span></label>
            <input name="capacity" type="number" min="1" max="10" defaultValue={room.capacity} className="cd-input" />
          </div>
        </div>
        <div>
          <label className="cd-label">Description</label>
          <input name="description" defaultValue={room.description ?? ''} placeholder="Optional notes about this room" className="cd-input" />
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: '#2D1907' }}>
          <input type="checkbox" name="isActive" defaultChecked={room.isActive} />
          Active — show in the tracker, calendar and booking form
        </label>
        <div className="flex gap-3 pt-1">
          <button type="submit" className="cd-btn">Save changes</button>
          <Link href={`/rooms/${id}`} className="cd-btn-sec text-sm">Cancel</Link>
        </div>
      </form>

      <form action={remove} className="cd-card p-4 flex items-center justify-between">
        <div className="text-xs cd-muted pr-3">
          {bookingCount > 0
            ? `Has ${bookingCount} booking${bookingCount === 1 ? '' : 's'} — deactivate above to retire it.`
            : 'No bookings on record — safe to delete permanently.'}
        </div>
        <button type="submit" disabled={bookingCount > 0}
          className="text-sm px-3 py-1.5 rounded-lg whitespace-nowrap"
          style={bookingCount > 0
            ? { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.35)', cursor: 'not-allowed', border: '1px solid rgba(45,25,7,0.1)' }
            : { background: 'rgba(177,73,25,0.1)', color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}>
          Delete room
        </button>
      </form>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-4 py-3 text-sm"
      style={{ background: 'rgba(177,73,25,0.12)', color: '#B14919', border: '1px solid rgba(177,73,25,0.3)' }}>
      {children}
    </div>
  )
}
