import { del } from '@vercel/blob'
import { db } from './db'
import { getConfig } from './config'
import { isMediaConfigured } from './media'

// Track A / A3 — erasure ("right to be forgotten"), two-step by design:
//
//  1. anonymizeCustomer() — runs immediately on an erasure request. Redacts the
//     customer's identifying fields and their cats' free-text health/care notes,
//     deletes all photos/videos, and blanks linked WhatsApp content — but keeps
//     the de-identified financial rows (transactions, ledgers) so the books stay
//     correct. Sets Customer.erasedAt.
//
//  2. purgeExpiredCustomers() — the retention cron. Once an anonymised customer's
//     newest financial record has aged past the configured window
//     (data.retentionYears, default 7), the remaining de-identified rows are
//     hard-deleted. This is what makes erasure eventually complete without
//     violating tax-retention obligations in the meantime.

export const ERASED_NAME = 'Erased customer'
const erasedPhone = (id: string) => `ERASED-${id}`

export type AnonymizeResult = { ok: true; cleared: { cats: number; media: number; whatsappLeads: number } }

export async function anonymizeCustomer(customerId: string): Promise<AnonymizeResult | null> {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } })
  if (!customer) return null

  const cats = await db.cat.findMany({ where: { customerId }, select: { id: true } })
  const catIds = cats.map(c => c.id)
  const assessments = catIds.length
    ? await db.catAssessment.findMany({ where: { catId: { in: catIds } }, select: { id: true } })
    : []
  const assessmentIds = assessments.map(a => a.id)

  const media = await db.mediaAsset.findMany({
    where: { OR: mediaOwnerClauses(catIds, assessmentIds) },
    select: { id: true, url: true },
  })
  const mediaIds = media.map(m => m.id)

  const leads = await db.whatsAppLead.findMany({ where: { customerId }, select: { id: true, messageId: true } })
  const leadIds = leads.map(l => l.id)
  const messageIds = [...new Set(leads.map(l => l.messageId))]

  const now = new Date()
  await db.$transaction([
    db.customer.update({
      where: { id: customerId },
      data: {
        name: ERASED_NAME, email: null, address: null, notes: null,
        phone: erasedPhone(customerId), source: 'Erased',
        marketingConsent: false, needsDetails: false, erasedAt: now,
      },
    }),
    ...(catIds.length ? [db.cat.updateMany({
      where: { id: { in: catIds } },
      data: { careNotes: null, healthNotes: null, feedingNotes: null, medication: null },
    })] : []),
    ...(mediaIds.length ? [db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } })] : []),
    ...(leadIds.length ? [db.whatsAppLead.updateMany({ where: { id: { in: leadIds } }, data: { summary: '[erased]', proposedAction: null } })] : []),
    ...(messageIds.length ? [db.whatsAppMessage.updateMany({ where: { id: { in: messageIds } }, data: { content: '[erased]', senderPhone: 'ERASED' } })] : []),
  ])

  // Blob bytes are removed outside the DB transaction (best-effort — a failed
  // del never blocks the erasure; the row is already gone).
  if (isMediaConfigured()) {
    for (const m of media) { try { await del(m.url) } catch { /* already gone / unreachable */ } }
  }

  return { ok: true, cleared: { cats: catIds.length, media: mediaIds.length, whatsappLeads: leadIds.length } }
}

export async function purgeExpiredCustomers(): Promise<{ purged: number; ids: string[]; retentionYears: number }> {
  const config = await getConfig()
  const years = config.data.retentionYears
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - years)

  const erased = await db.customer.findMany({ where: { erasedAt: { not: null } }, select: { id: true } })
  const purgeIds: string[] = []
  for (const c of erased) {
    const newest = await db.transaction.findFirst({ where: { customerId: c.id }, orderBy: { date: 'desc' }, select: { date: true } })
    if (!newest || newest.date < cutoff) purgeIds.push(c.id)
  }

  for (const id of purgeIds) await hardDeleteCustomer(id)
  return { purged: purgeIds.length, ids: purgeIds, retentionYears: years }
}

// Physically remove one already-anonymised customer and every remaining
// de-identified record, children first (SQLite FK-safe ordering).
async function hardDeleteCustomer(customerId: string): Promise<void> {
  const cats = await db.cat.findMany({ where: { customerId }, select: { id: true } })
  const catIds = cats.map(c => c.id)
  const txns = await db.transaction.findMany({ where: { customerId }, select: { id: true } })
  const txnIds = txns.map(t => t.id)
  const assessments = catIds.length
    ? await db.catAssessment.findMany({ where: { catId: { in: catIds } }, select: { id: true } })
    : []
  const assessmentIds = assessments.map(a => a.id)

  await db.$transaction([
    ...(txnIds.length ? [db.transactionLine.deleteMany({ where: { transactionId: { in: txnIds } } })] : []),
    ...(txnIds.length ? [db.transaction.deleteMany({ where: { id: { in: txnIds } } })] : []),
    db.loyaltyEntry.deleteMany({ where: { customerId } }),
    db.walletEntry.deleteMany({ where: { customerId } }),
    ...(assessmentIds.length ? [db.catAssessment.deleteMany({ where: { id: { in: assessmentIds } } })] : []),
    ...((catIds.length || assessmentIds.length) ? [db.mediaAsset.deleteMany({ where: { OR: mediaOwnerClauses(catIds, assessmentIds) } })] : []),
    db.appointment.deleteMany({ where: { customerId } }),
    db.membership.deleteMany({ where: { customerId } }),
    db.whatsAppLead.deleteMany({ where: { customerId } }),
    ...(catIds.length ? [db.cat.deleteMany({ where: { id: { in: catIds } } })] : []),
    db.customer.delete({ where: { id: customerId } }),
  ])
}

// MediaAsset has no FK (ownerId is a loose string), so we match on owner tuples.
// The '__none__' sentinel keeps an OR arm valid when a list is empty.
function mediaOwnerClauses(catIds: string[], assessmentIds: string[]) {
  return [
    catIds.length ? { ownerType: 'cat', ownerId: { in: catIds } } : { id: '__none__' },
    assessmentIds.length ? { ownerType: 'assessment', ownerId: { in: assessmentIds } } : { id: '__none__' },
  ]
}
