'use server'

import { requireManager, getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { newReviewToken } from '@/lib/reviews'
import { revalidatePath } from 'next/cache'

export async function createReviewRequest(data: FormData) {
  await requireManager()
  const session = await getSession()
  const customerId = String(data.get('customerId') ?? '')
  const appointmentId = String(data.get('appointmentId') ?? '') || null
  if (!customerId) return

  // Re-checked server-side: a button being on screen is not authorisation, and
  // consent is the floor for every outbound surface.
  const customer = await db.customer.findUnique({
    where: { id: customerId }, select: { marketingConsent: true, erasedAt: true },
  })
  if (!customer || !customer.marketingConsent || customer.erasedAt) return

  await db.reviewRequest.create({
    data: {
      token: newReviewToken(), customerId, appointmentId,
      staffId: session?.kind === 'staff' ? session.staffId : null,
    },
  })
  revalidatePath('/marketing/reviews')
}
