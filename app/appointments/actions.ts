'use server'

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { recordAudit } from '@/lib/audit'
import { groomerCapacity } from '@/lib/slots'
import { roomTypeForBoardingService } from '@/lib/appointment-charge'
import { isChangeable, isCancelReason, planMove, describeMove } from '@/lib/appointments/schedule'
import { revalidatePath } from 'next/cache'

// Cancelling and moving a booking, from the diary.
//
// Both re-derive everything from the database. The browser sends an id and a
// date; it never sends a price, an end time, or a status.

const GROOM_TYPES = ['Grooming', 'Bath', 'Diagnosis']

export type ChangeResult = { ok: true; message: string } | { ok: false; error: string }

function fail(error: string): ChangeResult { return { ok: false, error } }

/**
 * Cancel a booking, with a reason.
 *
 * The deposit is deliberately left alone. A deposit is money that was actually
 * received, and whether it is refunded, held as credit, or kept is a commercial
 * decision — silently reversing the transaction here would put the cash-up out
 * by that amount and hide the decision from the person who has to make it. The
 * caller is told a deposit exists so it can be settled explicitly.
 */
export async function cancelAppointment(id: string, reason: string, note: string): Promise<ChangeResult> {
  await requireAuth()

  const appt = await db.appointment.findUnique({
    where: { id },
    include: { cat: { select: { name: true } }, customer: { select: { name: true, phone: true } } },
  })
  if (!appt) return fail('That booking no longer exists.')
  if (!isChangeable(appt.status)) {
    return fail(`This booking is already ${appt.status.toLowerCase()} — it cannot be cancelled.`)
  }
  if (!isCancelReason(reason)) return fail('Pick a reason for the cancellation.')

  await db.appointment.update({
    where: { id },
    data: {
      status: 'Cancelled',
      cancelledAt: new Date(),
      cancelReason: reason,
      cancelNote: note.trim().slice(0, 500) || null,
    },
  })

  // A cancelled stay frees the room, but it is not clean yet — the same
  // transition the detail page has always made.
  if (appt.roomId) {
    await db.room.update({ where: { id: appt.roomId }, data: { status: 'Cleaning' } })
  }

  await recordAudit({
    action: 'appointment.cancel',
    entityType: 'Appointment',
    entityId: id,
    summary: `${appt.type} for ${appt.cat.name} cancelled — ${reason}`,
    detail: { reason, note: note.trim() || null, wasStatus: appt.status, depositRM: appt.depositRM },
  })

  revalidatePath('/appointments')
  revalidatePath(`/appointments/${id}`)

  const deposit = appt.depositRM ?? 0
  return {
    ok: true,
    message: deposit > 0
      ? `Cancelled. A deposit of RM ${deposit.toFixed(2)} was taken — refund or hold it as credit from the customer's record; nothing was reversed automatically.`
      : 'Cancelled.',
  }
}

export interface RescheduleInput {
  id: string
  startISO: string
  /** Boarding only — the new check-out. */
  endISO?: string
  roomId?: string
}

/**
 * Move a booking.
 *
 * Boarding is charged per night, so the price is recomputed from the new dates
 * rather than carried over. Room capacity is re-checked for the new window,
 * excluding this booking — otherwise a stay would always clash with itself.
 */
export async function rescheduleAppointment(input: RescheduleInput): Promise<ChangeResult> {
  await requireAuth()

  const appt = await db.appointment.findUnique({
    where: { id: input.id },
    include: { service: true, cat: { select: { name: true } } },
  })
  if (!appt) return fail('That booking no longer exists.')
  if (!isChangeable(appt.status)) {
    return fail(`This booking is ${appt.status.toLowerCase()} — it cannot be moved.`)
  }

  const lane = appt.type === 'Boarding' ? 'boarding' : 'grooming'
  const unitPrice = appt.service?.price ?? appt.price ?? 0
  const durationMin = appt.service?.durationMin ?? 60

  const move = planMove(
    { lane, startISO: input.startISO, endISO: input.endISO, durationMin, unitPrice },
    new Date(),
  )
  if (!move.ok) return fail(move.error)

  const roomId = lane === 'boarding' ? (input.roomId || appt.roomId) : null

  if (lane === 'boarding' && roomId) {
    const room = await db.room.findUnique({
      where: { id: roomId },
      select: { name: true, type: true, capacity: true },
    })
    if (!room) return fail('That room no longer exists.')

    const wantType = appt.service ? roomTypeForBoardingService(appt.service.name) : null
    if (wantType && room.type !== wantType) {
      return fail(`${room.name} is a ${room.type} room, but this rate is for ${wantType}.`)
    }

    // `id: { not }` is the whole point: without it a stay clashes with itself
    // and every move of an already-roomed booking would be refused.
    const overlapping = await db.appointment.count({
      where: {
        id: { not: appt.id },
        roomId,
        status: { notIn: ['Cancelled', 'NoShow', 'Completed'] },
        scheduledAt: { lt: move.endsAt },
        OR: [{ endsAt: { gt: move.scheduledAt } }, { endsAt: null }],
      },
    })
    if (overlapping >= room.capacity) {
      return fail(`${room.name} is full for those dates (${room.capacity}/${room.capacity} cats). Pick another room.`)
    }
  }

  if (lane === 'grooming') {
    const [capacity, clashes] = await Promise.all([
      groomerCapacity(),
      db.appointment.count({
        where: {
          id: { not: appt.id },
          type: { in: GROOM_TYPES },
          status: { notIn: ['Cancelled', 'NoShow'] },
          scheduledAt: { lt: move.endsAt },
          OR: [{ endsAt: { gt: move.scheduledAt } }, { endsAt: null }],
        },
      }),
    ])
    if (clashes >= capacity) {
      return fail(`Every groomer is already booked then (${clashes}/${capacity}). Pick another time.`)
    }
  }

  const before = { scheduledAt: appt.scheduledAt, endsAt: appt.endsAt, price: appt.price }

  await db.appointment.update({
    where: { id: appt.id },
    data: {
      scheduledAt: move.scheduledAt,
      endsAt: move.endsAt,
      price: move.price,
      ...(lane === 'boarding' ? { roomId } : {}),
      rescheduledAt: new Date(),
      // Only the FIRST move is kept: this answers "when was it originally
      // booked for", which is what a customer disputes. Overwriting it on each
      // move would slowly turn it into a duplicate of scheduledAt.
      ...(appt.rescheduledFrom ? {} : { rescheduledFrom: appt.scheduledAt }),
    },
  })

  const { timezone } = await getConfig()
  const summary = describeMove(before, { ...move, price: move.price }, timezone)

  await recordAudit({
    action: 'appointment.reschedule',
    entityType: 'Appointment',
    entityId: appt.id,
    summary: `${appt.type} for ${appt.cat.name} moved — ${summary}`,
    detail: {
      from: before.scheduledAt.toISOString(),
      to: move.scheduledAt.toISOString(),
      priceFrom: before.price,
      priceTo: move.price,
      nights: move.nights || undefined,
    },
  })

  revalidatePath('/appointments')
  revalidatePath(`/appointments/${appt.id}`)

  const priceChanged = before.price != null && Math.abs(before.price - move.price) >= 0.005
  return {
    ok: true,
    message: priceChanged
      ? `Moved. The price changed from RM ${before.price!.toFixed(2)} to RM ${move.price.toFixed(2)} — ${move.nights} night${move.nights === 1 ? '' : 's'}.`
      : 'Moved.',
  }
}

/** Rooms with space for a window, for the reschedule dialog. Excludes the booking being moved. */
export async function freeRoomsForMove(apptId: string, startISO: string, endISO: string) {
  await requireAuth()
  const start = new Date(startISO), end = new Date(endISO)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return { rooms: [] }

  const [rooms, clashes] = await Promise.all([
    db.room.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, type: true, capacity: true },
    }),
    db.appointment.findMany({
      where: {
        id: { not: apptId },
        roomId: { not: null },
        status: { notIn: ['Cancelled', 'NoShow', 'Completed'] },
        scheduledAt: { lt: end },
        OR: [{ endsAt: { gt: start } }, { endsAt: null }],
      },
      select: { roomId: true },
    }),
  ])
  const used = new Map<string, number>()
  for (const c of clashes) if (c.roomId) used.set(c.roomId, (used.get(c.roomId) ?? 0) + 1)
  return {
    rooms: rooms
      .map(r => ({ ...r, remaining: r.capacity - (used.get(r.id) ?? 0) }))
      .filter(r => r.remaining > 0),
  }
}
