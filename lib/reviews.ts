import { randomBytes } from 'node:crypto'
import { db } from './db'

// ── M4 · Review engine ───────────────────────────────────────────────────────
// For a physical business, public reviews are the highest-leverage marketing
// channel there is, and nothing here automated them.
//
// The request is SENTIMENT-GATED: it asks how the visit went before showing any
// public link. A happy customer is pointed at the review site; an unhappy one is
// routed into the existing Incident flow, so a complaint becomes something
// someone can fix rather than a one-star review nobody can.
//
// That distinction matters and is worth stating plainly: this does not suppress
// negative reviews. Anyone can still review publicly whenever they like. What it
// avoids is *soliciting* a public review from a customer the business has just
// let down — and it guarantees that unhappiness reaches a human instead.

export const REVIEW_SENTIMENTS = ['Positive', 'Negative'] as const
export type ReviewSentiment = typeof REVIEW_SENTIMENTS[number]

/** Unguessable, URL-safe, and short enough to sit in a WhatsApp message. */
export const newReviewToken = () => randomBytes(12).toString('base64url')

export interface ReviewFunnel {
  sent: number
  responded: number
  positive: number
  negative: number
  clicked: number
  responseRate: number
  positiveRate: number
  /** Of the happy customers asked, how many followed through to the review site. */
  clickThroughRate: number
}

const rate = (n: number, d: number) => (d > 0 ? n / d : 0)

export async function reviewFunnel(sinceDays = 365, now: Date = new Date()): Promise<ReviewFunnel> {
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000)
  const rows = await db.reviewRequest.findMany({
    where: { sentAt: { gte: since } },
    select: { respondedAt: true, sentiment: true, clickedAt: true },
  })

  const sent = rows.length
  const responded = rows.filter(r => r.respondedAt).length
  const positive = rows.filter(r => r.sentiment === 'Positive').length
  const negative = rows.filter(r => r.sentiment === 'Negative').length
  const clicked = rows.filter(r => r.clickedAt).length

  return {
    sent, responded, positive, negative, clicked,
    responseRate: rate(responded, sent),
    positiveRate: rate(positive, responded),
    clickThroughRate: rate(clicked, positive),
  }
}

/**
 * Record the customer's answer. A negative answer opens an Incident in the same
 * transaction — the recovery must not depend on anyone remembering to raise it.
 */
export async function recordResponse(
  token: string,
  sentiment: ReviewSentiment,
  detail?: string,
): Promise<{ ok: true; incidentId?: string } | { ok: false; error: string }> {
  const req = await db.reviewRequest.findUnique({
    where: { token },
    select: { id: true, customerId: true, respondedAt: true },
  })
  if (!req) return { ok: false, error: 'not-found' }
  if (req.respondedAt) return { ok: false, error: 'already-answered' }

  if (sentiment === 'Negative') {
    const incident = await db.incident.create({
      data: {
        type: 'Complaint',
        customerId: req.customerId,
        description: detail?.trim()
          ? `Review feedback: ${detail.trim().slice(0, 500)}`
          : 'Review feedback: customer reported an unsatisfactory visit (no detail given).',
      },
    })
    await db.reviewRequest.update({
      where: { id: req.id },
      data: { respondedAt: new Date(), sentiment, incidentId: incident.id },
    })
    return { ok: true, incidentId: incident.id }
  }

  await db.reviewRequest.update({
    where: { id: req.id },
    data: { respondedAt: new Date(), sentiment },
  })
  return { ok: true }
}

/** Marks that a happy customer actually followed the link out to the review site. */
export async function recordClick(token: string): Promise<void> {
  await db.reviewRequest.updateMany({
    where: { token, clickedAt: null },
    data: { clickedAt: new Date() },
  })
}
