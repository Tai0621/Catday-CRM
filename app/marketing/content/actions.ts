'use server'

import { db } from '@/lib/db'
import { requireManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { draftCaption } from '@/lib/content/caption'
import { candidateFor } from '@/lib/content/studio'
import { revalidatePath } from 'next/cache'

export async function generateCaption(data: FormData) {
  await requireManager()
  const appointmentId = String(data.get('appointmentId') ?? '')
  if (!appointmentId) return
  await draftCaption(appointmentId)
  revalidatePath('/marketing/content')
}

export async function setDraftStatus(data: FormData) {
  await requireManager()
  const appointmentId = String(data.get('appointmentId') ?? '')
  const status = String(data.get('status') ?? '')
  if (!appointmentId || !['Draft', 'Used', 'Discarded'].includes(status)) return
  await db.contentDraft.updateMany({ where: { appointmentId }, data: { status } })
  revalidatePath('/marketing/content')
}

/**
 * Withdraw a cat from the content pool.
 *
 * Only the photo permission — the household stays contactable. That separation
 * is the whole reason the flag exists, so this must never touch
 * Customer.marketingConsent as a side effect.
 */
export async function withdrawFromPool(data: FormData) {
  await requireManager()
  const catId = String(data.get('catId') ?? '')
  if (!catId) return

  const cat = await db.cat.findUnique({ where: { id: catId }, select: { name: true } })
  if (!cat) return

  await db.cat.update({ where: { id: catId }, data: { contentOptOut: true } })
  // Any draft already written for this cat goes with it: the permission was the
  // reason it existed.
  await db.contentDraft.deleteMany({
    where: { appointmentId: { in: (await db.appointment.findMany({ where: { catId }, select: { id: true } })).map(a => a.id) } },
  })

  await recordAudit({
    action: 'content.withdraw',
    entityType: 'Cat',
    entityId: catId,
    summary: `${cat.name} withdrawn from the content pool — photos will not be suggested for publication`,
  })
  revalidatePath('/marketing/content')
}

export async function returnToPool(data: FormData) {
  await requireManager()
  const catId = String(data.get('catId') ?? '')
  if (!catId) return
  await db.cat.update({ where: { id: catId }, data: { contentOptOut: false } })
  await recordAudit({ action: 'content.restore', entityType: 'Cat', entityId: catId, summary: 'Returned to the content pool' })
  revalidatePath('/marketing/content')
}

/** Used by the page to re-assert eligibility on the server before rendering an export. */
export async function stillEligible(appointmentId: string): Promise<boolean> {
  return (await candidateFor(appointmentId)) !== null
}
