import { db } from '../db'
import { canMessage, groupByKey, evaluateGroup, renderMessage } from '../customer-groups'
import { getConfig } from '../config'
import { AD_HOC_GROUP_KEY } from '../constants'
import { campaignFacts, offerEconomics } from './facts'
import { generateOffers, OFFER_TYPES, MAX_PROPOSED_DISCOUNT_PCT, type ProposedOffer } from './generate'

export { campaignFacts, offerEconomics }
export { generateOffers, OFFER_TYPES, MAX_PROPOSED_DISCOUNT_PCT, type ProposedOffer }

// ── M1 · Campaign lifecycle ──────────────────────────────────────────────────
//
// Draft → the owner edits → Approved → sent, one customer at a time.
//
// THE SEND IS AN ASSISTED WORKLIST, NOT A BLAST, and that is a scope decision
// rather than an unfinished feature. The WhatsApp integration here is
// inbound-only; outbound at scale needs the Business API with pre-approved
// marketing templates, per-conversation billing and throttling, and a banned
// business number is not recoverable. A worklist that walks staff through an
// approved campaign delivers the targeting now and leaves the channel work to
// be scoped honestly rather than faked.
//
// Every send goes through the SAME consent floor and frequency cap as M10 —
// `canMessage` — so a campaign cannot become a way around the guardrails that
// the group worklist respects.

export type CampaignStatus = 'Draft' | 'Approved' | 'Running' | 'Ended'

export interface CampaignRow {
  id: string
  name: string
  intent: string
  offerType: string
  serviceId: string | null
  discountPct: number
  validFrom: Date
  validTo: Date
  targetGroupKey: string | null
  message: string
  rationale: string | null
  facts: unknown
  status: CampaignStatus
  ownerApprovedAt: Date | null
  createdAt: Date
  sent: number
}

/** The audiences a campaign may target, with how many are actually messageable. */
export async function campaignAudiences() {
  const out: { key: string; name: string; size: number; sendable: number }[] = []
  for (const group of (await import('../customer-groups')).SYSTEM_GROUPS) {
    const audience = await evaluateGroup(group)
    out.push({ key: group.key, name: group.name, size: audience.total, sendable: audience.sendable.length })
  }
  return out
}

export async function saveOffer(
  intent: string,
  offer: ProposedOffer,
  fromISO: string,
  toISO: string,
  facts: unknown,
): Promise<string> {
  const row = await db.campaign.create({
    data: {
      name: offer.name,
      intent,
      offerType: offer.offerType,
      serviceId: offer.serviceId,
      discountPct: offer.discountPct,
      validFrom: new Date(`${fromISO}T00:00:00`),
      validTo: new Date(`${toISO}T23:59:59`),
      targetGroupKey: offer.targetGroupKey,
      message: offer.message,
      rationale: offer.rationale,
      facts: JSON.stringify({ ...(facts as object), economics: offer.economics, targetWeekdays: offer.targetWeekdays }),
    },
  })
  return row.id
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const rows = await db.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { _count: { select: { recipients: true } } },
  })
  return rows.map(r => ({
    ...r,
    facts: JSON.parse(r.facts),
    status: r.status as CampaignStatus,
    sent: r._count.recipients,
  }))
}

export async function campaignById(id: string): Promise<CampaignRow | null> {
  const r = await db.campaign.findUnique({ where: { id }, include: { _count: { select: { recipients: true } } } })
  if (!r) return null
  return { ...r, facts: JSON.parse(r.facts), status: r.status as CampaignStatus, sent: r._count.recipients }
}

export interface WorklistEntry {
  customerId: string
  name: string
  phone: string
  text: string
  alreadySent: boolean
}

/**
 * Who is left to contact for an approved campaign.
 *
 * Consent, erasure and the global frequency cap are applied per customer at the
 * moment the list is built — not when the campaign was written. A campaign
 * approved on Monday must not message someone who withdrew consent on Tuesday.
 */
export async function worklistFor(id: string): Promise<{ campaign: CampaignRow; entries: WorklistEntry[]; blocked: number } | null> {
  const campaign = await campaignById(id)
  if (!campaign) return null
  if (campaign.status !== 'Approved' && campaign.status !== 'Running') {
    return { campaign, entries: [], blocked: 0 }
  }

  const group = campaign.targetGroupKey ? groupByKey(campaign.targetGroupKey) : null
  if (!group) return { campaign, entries: [], blocked: 0 }

  const [audience, config, already] = await Promise.all([
    evaluateGroup(group),
    getConfig(),
    db.campaignRecipient.findMany({ where: { campaignId: id }, select: { customerId: true } }),
  ])
  const sentTo = new Set(already.map(r => r.customerId))

  const entries: WorklistEntry[] = []
  let blocked = 0
  for (const m of audience.sendable) {
    if (sentTo.has(m.id)) continue
    const gate = await canMessage(m.id)
    if (!gate.ok) { blocked++; continue }
    entries.push({
      customerId: m.id,
      name: m.name,
      phone: m.phone,
      text: renderMessage(campaign.message, {
        customer: m.name, cat: m.catName ?? 'your cat', brand: config.business.name,
      }),
      alreadySent: false,
    })
  }
  return { campaign, entries, blocked }
}

export type SendResult = { ok: true } | { ok: false; error: string }

/**
 * Record one confirmed send.
 *
 * Writes BOTH a CampaignRecipient (so the campaign knows its own reach) and a
 * GroupSend (so the global frequency cap and M2's attribution see it). Two rows
 * for one send is deliberate: without the GroupSend, a campaign would be
 * invisible to the cap and a customer in three campaigns would get three
 * messages in a week.
 */
export async function recordSend(campaignId: string, customerId: string): Promise<SendResult> {
  const campaign = await campaignById(campaignId)
  if (!campaign) return { ok: false, error: 'That campaign no longer exists.' }
  if (campaign.status !== 'Approved' && campaign.status !== 'Running') {
    return { ok: false, error: 'Only an approved campaign can be sent.' }
  }

  const gate = await canMessage(customerId)
  if (!gate.ok) return { ok: false, error: gate.reason }

  await db.$transaction([
    db.campaignRecipient.upsert({
      where: { campaignId_customerId: { campaignId, customerId } },
      create: { campaignId, customerId, sentAt: new Date() },
      update: { sentAt: new Date() },
    }),
    db.groupSend.create({
      data: {
        groupKey: campaign.targetGroupKey ?? AD_HOC_GROUP_KEY,
        customerId,
        channel: 'WhatsApp',
        variant: campaign.name.slice(0, 40),
      },
    }),
    db.campaign.update({ where: { id: campaignId }, data: { status: 'Running' } }),
  ])
  return { ok: true }
}

export async function setStatus(id: string, status: CampaignStatus): Promise<void> {
  await db.campaign.update({
    where: { id },
    data: { status, ...(status === 'Approved' ? { ownerApprovedAt: new Date() } : {}) },
  })
}
