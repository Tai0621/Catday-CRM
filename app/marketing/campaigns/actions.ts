'use server'

import { requireManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  generateOffers, saveOffer, setStatus, recordSend, campaignAudiences, campaignById,
} from '@/lib/campaigns'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/**
 * Generate offer structures and save them all as drafts.
 *
 * Saved rather than held in memory: the owner will want to compare them, close
 * the tab, and come back — and re-running the generator would cost another call
 * and produce different offers, so the comparison would be lost.
 */
export async function propose(data: FormData) {
  await requireManager()
  const intent = String(data.get('intent') ?? '').trim()
  const from = String(data.get('from') ?? '')
  const to = String(data.get('to') ?? '')
  if (!intent || !isDate(from) || !isDate(to) || to <= from) return

  const audiences = await campaignAudiences()
  const result = await generateOffers(intent, from, to, audiences)
  if (!result.ok) return

  for (const offer of result.result.offers) {
    await saveOffer(intent, offer, from, to, result.result.facts)
  }
  revalidatePath('/marketing/campaigns')
}

export async function approve(data: FormData) {
  await requireManager()
  const id = String(data.get('id') ?? '')
  const campaign = id ? await campaignById(id) : null
  if (!campaign) return

  // An offer with no audience has nobody to go to; approving it would produce
  // an empty worklist and look like a bug.
  if (!campaign.targetGroupKey) return

  await setStatus(id, 'Approved')
  await recordAudit({
    action: 'campaign.approve',
    entityType: 'Campaign',
    entityId: id,
    summary: `Approved campaign "${campaign.name}" — ${campaign.offerType}${campaign.discountPct ? ` ${campaign.discountPct}%` : ''}`,
    detail: { offerType: campaign.offerType, discountPct: campaign.discountPct, group: campaign.targetGroupKey },
  })
  revalidatePath('/marketing/campaigns')
  redirect(`/marketing/campaigns/${id}`)
}

export async function end(data: FormData) {
  await requireManager()
  const id = String(data.get('id') ?? '')
  if (!id) return
  await setStatus(id, 'Ended')
  revalidatePath('/marketing/campaigns')
}

export async function discard(data: FormData) {
  await requireManager()
  const id = String(data.get('id') ?? '')
  if (!id) return
  const campaign = await campaignById(id)
  // Only a draft is discardable — a campaign that has gone out is a record.
  if (!campaign || campaign.status !== 'Draft') return
  const { db } = await import('@/lib/db')
  await db.campaign.delete({ where: { id } })
  revalidatePath('/marketing/campaigns')
}

export async function markSent(data: FormData) {
  await requireManager()
  const campaignId = String(data.get('campaignId') ?? '')
  const customerId = String(data.get('customerId') ?? '')
  if (!campaignId || !customerId) return
  await recordSend(campaignId, customerId)
  revalidatePath(`/marketing/campaigns/${campaignId}`)
}
