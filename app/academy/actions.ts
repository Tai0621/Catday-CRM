'use server'

import { db } from '@/lib/db'
import { requireManager } from '@/lib/auth'
import { findCustomerFor } from '@/lib/academy'
import { normalisePhone } from '@/lib/phone'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// M7 · Enrolling matches the attendee to the CRM immediately.
//
// Doing it at enrolment rather than in a nightly job is what makes the funnel
// answerable the same afternoon, and it is also the only moment the phone
// number is definitely in front of someone who can correct it.

export async function enroll(data: FormData) {
  await requireManager()
  const studentName = String(data.get('studentName') ?? '').trim()
  const email = String(data.get('email') ?? '').trim()
  const course = String(data.get('course') ?? '').trim()
  if (!studentName || !email || !course) return

  const rawPhone = String(data.get('phone') ?? '').trim()
  const phone = rawPhone ? normalisePhone(rawPhone) : null

  await db.academyEnrollment.create({
    data: {
      studentName,
      email,
      phone,
      course,
      notes: String(data.get('notes') ?? '').trim() || null,
      customerId: await findCustomerFor(phone, email),
    },
  })
  revalidatePath('/academy')
  redirect('/academy')
}

/**
 * Re-run matching over every unlinked enrolment.
 *
 * Needed because an attendee often becomes a customer *after* the workshop —
 * which is the conversion itself. Without this the funnel would only ever count
 * people who were already customers when they enrolled, i.e. exactly the ones
 * the workshop did not win.
 */
export async function relinkAttendees() {
  await requireManager()
  const pending = await db.academyEnrollment.findMany({
    where: { customerId: null },
    select: { id: true, phone: true, email: true },
  })
  for (const e of pending) {
    const customerId = await findCustomerFor(e.phone, e.email)
    if (customerId) await db.academyEnrollment.update({ where: { id: e.id }, data: { customerId } })
  }
  revalidatePath('/academy')
}
