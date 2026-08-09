import { db } from '../db'
import { GROOM_MEDIA_TAGS } from '../constants'

// ── M3 · Content Studio ──────────────────────────────────────────────────────
//
// The best marketing asset this business has is its before/after grooming
// photographs, and they sit in MediaAsset doing nothing. This finds the pairs
// worth posting and hands the owner a caption and two crops.
//
// THE CONSENT GATE IS THE FEATURE, and it is two gates, not one:
//
//   • Customer.marketingConsent — permission to be contacted
//   • Cat.contentOptOut         — permission to publish this cat's photograph
//
// They are separate because they are different asks. An owner who is glad to
// hear about a grooming offer may still not want their cat on Instagram, and
// collapsing the two would force them to give up both to decline one. Both are
// enforced in the QUERY, not in a prompt or a template — the pool is built from
// people who may be published, so a draft for anyone else cannot be produced by
// forgetting a check downstream.

const DAY = 24 * 60 * 60 * 1000

export interface ContentCandidate {
  appointmentId: string
  date: Date
  catId: string
  catName: string
  breed: string | null
  coatType: string | null
  serviceName: string
  customerId: string
  customerName: string
  beforeMediaId: string
  afterMediaId: string
  draft: { caption: string; hashtags: string[]; status: string } | null
}

/**
 * Completed grooms with BOTH a before and an after image, whose household may
 * be published.
 *
 * A single image is not a candidate: the whole point is the pair, and a
 * before-only post is a picture of a scruffy cat.
 */
export async function contentPool(withinDays = 120): Promise<ContentCandidate[]> {
  const since = new Date(Date.now() - withinDays * DAY)

  const appointments = await db.appointment.findMany({
    where: {
      status: 'Completed',
      scheduledAt: { gte: since },
      type: { in: ['Grooming', 'Bath'] },
      // Gate one: contactable and not erased.
      customer: { marketingConsent: true, erasedAt: null },
      // Gate two: this cat has not been withdrawn from the pool.
      cat: { contentOptOut: false },
    },
    select: {
      id: true, scheduledAt: true,
      cat: { select: { id: true, name: true, breed: true, coatType: true } },
      customer: { select: { id: true, name: true, phone: true } },
      service: { select: { name: true } },
      type: true,
    },
    orderBy: { scheduledAt: 'desc' },
    take: 60,
  })
  if (appointments.length === 0) return []

  const ids = appointments.map(a => a.id)
  const [media, drafts] = await Promise.all([
    db.mediaAsset.findMany({
      where: { ownerType: 'appointment', ownerId: { in: ids }, kind: 'image' },
      select: { id: true, ownerId: true, tag: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.contentDraft.findMany({ where: { appointmentId: { in: ids } } }),
  ])

  const beforeBy = new Map<string, string>()
  const afterBy = new Map<string, string>()
  for (const m of media) {
    if (m.tag === GROOM_MEDIA_TAGS.before && !beforeBy.has(m.ownerId)) beforeBy.set(m.ownerId, m.id)
    if (m.tag === GROOM_MEDIA_TAGS.after && !afterBy.has(m.ownerId)) afterBy.set(m.ownerId, m.id)
  }
  const draftBy = new Map(drafts.map(d => [d.appointmentId, d]))

  return appointments
    .filter(a => beforeBy.has(a.id) && afterBy.has(a.id))
    .map(a => {
      const d = draftBy.get(a.id)
      return {
        appointmentId: a.id,
        date: a.scheduledAt,
        catId: a.cat.id,
        catName: a.cat.name,
        breed: a.cat.breed,
        coatType: a.cat.coatType,
        serviceName: a.service?.name ?? a.type,
        customerId: a.customer.id,
        customerName: a.customer.name ?? a.customer.phone,
        beforeMediaId: beforeBy.get(a.id)!,
        afterMediaId: afterBy.get(a.id)!,
        draft: d ? { caption: d.caption, hashtags: JSON.parse(d.hashtags) as string[], status: d.status } : null,
      }
    })
}

/** How many pairs exist but are excluded, and why — shown so the gate is visible, not silent. */
export async function poolExclusions(withinDays = 120): Promise<{ noConsent: number; optedOut: number }> {
  const since = new Date(Date.now() - withinDays * DAY)
  const base = {
    status: 'Completed' as const,
    scheduledAt: { gte: since },
    type: { in: ['Grooming', 'Bath'] },
  }
  const [noConsent, optedOut] = await Promise.all([
    db.appointment.count({ where: { ...base, customer: { marketingConsent: false, erasedAt: null } } }),
    db.appointment.count({ where: { ...base, customer: { marketingConsent: true, erasedAt: null }, cat: { contentOptOut: true } } }),
  ])
  return { noConsent, optedOut }
}

export async function candidateFor(appointmentId: string): Promise<ContentCandidate | null> {
  // Re-runs the same gated query rather than trusting an id from a form: an
  // appointment id is guessable, and consent may have been withdrawn since the
  // page was rendered.
  const pool = await contentPool(3650)
  return pool.find(c => c.appointmentId === appointmentId) ?? null
}
