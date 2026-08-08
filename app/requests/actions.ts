'use server'

import { db } from '@/lib/db'
import { requireAuth, getSession } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

const STATUSES = ['New', 'Contacted', 'Booked', 'Declined']

export async function setRequestStatus(data: FormData) {
  await requireAuth()
  const id = String(data.get('id') ?? '')
  const status = String(data.get('status') ?? '')
  if (!id || !STATUSES.includes(status)) return

  const session = await getSession()
  const request = await db.bookingRequest.findUnique({ where: { id }, select: { name: true } })
  if (!request) return

  await db.bookingRequest.update({
    where: { id },
    data: { status, handledBy: session?.name ?? null, handledAt: new Date() },
  })
  await recordAudit({
    action: 'bookingRequest.status',
    entityType: 'BookingRequest',
    entityId: id,
    summary: `Booking request from ${request.name} marked ${status}`,
  }, session)

  revalidatePath('/requests')
}

/**
 * Link a request to the appointment it became.
 *
 * This is the join the whole funnel rests on — without it "request → booked" is
 * a guess. The appointment itself is still created through the normal booking
 * screen, with the normal pricing and slot checks.
 */
export async function linkAppointment(data: FormData) {
  await requireAuth()
  const id = String(data.get('id') ?? '')
  const appointmentId = String(data.get('appointmentId') ?? '').trim()
  if (!id || !appointmentId) return

  const appointment = await db.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } })
  if (!appointment) return

  const session = await getSession()
  await db.bookingRequest.update({
    where: { id },
    data: { appointmentId, status: 'Booked', handledBy: session?.name ?? null, handledAt: new Date() },
  })
  revalidatePath('/requests')
}
