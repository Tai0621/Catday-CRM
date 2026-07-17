'use server'

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { openSlots } from '@/lib/slots'
import { boardingNights, roomTypeForBoardingService } from '@/lib/appointment-charge'

// Service category → appointment type (the board and dashboard group by type)
const CATEGORY_TYPE: Record<string, string> = {
  Grooming: 'Grooming', Bath: 'Bath', Diagnosis: 'Diagnosis', Boarding: 'Boarding', AddOn: 'Other',
}

export async function fetchSlots(dateStr: string, serviceId: string) {
  await requireAuth()
  const svc = serviceId ? await db.service.findUnique({ where: { id: serviceId } }) : null
  const duration = svc?.durationMin ?? 60
  const { slots, capacity } = await openSlots(dateStr, duration)
  return { slots, capacity, duration }
}

// Rooms with no overlapping stay for the requested window — so a room can't be
// double-booked by hand.
export async function fetchFreeRooms(startISO: string, endISO: string) {
  await requireAuth()
  const start = new Date(startISO), end = new Date(endISO)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return { rooms: [] }

  const [rooms, clashes] = await Promise.all([
    db.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, type: true } }),
    db.appointment.findMany({
      where: {
        roomId: { not: null },
        status: { notIn: ['Cancelled', 'NoShow', 'Completed'] },
        scheduledAt: { lt: end },
        OR: [{ endsAt: { gt: start } }, { endsAt: null }],
      },
      select: { roomId: true },
    }),
  ])
  const taken = new Set(clashes.map(c => c.roomId))
  return { rooms: rooms.filter(r => !taken.has(r.id)) }
}

export type BookPayload = {
  lane: 'grooming' | 'boarding'
  customerId: string
  catId: string
  serviceId: string
  startISO: string       // grooming: start; boarding: check-in
  endISO?: string        // boarding only: check-out
  staffId?: string
  roomId?: string
  depositRM?: number
  depositMethod?: string
  notes?: string
}
export type BookResult = { ok: true; id: string } | { ok: false; error: string }

export async function createAppointment(payloadJson: string): Promise<BookResult> {
  await requireAuth()
  let p: BookPayload
  try { p = JSON.parse(payloadJson) } catch { return { ok: false, error: 'Bad request.' } }

  if (!p.customerId || !p.catId) return { ok: false, error: 'Pick a customer and a cat.' }
  const service = p.serviceId ? await db.service.findUnique({ where: { id: p.serviceId } }) : null
  if (!service) return { ok: false, error: 'Pick a service — it sets the price and duration.' }

  const scheduledAt = new Date(p.startISO)
  if (isNaN(scheduledAt.getTime())) return { ok: false, error: 'Pick a valid start time.' }

  // Price and end time are derived here, never taken from the browser.
  let endsAt: Date
  let price: number
  if (p.lane === 'boarding') {
    if (!p.endISO) return { ok: false, error: 'Pick a check-out date.' }
    endsAt = new Date(p.endISO)
    if (isNaN(endsAt.getTime())) return { ok: false, error: 'Pick a valid check-out date.' }
    if (endsAt <= scheduledAt) return { ok: false, error: 'Check-out must be after check-in.' }
    price = Math.round(service.price * boardingNights(scheduledAt, endsAt, new Date()) * 100) / 100
    // The rate names its room class — a mismatched room means a wrong charge
    if (p.roomId) {
      const wantType = roomTypeForBoardingService(service.name)
      if (wantType) {
        const room = await db.room.findUnique({ where: { id: p.roomId }, select: { type: true, name: true } })
        if (room && room.type !== wantType) {
          return { ok: false, error: `${room.name} is a ${room.type} room, but this rate is for ${wantType}. Pick a ${wantType} room or change the rate.` }
        }
      }
    }
  } else {
    endsAt = new Date(scheduledAt.getTime() + service.durationMin * 60 * 1000)
    price = service.price
  }

  const type = CATEGORY_TYPE[service.category] ?? 'Other'
  const deposit = p.depositRM && p.depositRM > 0 ? Math.round(p.depositRM * 100) / 100 : null
  if (deposit != null && deposit > price) return { ok: false, error: 'Deposit cannot exceed the total price.' }

  const appt = await db.appointment.create({
    data: {
      customerId: p.customerId,
      catId: p.catId,
      type,
      serviceId: service.id,
      staffId: p.staffId || null,
      scheduledAt,
      endsAt,
      roomId: p.lane === 'boarding' ? p.roomId || null : null,
      price,
      depositRM: deposit,
      notes: p.notes?.trim() || null,
      status: 'Scheduled',
    },
  })

  // Deposits are money received today — record them so the cash-up balances.
  // The POS credits the deposit against the bill at checkout.
  if (deposit != null) {
    await db.transaction.create({
      data: {
        customerId: p.customerId,
        date: new Date(),
        total: deposit,
        category: type === 'Boarding' ? 'Boarding' : type === 'Other' ? 'Other' : 'Grooming',
        method: p.depositMethod || 'Cash',
        reference: `DEP-${appt.id.slice(-8).toUpperCase()}`,
        notes: `Deposit — booking ${scheduledAt.toLocaleDateString('en-MY')}`,
      },
    })
  }

  return { ok: true, id: appt.id }
}
