import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { APPOINTMENT_STATUSES } from '@/lib/constants'

export default async function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const { id } = await params

  const appt = await db.appointment.findUnique({
    where: { id },
    include: { customer: true, cat: true, room: true },
  })
  if (!appt) notFound()

  async function updateStatus(data: FormData) {
    'use server'
    const newStatus = data.get('status') as string
    await db.appointment.update({ where: { id }, data: { status: newStatus } })
    // Mark room as occupied/available based on status
    if (appt!.roomId) {
      if (newStatus === 'CheckedIn') {
        await db.room.update({ where: { id: appt!.roomId }, data: { status: 'Occupied' } })
      } else if (newStatus === 'Completed' || newStatus === 'Cancelled' || newStatus === 'NoShow') {
        await db.room.update({ where: { id: appt!.roomId }, data: { status: 'Cleaning' } })
      }
    }
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
          <h1 className="text-xl font-bold text-gray-900">
            {appt.type} — {appt.cat.name}
          </h1>
          <p className="text-sm text-gray-500">
            {appt.scheduledAt.toLocaleString('en-MY', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${statusClass(appt.status)}`}>{appt.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoCard label="Customer" value={appt.customer.name ?? appt.customer.phone} href={`/customers/${appt.customerId}`} />
        <InfoCard label="Cat" value={appt.cat.name} href={`/cats/${appt.catId}`} />
        <InfoCard label="Room" value={appt.room?.name ?? 'No room'} />
        <InfoCard label="Price" value={appt.price != null ? `RM ${appt.price.toFixed(2)}` : 'Not set'} />
      </div>

      {appt.notes && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-800">
          <strong>Customer notes:</strong> {appt.notes}
        </div>
      )}

      {/* Status update */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Update Status</h2>
        <form action={updateStatus} className="flex gap-2 flex-wrap">
          {APPOINTMENT_STATUSES.map(s => (
            <button key={s} name="status" value={s} type="submit"
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${appt.status === s ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
              {s}
            </button>
          ))}
        </form>
      </section>

      {/* Staff notes */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Staff Notes</h2>
        <form action={addNote} className="space-y-2">
          <textarea name="staffNotes" rows={3} defaultValue={appt.staffNotes ?? ''}
            placeholder="Grooming notes, observations…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          <button type="submit" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-200">Save Notes</button>
        </form>
      </section>

      <div className="flex gap-3">
        <Link href="/appointments" className="text-sm text-gray-500 hover:text-gray-700">← Back to appointments</Link>
      </div>
    </div>
  )
}

function InfoCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm font-medium text-gray-900">{value}</div>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

function statusClass(s: string) {
  const m: Record<string, string> = {
    Scheduled: 'bg-blue-100 text-blue-700',
    CheckedIn: 'bg-amber-100 text-amber-700',
    Completed: 'bg-green-100 text-green-700',
    NoShow: 'bg-red-100 text-red-700',
    Cancelled: 'bg-gray-100 text-gray-500',
  }
  return m[s] ?? 'bg-gray-100 text-gray-500'
}
