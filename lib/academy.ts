import { db } from './db'
import { normalisePhone } from './phone'

// ── M7 · The Academy as a funnel ─────────────────────────────────────────────
//
// The premise, from the roadmap: workshops are lead generation for grooming,
// and attendees are the warmest membership prospects the business will ever
// have. Until now nothing joined an attendee to the CRM, so the segment was a
// brochure with a list attached.
//
// Every stage after "enrolled" is DERIVED live from operational data — no
// stored conversion flags to fall out of sync when a booking is corrected. The
// cost is a couple of extra queries; the benefit is that the funnel cannot
// disagree with the appointments diary.

const DAY = 24 * 60 * 60 * 1000

/** Match an enrolment to an existing customer: phone first, then email. */
export async function findCustomerFor(phone: string | null, email: string | null): Promise<string | null> {
  if (phone) {
    const normalised = normalisePhone(phone)
    if (normalised) {
      const byPhone = await db.customer.findFirst({
        where: { phone: normalised, erasedAt: null }, select: { id: true },
      })
      if (byPhone) return byPhone.id
    }
  }
  const clean = email?.trim().toLowerCase()
  if (clean) {
    const byEmail = await db.customer.findFirst({
      where: { email: clean, erasedAt: null }, select: { id: true },
    })
    if (byEmail) return byEmail.id
  }
  return null
}

export interface AcademyFunnel {
  enrolled: number
  /** …of whom are known to the CRM at all */
  linked: number
  /** …who booked grooming AFTER enrolling */
  booked: number
  /** …whose booking was completed */
  attended: number
  /** …who hold an active membership started after enrolling */
  members: number
  linkedPct: number | null
  bookedPct: number | null
  memberPct: number | null
  /** Attributed revenue: what linked attendees spent after their enrolment date. */
  revenueAfterRM: number
}

export interface Attendee {
  id: string
  studentName: string
  course: string
  status: string
  enrolledAt: Date
  phone: string | null
  email: string
  customerId: string | null
  bookedAt: Date | null
  isMember: boolean
  daysSinceEnrolment: number
}

interface Loaded {
  attendees: Attendee[]
  funnel: AcademyFunnel
}

/**
 * The whole picture in one pass.
 *
 * Deliberately one function rather than a funnel builder and a list builder:
 * they need identical joins, and two of them would drift the first time someone
 * changed what "booked" means in one place only.
 */
export async function loadAcademy(now: Date = new Date()): Promise<Loaded> {
  const enrolments = await db.academyEnrollment.findMany({
    orderBy: { enrolledAt: 'desc' },
    select: {
      id: true, studentName: true, course: true, status: true, enrolledAt: true,
      phone: true, email: true, customerId: true,
    },
  })

  const customerIds = [...new Set(enrolments.map(e => e.customerId).filter((id): id is string => !!id))]

  const [groomings, memberships, transactions] = customerIds.length > 0
    ? await Promise.all([
      db.appointment.findMany({
        where: { customerId: { in: customerIds }, type: { in: ['Grooming', 'Bath'] }, status: { notIn: ['Cancelled'] } },
        select: { customerId: true, scheduledAt: true, status: true },
        orderBy: { scheduledAt: 'asc' },
      }),
      db.membership.findMany({
        where: { customerId: { in: customerIds }, status: 'Active' },
        select: { customerId: true, createdAt: true },
      }),
      db.transaction.findMany({
        where: { customerId: { in: customerIds } },
        select: { customerId: true, date: true, total: true },
      }),
    ])
    : [[], [], []]

  const byCustomer = <T extends { customerId: string | null }>(list: T[]) => {
    const m = new Map<string, T[]>()
    for (const row of list) {
      if (!row.customerId) continue
      const arr = m.get(row.customerId) ?? []
      arr.push(row)
      m.set(row.customerId, arr)
    }
    return m
  }
  const groomingBy = byCustomer(groomings)
  const membershipBy = byCustomer(memberships)
  const spendBy = byCustomer(transactions)

  let booked = 0, attended = 0, members = 0, revenueAfterRM = 0

  const attendees: Attendee[] = enrolments.map(e => {
    const after = (d: Date) => d >= e.enrolledAt
    const mine = e.customerId ? groomingBy.get(e.customerId) ?? [] : []
    // Only bookings made AFTER the workshop count. A regular who happens to
    // take a class did not convert because of it, and counting them would make
    // the funnel flatter the more loyal the attendee.
    const first = mine.find(a => after(a.scheduledAt)) ?? null
    const completed = mine.some(a => after(a.scheduledAt) && a.status === 'Completed')
    const isMember = (e.customerId ? membershipBy.get(e.customerId) ?? [] : []).some(m => after(m.createdAt))

    if (first) booked++
    if (completed) attended++
    if (isMember) members++
    for (const tx of e.customerId ? spendBy.get(e.customerId) ?? [] : []) {
      if (after(tx.date)) revenueAfterRM += tx.total
    }

    return {
      id: e.id,
      studentName: e.studentName,
      course: e.course,
      status: e.status,
      enrolledAt: e.enrolledAt,
      phone: e.phone,
      email: e.email,
      customerId: e.customerId,
      bookedAt: first?.scheduledAt ?? null,
      isMember,
      daysSinceEnrolment: Math.floor((now.getTime() - e.enrolledAt.getTime()) / DAY),
    }
  })

  const enrolled = enrolments.length
  const linked = customerIds.length
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

  return {
    attendees,
    funnel: {
      enrolled, linked, booked, attended, members,
      linkedPct: pct(linked, enrolled),
      bookedPct: pct(booked, enrolled),
      memberPct: pct(members, enrolled),
      revenueAfterRM: Math.round(revenueAfterRM * 100) / 100,
    },
  }
}

/**
 * Attendees worth chasing: enrolled long enough ago to have acted, and haven't.
 *
 * The waiting period is the point. Following up the day after a workshop is
 * pestering; following up two weeks later, when they enjoyed it and have not
 * got round to booking, is the whole reason to run workshops.
 */
export const ACADEMY_FOLLOWUP_AFTER_DAYS = 14
export const ACADEMY_FOLLOWUP_UNTIL_DAYS = 120

export function unconverted(attendees: Attendee[]): Attendee[] {
  return attendees.filter(a =>
    !a.bookedAt
    && a.status !== 'Withdrawn'
    && a.daysSinceEnrolment >= ACADEMY_FOLLOWUP_AFTER_DAYS
    && a.daysSinceEnrolment <= ACADEMY_FOLLOWUP_UNTIL_DAYS)
}
