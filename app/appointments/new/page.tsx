import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { APPOINTMENT_TYPES } from '@/lib/constants'
import { openSlots } from '@/lib/slots'
import { SEGMENTS } from '@/lib/segments'

// Service category → appointment type (the board and dashboard group by type)
const CATEGORY_TYPE: Record<string, string> = {
  Grooming: 'Grooming', Bath: 'Bath', Diagnosis: 'Diagnosis', Boarding: 'Boarding', AddOn: 'Other',
}

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; catId?: string; slotDate?: string; slotService?: string }>
}) {
  await requireAuth()
  const { customerId, catId, slotDate, slotService } = await searchParams

  const [customers, cats, rooms, services, groomers] = await Promise.all([
    db.customer.findMany({ orderBy: { name: 'asc' } }),
    db.cat.findMany({
      select: { id: true, name: true, customer: { select: { name: true, phone: true } } },
      orderBy: { name: 'asc' },
    }),
    db.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.service.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    db.staff.findMany({ where: { active: true, role: { in: ['Groomer', 'Boarding'] } }, orderBy: { name: 'asc' } }),
  ])

  // Slot checker (GET round-trip — pick a date + service, see open start times)
  let slotResult: Awaited<ReturnType<typeof openSlots>> | null = null
  let slotDuration = 60
  if (slotDate) {
    const svc = services.find(s => s.id === slotService)
    slotDuration = svc?.durationMin || 60
    slotResult = await openSlots(slotDate, slotDuration)
  }

  async function create(data: FormData) {
    'use server'
    const serviceId = (data.get('serviceId') as string) || null
    const service = serviceId ? await db.service.findUnique({ where: { id: serviceId } }) : null

    const scheduledAt = new Date(data.get('scheduledAt') as string)
    const boardingEnd = (data.get('boardingEnd') as string) || ''
    const duration = parseInt((data.get('duration') as string) || '', 10)
      || service?.durationMin || 60
    const endsAt = boardingEnd
      ? new Date(boardingEnd)
      : new Date(scheduledAt.getTime() + duration * 60 * 1000)

    const priceRaw = (data.get('price') as string) || ''
    const nights = boardingEnd
      ? Math.max(1, Math.round((endsAt.getTime() - scheduledAt.getTime()) / (24 * 60 * 60 * 1000)))
      : 1
    const price = priceRaw
      ? parseFloat(priceRaw)
      : service
      ? (service.category === 'Boarding' ? service.price * nights : service.price)
      : null

    await db.appointment.create({
      data: {
        customerId: data.get('customerId') as string,
        catId: data.get('catId') as string,
        type: service ? CATEGORY_TYPE[service.category] ?? 'Other' : (data.get('type') as string) || 'Other',
        serviceId,
        staffId: (data.get('staffId') as string) || null,
        scheduledAt,
        endsAt,
        roomId: (data.get('roomId') as string) || null,
        price,
        depositRM: data.get('depositRM') ? parseFloat(data.get('depositRM') as string) : null,
        notes: (data.get('notes') as string) || null,
        status: 'Scheduled',
      },
    })
    redirect('/appointments')
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Book Appointment</h1>

      {/* Open-slot checker */}
      <form method="get" className="cd-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="cd-label">Check open slots — date</label>
          <input name="slotDate" type="date" defaultValue={slotDate ?? ''} className="cd-input" style={{ width: 'auto' }} />
        </div>
        <div>
          <label className="cd-label">Service</label>
          <select name="slotService" defaultValue={slotService ?? ''} className="cd-input" style={{ width: '13rem' }}>
            <option value="">Any (60 min)</option>
            {services.filter(s => s.category !== 'Boarding').map(s => (
              <option key={s.id} value={s.id}>{s.name} · {s.durationMin}min</option>
            ))}
          </select>
        </div>
        {customerId && <input type="hidden" name="customerId" value={customerId} />}
        {catId && <input type="hidden" name="catId" value={catId} />}
        <button type="submit" className="cd-btn-sec text-sm">Check</button>
        {slotResult && (
          <div className="w-full">
            <p className="text-xs cd-muted mb-1.5">
              {slotResult.slots.length === 0
                ? `No open slots on ${slotDate} — fully booked for ${slotDuration} min services.`
                : `${slotResult.slots.length} open start times (${slotResult.capacity} groomer${slotResult.capacity === 1 ? '' : 's'} on duty):`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {slotResult.slots.map(s => (
                <span key={s.time} className="cd-pill" style={{ background: SEGMENTS.grooming.bg, color: SEGMENTS.grooming.text }}>
                  {s.time}{slotResult!.capacity > 1 && <span style={{ opacity: 0.6 }}> ·{s.free}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </form>

      <form action={create} className="cd-card p-5 space-y-4">
        <div>
          <label className="cd-label">Customer *</label>
          <select name="customerId" required defaultValue={customerId ?? ''} className="cd-input">
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name ?? c.phone}</option>)}
          </select>
        </div>
        <div>
          <label className="cd-label">Cat *</label>
          <select name="catId" required defaultValue={catId ?? ''} className="cd-input">
            <option value="">Select cat…</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name} ({c.customer.name ?? c.customer.phone})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Service (sets price & duration)</label>
            <select name="serviceId" defaultValue={slotService ?? ''} className="cd-input">
              <option value="">— custom, pick type →</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} · RM{s.price}{s.category === 'Boarding' ? '/night' : ` · ${s.durationMin}min`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="cd-label">Type (if no service)</label>
            <select name="type" className="cd-input">
              {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Start *</label>
            <input name="scheduledAt" type="datetime-local" required className="cd-input"
              defaultValue={slotDate ? `${slotDate}T10:00` : ''} />
          </div>
          <div>
            <label className="cd-label">Boarding check-out (optional)</label>
            <input name="boardingEnd" type="datetime-local" className="cd-input" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="cd-label">Duration (min)</label>
            <input name="duration" type="number" min="15" step="15" placeholder="from service" className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Price (RM)</label>
            <input name="price" type="number" step="0.01" placeholder="from service" className="cd-input" />
          </div>
          <div>
            <label className="cd-label">Deposit (RM)</label>
            <input name="depositRM" type="number" step="0.01" placeholder="0" className="cd-input" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="cd-label">Assigned staff</label>
            <select name="staffId" className="cd-input">
              <option value="">Unassigned</option>
              {groomers.map(g => <option key={g.id} value={g.id}>{g.name} ({g.role})</option>)}
            </select>
          </div>
          <div>
            <label className="cd-label">Room (boarding)</label>
            <select name="roomId" className="cd-input">
              <option value="">No room</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.type})</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs cd-muted -mt-2">
          Booking boarding? Check the <Link href="/rooms/calendar" className="cd-link">room calendar</Link> for availability across dates.
        </p>
        <div>
          <label className="cd-label">Notes</label>
          <textarea name="notes" rows={2} placeholder="Special instructions…" className="cd-input" />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="submit" className="cd-btn">Book</button>
          <Link href="/appointments" className="cd-btn-sec text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
