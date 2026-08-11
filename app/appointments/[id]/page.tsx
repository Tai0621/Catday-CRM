import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { APPOINTMENT_STATUSES } from '@/lib/constants'
import { isChangeable } from '@/lib/appointments/schedule'
import { AppointmentActions } from '../AppointmentActions'

export default async function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const appt = await db.appointment.findUnique({
    where: { id },
    include: { customer: true, cat: true, room: true, service: true },
  })
  if (!appt) notFound()

  async function updateStatus(data: FormData) {
    'use server'
    const newStatus = data.get('status') as string
    await db.appointment.update({ where: { id }, data: { status: newStatus } })
    if (appt!.roomId) {
      if (newStatus === 'CheckedIn') {
        await db.room.update({ where: { id: appt!.roomId }, data: { status: 'Occupied' } })
      } else if (newStatus === 'Completed' || newStatus === 'Cancelled' || newStatus === 'NoShow') {
        await db.room.update({ where: { id: appt!.roomId }, data: { status: 'Cleaning' } })
      }
    }
    redirect(`/appointments/${id}`)
  }

  async function togglePaid() {
    'use server'
    await db.appointment.update({ where: { id }, data: { paid: !appt!.paid } })
    redirect(`/appointments/${id}`)
  }

  async function addNote(data: FormData) {
    'use server'
    const note = data.get('staffNotes') as string
    await db.appointment.update({ where: { id }, data: { staffNotes: note } })
    redirect(`/appointments/${id}`)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>{appt.type} — {appt.cat.name}</h1>
          <p className="text-sm cd-muted">{appt.scheduledAt.toLocaleString('en-MY', { dateStyle: 'full', timeStyle: 'short' })}</p>
        </div>
        <span className="cd-pill" style={statusStyle(appt.status)}>{appt.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoCard label="Customer" value={appt.customer.name ?? appt.customer.phone} href={`/customers/${appt.customerId}`} />
        <InfoCard label="Cat" value={appt.cat.name} href={`/cats/${appt.catId}`} />
        <InfoCard label="Room" value={appt.room?.name ?? 'No room'} />
        <InfoCard label="Price" value={appt.price != null ? `RM ${appt.price.toFixed(2)}` : 'Not set'} />
      </div>

      {appt.notes && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(114,144,148,0.15)', border: '1px solid rgba(114,144,148,0.3)', color: '#2D1907' }}>
          <strong>Customer notes:</strong> {appt.notes}
        </div>
      )}

      {/* Payment */}
      <section className="cd-card p-5 flex items-center justify-between">
        <div>
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Payment</h2>
          <p className="text-sm cd-muted">
            {appt.price != null ? `RM ${appt.price.toFixed(2)} · ` : 'No price set · '}
            <span style={{ color: appt.paid ? '#729094' : '#B14919', fontWeight: 600 }}>{appt.paid ? 'Paid' : 'Outstanding'}</span>
          </p>
        </div>
        <form action={togglePaid}>
          <button type="submit" className={appt.paid ? 'cd-btn-sec' : 'cd-btn'}>
            {appt.paid ? 'Mark unpaid' : 'Mark paid'}
          </button>
        </form>
      </section>

      {/* Change or cancel — the same controls as the diary, so a cancellation
          always captures a reason no matter which screen it starts from. */}
      {isChangeable(appt.status) && (
        <section className="cd-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold" style={{ color: '#2D1907' }}>Change this booking</h2>
              <p className="text-sm cd-muted">Move it to another time, or cancel it with a reason.</p>
            </div>
            <div className="flex items-center gap-3">
              <AppointmentActions
                appointment={{
                  id: appt.id,
                  type: appt.type,
                  catName: appt.cat.name,
                  status: appt.status,
                  scheduledAt: appt.scheduledAt.toISOString(),
                  endsAt: appt.endsAt?.toISOString() ?? null,
                  price: appt.price,
                  roomId: appt.roomId,
                  depositRM: appt.depositRM,
                  serviceName: appt.service?.name ?? null,
                  durationMin: appt.service?.durationMin ?? null,
                  unitPrice: appt.service?.price ?? null,
                }}
              />
            </div>
          </div>
        </section>
      )}

      {appt.status === 'Cancelled' && appt.cancelReason && (
        <section className="cd-card p-5">
          <h2 className="font-semibold" style={{ color: '#2D1907' }}>Cancelled</h2>
          <p className="text-sm cd-muted">
            {appt.cancelReason}
            {appt.cancelNote ? ` — ${appt.cancelNote}` : ''}
            {appt.cancelledAt ? ` · ${appt.cancelledAt.toLocaleDateString('en-MY', { dateStyle: 'medium' })}` : ''}
          </p>
        </section>
      )}

      {/* Status update */}
      <section className="cd-card p-5 space-y-3">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>Update Status</h2>
        {/* Cancelled is deliberately NOT here: cancelling has to record why, and
            a one-click status button cannot ask. It lives above instead. */}
        <form action={updateStatus} className="flex gap-2 flex-wrap">
          {APPOINTMENT_STATUSES.filter(s => s !== 'Cancelled').map(s => (
            <button key={s} name="status" value={s} type="submit"
              className="text-sm px-3 py-1.5 rounded-lg transition-colors"
              style={appt.status === s
                ? { background: '#B14919', color: '#ECDBB6', border: '1px solid #B14919' }
                : { background: '#F2EDE0', color: '#2D1907', border: '1px solid rgba(45,25,7,0.2)' }}>
              {s}
            </button>
          ))}
        </form>
      </section>

      {/* Staff notes */}
      <section className="cd-card p-5 space-y-3">
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>Staff Notes</h2>
        <form action={addNote} className="space-y-2">
          <textarea name="staffNotes" rows={3} defaultValue={appt.staffNotes ?? ''}
            placeholder="Grooming notes, observations…" className="cd-input" style={{ resize: 'none' }} />
          <button type="submit" className="cd-btn-sec">Save Notes</button>
        </form>
      </section>

      <Link href="/appointments" className="text-sm cd-muted hover:underline">← Back to appointments</Link>
    </div>
  )
}

function InfoCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className="cd-card px-4 py-3">
      <div className="text-xs cd-muted mb-0.5">{label}</div>
      <div className="text-sm font-medium" style={{ color: '#2D1907' }}>{value}</div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

function statusStyle(s: string): React.CSSProperties {
  const m: Record<string, React.CSSProperties> = {
    Scheduled:  { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    CheckedIn:  { background: 'rgba(231,206,122,0.35)', color: '#7a5c00' },
    InService:  { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    QualityCheck: { background: 'rgba(231,206,122,0.5)', color: '#7a5c00' },
    Ready:      { background: 'rgba(122,138,79,0.22)', color: '#5c6b3c' },
    Completed:  { background: 'rgba(45,25,7,0.12)', color: '#2D1907' },
    NoShow:     { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
    Cancelled:  { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' },
  }
  return m[s] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.4)' }
}
