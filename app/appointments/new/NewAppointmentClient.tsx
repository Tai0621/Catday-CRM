'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { boardingNights, roomTypeForBoardingService } from '@/lib/appointment-charge'
import { createAppointment, fetchSlots, fetchFreeRooms } from './actions'

type Lane = 'grooming' | 'boarding'
interface CustomerOpt { id: string; name: string | null; phone: string }
interface CatOpt { id: string; name: string; customerId: string }
interface ServiceOpt { id: string; name: string; category: string; price: number; durationMin: number }
interface StaffOpt { id: string; name: string; role: string }
interface RoomOpt { id: string; name: string; type: string; capacity: number; remaining: number }

const GROOM = { color: '#B14919', bg: 'rgba(177,73,25,0.13)' }
const BOARD = { color: '#729094', bg: 'rgba(114,144,148,0.16)' }
const INK = '#2D1907'

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localISO = (d: Date) => `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`

export function NewAppointmentClient({
  customers, cats, services, staff, preselectCustomerId, preselectCatId,
}: {
  customers: CustomerOpt[]; cats: CatOpt[]; services: ServiceOpt[]; staff: StaffOpt[]
  preselectCustomerId: string | null; preselectCatId: string | null
}) {
  const router = useRouter()
  const [lane, setLane] = useState<Lane>('grooming')
  const [customerId, setCustomerId] = useState(preselectCustomerId ?? '')
  const [catId, setCatId] = useState(preselectCatId ?? '')
  const [serviceId, setServiceId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // grooming
  const today = new Date()
  const [date, setDate] = useState(dateKey(today))
  const [time, setTime] = useState('')
  const [slots, setSlots] = useState<{ time: string; free: number }[]>([])
  const [capacity, setCapacity] = useState(1)
  const [loadingSlots, startSlots] = useTransition()

  // boarding
  const [checkIn, setCheckIn] = useState(localISO(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)))
  const [checkOut, setCheckOut] = useState('')
  const [roomId, setRoomId] = useState('')
  const [rooms, setRooms] = useState<RoomOpt[]>([])
  const [loadingRooms, startRooms] = useTransition()
  const [depositRM, setDepositRM] = useState('')
  const [depositMethod, setDepositMethod] = useState('Cash')

  const laneServices = services.filter(s =>
    lane === 'boarding' ? s.category === 'Boarding' : s.category !== 'Boarding')
  const service = laneServices.find(s => s.id === serviceId) ?? null
  const custCats = customerId ? cats.filter(c => c.customerId === customerId) : []
  const laneStaff = staff.filter(s => (lane === 'boarding' ? s.role === 'Boarding' : s.role === 'Groomer'))

  // The chosen rate names its room class — offer only matching rooms
  const rateRoomType = lane === 'boarding' && service ? roomTypeForBoardingService(service.name) : null
  const offeredRooms = rateRoomType ? rooms.filter(r => r.type === rateRoomType) : rooms

  // ── derived price & time (mirrors the server, which recomputes on submit) ──
  const nights = lane === 'boarding' && checkIn && checkOut
    ? boardingNights(new Date(checkIn), new Date(checkOut), new Date()) : 0
  const validRange = lane === 'boarding' && !!checkIn && !!checkOut && new Date(checkOut) > new Date(checkIn)
  const price = !service ? 0
    : lane === 'boarding' ? (validRange ? Math.round(service.price * nights * 100) / 100 : 0)
    : service.price
  const endTime = lane === 'grooming' && service && time
    ? localISO(new Date(new Date(`${date}T${time}`).getTime() + service.durationMin * 60000)).slice(11)
    : ''

  // Reset lane-specific choices when switching lanes
  function switchLane(next: Lane) {
    if (next === lane) return
    setLane(next); setServiceId(''); setStaffId(''); setTime(''); setRoomId(''); setError(null)
  }
  useEffect(() => { setCatId(prev => (custCats.some(c => c.id === prev) ? prev : '')) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customerId])

  // Grooming: pull open start times for the chosen date + service duration
  useEffect(() => {
    if (lane !== 'grooming' || !date) { setSlots([]); return }
    startSlots(async () => {
      const r = await fetchSlots(date, serviceId)
      setSlots(r.slots); setCapacity(r.capacity)
      setTime(prev => (r.slots.some(s => s.time === prev) ? prev : ''))
    })
  }, [lane, date, serviceId])

  // Boarding: only offer rooms that are actually free for the window
  useEffect(() => {
    if (lane !== 'boarding' || !validRange) { setRooms([]); return }
    startRooms(async () => {
      const r = await fetchFreeRooms(new Date(checkIn).toISOString(), new Date(checkOut).toISOString())
      setRooms(r.rooms)
      setRoomId(prev => (r.rooms.some(x => x.id === prev) ? prev : ''))
    })
  }, [lane, checkIn, checkOut, validRange])

  // Switching rate class drops a room that no longer matches it
  useEffect(() => {
    if (rateRoomType) setRoomId(prev => (offeredRooms.some(r => r.id === prev) ? prev : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateRoomType, rooms])

  const ready = !!customerId && !!catId && !!service &&
    (lane === 'grooming' ? !!time : validRange)

  async function submit() {
    setBusy(true); setError(null)
    const startISO = lane === 'grooming'
      ? new Date(`${date}T${time}`).toISOString()
      : new Date(checkIn).toISOString()
    const res = await createAppointment(JSON.stringify({
      lane, customerId, catId, serviceId,
      startISO,
      endISO: lane === 'boarding' ? new Date(checkOut).toISOString() : undefined,
      staffId: staffId || undefined,
      roomId: lane === 'boarding' ? roomId || undefined : undefined,
      depositRM: lane === 'boarding' && depositRM ? parseFloat(depositRM) : undefined,
      depositMethod: lane === 'boarding' ? depositMethod : undefined,
      notes: notes || undefined,
    }))
    if (res.ok) router.push('/appointments')
    else { setError(res.error); setBusy(false) }
  }

  const seg = lane === 'boarding' ? BOARD : GROOM

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <h1 className="text-xl font-bold" style={{ color: INK }}>Book Appointment</h1>

      {/* ── Lane picker: everything below follows from this ── */}
      <div className="flex gap-2">
        {([['grooming', 'Grooming', GROOM], ['boarding', 'Boarding', BOARD]] as const).map(([key, label, c]) => (
          <button key={key} onClick={() => switchLane(key)}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={lane === key
              ? { background: c.color, color: '#F2EDE0' }
              : { background: 'rgba(45,25,7,0.05)', color: 'rgba(45,25,7,0.5)', border: '1px solid rgba(45,25,7,0.12)' }}>
            {label}
          </button>
        ))}
      </div>

      <div className="cd-card p-5 space-y-4">
        {/* ── Who ── */}
        <div>
          <label className="cd-label">Customer *</label>
          <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="cd-input">
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">Cat *</label>
          <select value={catId} onChange={e => setCatId(e.target.value)} className="cd-input" disabled={!customerId}>
            <option value="">{customerId ? 'Select cat…' : 'Pick a customer first'}</option>
            {custCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {customerId && custCats.length === 0 && (
            <p className="text-xs mt-1" style={{ color: GROOM.color }}>
              No cats on this customer — <Link href={`/cats/new?customerId=${customerId}`} className="cd-link">add one</Link>.
            </p>
          )}
        </div>

        {/* ── Service (sets price + duration) ── */}
        <div>
          <label className="cd-label">{lane === 'boarding' ? 'Room type / rate *' : 'Service *'}</label>
          {laneServices.length === 0 ? (
            <p className="text-xs" style={{ color: GROOM.color }}>
              No {lane} services yet — <Link href="/services" className="cd-link">add one to the menu</Link> so pricing stays automatic.
            </p>
          ) : (
            <select value={serviceId} onChange={e => setServiceId(e.target.value)} className="cd-input">
              <option value="">Select…</option>
              {laneServices.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} · RM{s.price}{s.category === 'Boarding' ? '/night' : ` · ${s.durationMin}min`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ══ GROOMING LANE ══ */}
        {lane === 'grooming' && (
          <>
            <div>
              <label className="cd-label">Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="cd-input" />
            </div>
            <div>
              <label className="cd-label">Start time *</label>
              {loadingSlots ? (
                <p className="text-xs cd-muted">Checking the diary…</p>
              ) : slots.length === 0 ? (
                <p className="text-xs" style={{ color: GROOM.color }}>
                  Fully booked on {date}{service ? ` for ${service.durationMin} min services` : ''} — try another date.
                </p>
              ) : (
                <>
                  <p className="text-xs cd-muted mb-1.5">
                    {slots.length} open start time{slots.length === 1 ? '' : 's'} · {capacity} groomer{capacity === 1 ? '' : 's'} on duty
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map(s => (
                      <button key={s.time} onClick={() => setTime(s.time)}
                        className="text-xs px-2.5 py-1.5 rounded-lg transition-all"
                        style={time === s.time
                          ? { background: GROOM.color, color: '#F2EDE0', fontWeight: 600 }
                          : { background: GROOM.bg, color: GROOM.color, border: `1px solid ${GROOM.color}33` }}>
                        {s.time}{capacity > 1 && <span style={{ opacity: 0.6 }}> ·{s.free}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {laneStaff.length > 0 && (
              <div>
                <label className="cd-label">Groomer</label>
                <select value={staffId} onChange={e => setStaffId(e.target.value)} className="cd-input">
                  <option value="">Assign later</option>
                  {laneStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {/* ══ BOARDING LANE ══ */}
        {lane === 'boarding' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="cd-label">Check-in *</label>
                <input type="datetime-local" value={checkIn} onChange={e => setCheckIn(e.target.value)} className="cd-input" />
              </div>
              <div>
                <label className="cd-label">Check-out *</label>
                <input type="datetime-local" value={checkOut} min={checkIn}
                  onChange={e => setCheckOut(e.target.value)} className="cd-input" />
              </div>
            </div>
            {checkIn && checkOut && !validRange && (
              <p className="text-xs" style={{ color: GROOM.color }}>Check-out must be after check-in.</p>
            )}
            <div>
              <label className="cd-label">Room</label>
              {!validRange ? (
                <p className="text-xs cd-muted">Pick the dates and only free rooms will be offered.</p>
              ) : loadingRooms ? (
                <p className="text-xs cd-muted">Checking room availability…</p>
              ) : offeredRooms.length === 0 ? (
                <p className="text-xs" style={{ color: GROOM.color }}>
                  {rateRoomType && rooms.length > 0
                    ? `No ${rateRoomType} rooms free for these dates — pick another rate or check the `
                    : 'No rooms free for these dates — check the '}
                  <Link href="/rooms/calendar" className="cd-link">room calendar</Link>.
                </p>
              ) : (
                <>
                  <select value={roomId} onChange={e => setRoomId(e.target.value)} className="cd-input">
                    <option value="">Assign later</option>
                    {offeredRooms.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.type}){r.remaining < r.capacity ? ` · ${r.remaining} of ${r.capacity} space${r.remaining === 1 ? '' : 's'} left` : ` · holds ${r.capacity}`}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs cd-muted mt-1">
                    {offeredRooms.length} {rateRoomType ? `${rateRoomType} room` : 'room'}{offeredRooms.length === 1 ? '' : 's'} with space · one cat per booking, priced per cat
                  </p>
                </>
              )}
            </div>
            {laneStaff.length > 0 && (
              <div>
                <label className="cd-label">Carer</label>
                <select value={staffId} onChange={e => setStaffId(e.target.value)} className="cd-input">
                  <option value="">Assign later</option>
                  {laneStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="cd-label">Deposit (RM)</label>
                <input type="number" min="0" step="0.01" placeholder="0" value={depositRM}
                  onChange={e => setDepositRM(e.target.value)} className="cd-input" />
              </div>
              <div>
                <label className="cd-label">Deposit paid by</label>
                <select value={depositMethod} onChange={e => setDepositMethod(e.target.value)} className="cd-input">
                  {['Cash', 'Card', 'QR'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </>
        )}

        <div>
          <label className="cd-label">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Special instructions…" className="cd-input" />
        </div>
      </div>

      {/* ── Auto summary: what the shop charges, computed not typed ── */}
      <div className="rounded-2xl p-4" style={{ background: seg.bg, border: `1px solid ${seg.color}44` }}>
        {!service ? (
          <p className="text-sm" style={{ color: 'rgba(45,25,7,0.55)' }}>Pick a service to see the price.</p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm" style={{ color: INK }}>
              <div className="font-semibold">{service.name}</div>
              <div className="text-xs" style={{ color: 'rgba(45,25,7,0.6)' }}>
                {lane === 'boarding'
                  ? validRange
                    ? `${nights} night${nights === 1 ? '' : 's'} × RM${service.price}`
                    : 'Pick check-in and check-out dates'
                  : time
                    ? `${time}–${endTime} · ${service.durationMin} min`
                    : `${service.durationMin} min · pick a start time`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold" style={{ color: seg.color }}>RM {price.toFixed(2)}</div>
              {lane === 'boarding' && parseFloat(depositRM) > 0 && price > 0 && (
                <div className="text-xs" style={{ color: 'rgba(45,25,7,0.6)' }}>
                  RM {(price - parseFloat(depositRM)).toFixed(2)} due at checkout
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm rounded-xl px-4 py-3"
          style={{ background: 'rgba(177,73,25,0.12)', color: GROOM.color, border: '1px solid rgba(177,73,25,0.3)' }}>
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button onClick={submit} disabled={!ready || busy} className="cd-btn"
          style={!ready || busy ? { opacity: 0.5 } : undefined}>
          {busy ? 'Booking…' : 'Book'}
        </button>
        <Link href="/appointments" className="cd-btn-sec text-sm">Cancel</Link>
      </div>
    </div>
  )
}
