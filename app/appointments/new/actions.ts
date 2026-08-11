'use server'

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { openSlots } from '@/lib/slots'
import { boardingNights, roomTypeForBoardingService } from '@/lib/appointment-charge'
import { normalisePhone } from '@/lib/phone'
import { consentUpdate } from '@/lib/consent'
import { recordAudit } from '@/lib/audit'

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

// Rooms with space for the requested window. Rooms hold multiple cats up to
// their capacity (Standard 2, Suite 6), so a room is offered while its
// overlapping-stay count is below capacity — with the remaining space shown.
export async function fetchFreeRooms(startISO: string, endISO: string) {
  await requireAuth()
  const start = new Date(startISO), end = new Date(endISO)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return { rooms: [] }

  const [rooms, clashes] = await Promise.all([
    db.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, type: true, capacity: true } }),
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
  const used = new Map<string, number>()
  for (const c of clashes) if (c.roomId) used.set(c.roomId, (used.get(c.roomId) ?? 0) + 1)
  return {
    rooms: rooms
      .map(r => ({ id: r.id, name: r.name, type: r.type, capacity: r.capacity, remaining: r.capacity - (used.get(r.id) ?? 0) }))
      .filter(r => r.remaining > 0),
  }
}

export type NewCustomerPayload = {
  phone: string
  name: string
  email?: string
  source?: string
  marketingConsent: boolean
  catName: string
  breed?: string
}
export type NewCustomerResult =
  | { ok: true; customer: { id: string; name: string | null; phone: string }
      cat: { id: string; name: string; customerId: string }; existing: boolean }
  | { ok: false; error: string }

/**
 * Register a walk-in without leaving the booking.
 *
 * A first-time customer is a customer standing at the counter, so this creates
 * the household AND its first cat in one step: a booking needs both, and
 * sending staff to two other screens loses the half-filled form they were on.
 *
 * A phone number already on file is NOT an error. Phone is the unique key here,
 * and the realistic case is a returning customer nobody recognised — so the
 * existing household is returned and selected rather than refused, which also
 * stops staff from working around a failure by inventing a second number.
 */
export async function createCustomerWithCat(payloadJson: string): Promise<NewCustomerResult> {
  await requireAuth()
  let p: NewCustomerPayload
  try { p = JSON.parse(payloadJson) } catch { return { ok: false, error: 'Bad request.' } }

  const rawPhone = (p.phone ?? '').trim()
  if (!rawPhone) return { ok: false, error: 'A phone number is required — it is how the customer is identified.' }
  const phone = normalisePhone(rawPhone)
  if (phone.replace(/\D/g, '').length < 9) return { ok: false, error: 'That phone number looks too short.' }

  const catName = (p.catName ?? '').trim()
  if (!catName) return { ok: false, error: "The cat's name is required — a booking is for a cat, not just a household." }

  const existing = await db.customer.findUnique({
    where: { phone },
    select: { id: true, name: true, phone: true, erasedAt: true },
  })
  if (existing?.erasedAt) {
    return { ok: false, error: 'That number belongs to an erased record and cannot be reused.' }
  }

  const customer = existing ?? await db.customer.create({
    data: {
      phone,
      name: (p.name ?? '').trim() || null,
      email: (p.email ?? '').trim() || null,
      source: p.source || 'WalkIn',
      ...consentUpdate(!!p.marketingConsent, 'Staff'),
      needsDetails: false,
    },
    select: { id: true, name: true, phone: true },
  })

  // Reuse a cat of the same name rather than creating a duplicate: on a
  // returning household, staff typing the name they were told is the norm.
  const cat = await db.cat.findFirst({
    where: { customerId: customer.id, name: catName },
    select: { id: true, name: true, customerId: true },
  }) ?? await db.cat.create({
    data: { customerId: customer.id, name: catName, breed: (p.breed ?? '').trim() || null },
    select: { id: true, name: true, customerId: true },
  })

  if (!existing) {
    await recordAudit({
      action: 'customer.create',
      entityType: 'Customer',
      entityId: customer.id,
      summary: `${customer.name ?? phone} registered at booking, with cat ${cat.name}`,
    })
  }

  return {
    ok: true,
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
    cat,
    existing: !!existing,
  }
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
      const room = await db.room.findUnique({ where: { id: p.roomId }, select: { type: true, name: true, capacity: true } })
      const wantType = roomTypeForBoardingService(service.name)
      if (room && wantType && room.type !== wantType) {
        return { ok: false, error: `${room.name} is a ${room.type} room, but this rate is for ${wantType}. Pick a ${wantType} room or change the rate.` }
      }
      // Rooms hold multiple cats — reject only when the window is already full.
      if (room) {
        const overlapping = await db.appointment.count({
          where: {
            roomId: p.roomId,
            status: { notIn: ['Cancelled', 'NoShow', 'Completed'] },
            scheduledAt: { lt: endsAt },
            OR: [{ endsAt: { gt: scheduledAt } }, { endsAt: null }],
          },
        })
        if (overlapping >= room.capacity) {
          return { ok: false, error: `${room.name} is full for those dates (${room.capacity}/${room.capacity} cats). Pick another room.` }
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
