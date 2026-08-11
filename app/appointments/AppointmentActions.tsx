'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CANCEL_REASONS } from '@/lib/appointments/schedule'
import { boardingNights } from '@/lib/appointment-charge'
import { cancelAppointment, rescheduleAppointment, freeRoomsForMove } from './actions'

// Move and Cancel, from the row.
//
// Both live here rather than only on the detail page because the diary is where
// the phone call happens: "can we push Mochi to Saturday" should not need three
// navigations, and a change that is awkward to make is a change that gets made
// in someone's head instead of in the system.

export interface ActionAppointment {
  id: string
  type: string
  catName: string
  status: string
  scheduledAt: string
  endsAt: string | null
  price: number | null
  roomId: string | null
  depositRM: number | null
  serviceName: string | null
  durationMin: number | null
  unitPrice: number | null
}

interface RoomOpt { id: string; name: string; type: string; capacity: number; remaining: number }

const INK = '#2D1907'
const ACCENT = '#B14919'
const pad = (n: number) => String(n).padStart(2, '0')
/** An ISO instant as the `datetime-local` value the browser expects, in local time. */
const localValue = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AppointmentActions({ appointment }: { appointment: ActionAppointment }) {
  const [open, setOpen] = useState<'move' | 'cancel' | null>(null)
  return (
    <>
      <button type="button" onClick={() => setOpen('move')} className="text-xs cd-link">Move</button>
      <button type="button" onClick={() => setOpen('cancel')} className="text-xs" style={{ color: ACCENT }}>
        Cancel
      </button>
      {open === 'move' && <MoveDialog appointment={appointment} onClose={() => setOpen(null)} />}
      {open === 'cancel' && <CancelDialog appointment={appointment} onClose={() => setOpen(null)} />}
    </>
  )
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  // Escape closes. A dialog that can only be dismissed by finding the right
  // button is one people submit just to get rid of.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(45,25,7,0.45)' }} onClick={onClose}>
      <div className="cd-card p-5 space-y-4 w-full max-w-md text-left"
        style={{ maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold" style={{ color: INK }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

function CancelDialog({ appointment, onClose }: { appointment: ActionAppointment; onClose: () => void }) {
  const router = useRouter()
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()

  function submit() {
    startBusy(async () => {
      const res = await cancelAppointment(appointment.id, reason, note)
      if (res.ok) { setDone(res.message); router.refresh() }
      else setError(res.error)
    })
  }

  if (done) {
    return (
      <Dialog title="Cancelled" onClose={onClose}>
        <p className="text-sm" style={{ color: INK }}>{done}</p>
        <button type="button" onClick={onClose} className="cd-btn text-sm">Close</button>
      </Dialog>
    )
  }

  return (
    <Dialog title={`Cancel ${appointment.type} — ${appointment.catName}?`} onClose={onClose}>
      <div>
        <label className="cd-label">Reason *</label>
        <select value={reason} onChange={e => setReason(e.target.value)} className="cd-input">
          {CANCEL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div>
        <label className="cd-label">Note</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="cd-input"
          style={{ resize: 'none' }} placeholder="Anything worth remembering next time…" />
      </div>

      {appointment.depositRM != null && appointment.depositRM > 0 && (
        <p className="text-sm rounded-lg px-3 py-2"
          style={{ background: 'rgba(231,206,122,0.3)', color: '#7a5c00' }}>
          A deposit of <strong>RM {appointment.depositRM.toFixed(2)}</strong> was taken. Cancelling does
          not refund it — settle that from the customer&rsquo;s record so the cash-up still balances.
        </p>
      )}

      {error && (
        <p className="text-sm rounded-lg px-3 py-2"
          style={{ background: 'rgba(177,73,25,0.12)', color: ACCENT }}>{error}</p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="cd-btn text-sm">
          {busy ? 'Cancelling…' : 'Cancel booking'}
        </button>
        <button type="button" onClick={onClose} className="cd-btn-sec text-sm">Keep it</button>
      </div>
    </Dialog>
  )
}

function MoveDialog({ appointment, onClose }: { appointment: ActionAppointment; onClose: () => void }) {
  const router = useRouter()
  const isBoarding = appointment.type === 'Boarding'
  const [start, setStart] = useState(localValue(appointment.scheduledAt))
  const [end, setEnd] = useState(appointment.endsAt ? localValue(appointment.endsAt) : '')
  const [roomId, setRoomId] = useState(appointment.roomId ?? '')
  const [rooms, setRooms] = useState<RoomOpt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, startBusy] = useTransition()
  const [loadingRooms, startRooms] = useTransition()

  const validRange = !isBoarding || (!!start && !!end && new Date(end) > new Date(start))

  // Preview the new price the same way the server will compute it. This is a
  // preview only — the server recomputes and its number wins.
  const nights = isBoarding && validRange
    ? boardingNights(new Date(start), new Date(end), new Date()) : 0
  const newPrice = isBoarding
    ? (validRange && appointment.unitPrice != null
        ? Math.round(appointment.unitPrice * nights * 100) / 100 : null)
    : appointment.price

  useEffect(() => {
    if (!isBoarding || !validRange) { setRooms([]); return }
    startRooms(async () => {
      const r = await freeRoomsForMove(appointment.id, new Date(start).toISOString(), new Date(end).toISOString())
      setRooms(r.rooms)
    })
  }, [isBoarding, validRange, start, end, appointment.id])

  function submit() {
    startBusy(async () => {
      const res = await rescheduleAppointment({
        id: appointment.id,
        startISO: new Date(start).toISOString(),
        endISO: isBoarding && end ? new Date(end).toISOString() : undefined,
        roomId: isBoarding ? roomId || undefined : undefined,
      })
      if (res.ok) { setDone(res.message); router.refresh() }
      else setError(res.error)
    })
  }

  if (done) {
    return (
      <Dialog title="Moved" onClose={onClose}>
        <p className="text-sm" style={{ color: INK }}>{done}</p>
        <button type="button" onClick={onClose} className="cd-btn text-sm">Close</button>
      </Dialog>
    )
  }

  return (
    <Dialog title={`Move ${appointment.type} — ${appointment.catName}`} onClose={onClose}>
      <div>
        <label className="cd-label">{isBoarding ? 'Check-in *' : 'New date & time *'}</label>
        <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className="cd-input" />
      </div>

      {isBoarding && (
        <>
          <div>
            <label className="cd-label">Check-out *</label>
            <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Room</label>
            <select value={roomId} onChange={e => setRoomId(e.target.value)} className="cd-input"
              disabled={!validRange || loadingRooms}>
              <option value="">
                {!validRange ? 'Pick the dates first' : loadingRooms ? 'Checking…' : 'No room'}
              </option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name} · {r.type} · {r.remaining} space left</option>
              ))}
            </select>
          </div>
        </>
      )}

      {isBoarding && validRange && newPrice != null && (
        <p className="text-sm rounded-lg px-3 py-2"
          style={{ background: 'rgba(114,144,148,0.16)', color: INK }}>
          {nights} night{nights === 1 ? '' : 's'} · <strong>RM {newPrice.toFixed(2)}</strong>
          {appointment.price != null && Math.abs(appointment.price - newPrice) >= 0.005 && (
            <> — was RM {appointment.price.toFixed(2)}</>
          )}
        </p>
      )}

      {error && (
        <p className="text-sm rounded-lg px-3 py-2"
          style={{ background: 'rgba(177,73,25,0.12)', color: ACCENT }}>{error}</p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy || !validRange} className="cd-btn text-sm"
          style={busy || !validRange ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          {busy ? 'Moving…' : 'Move booking'}
        </button>
        <button type="button" onClick={onClose} className="cd-btn-sec text-sm">Cancel</button>
      </div>
    </Dialog>
  )
}
