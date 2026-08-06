import { db } from './db'
import { buildCustomerIntel, type CustomerIntel } from './intelligence'
import { MARKETING_FREQUENCY_CAP_DAYS, MARKETING_SEND_LOOKBACK_DAYS } from './constants'

const DAY = 24 * 60 * 60 * 1000

// ── M10 · Customer groups ────────────────────────────────────────────────────
// An audience is a saved QUERY, not a saved list: it re-evaluates every time it
// is opened. A frozen list is how a win-back gets sent to someone who came in
// yesterday.
//
// Rules are a closed, typed vocabulary — never free SQL — over what the OS
// already knows. Three things are deliberately true of this module:
//
//  1. HEALTH DATA IS NOT TARGETABLE. `healthNotes`, `medication`, vaccination
//     and parasite state are absent from the vocabulary on purpose. "We noticed
//     your cat has kidney disease, here's an offer" is a PDPA problem and brand
//     damage that does not get walked back. Do not add them.
//  2. CONSENT IS A FLOOR, NOT A RULE. evaluateGroup() answers "who is in this
//     audience" for counting and analysis. sendableMembers() is the only path to
//     outreach, and it always ANDs consent and non-erasure regardless of what
//     the rules say.
//  3. THE FREQUENCY CAP IS GLOBAL. It is applied in sendableMembers() across
//     every group, because a per-group cap cannot see the other groups.

export interface GroupRules {
  segments?: CustomerIntel['segment'][]
  churnRisk?: CustomerIntel['churnRisk'][]
  minVisits?: number
  maxVisits?: number
  minLifetimeRM?: number
  minDaysSinceVisit?: number
  maxDaysSinceVisit?: number
  neverVisited?: boolean
  hasMembershipTier?: string[]
  lacksMembershipTier?: string[]
  coatType?: string[]
  lifeStage?: string[]
  source?: string[]
  /** 'boarding' = has boarded but never groomed, and vice versa. */
  serviceMix?: 'boarding-only' | 'grooming-only'
}

export interface CustomerGroup {
  key: string
  name: string
  description: string
  /** Why this audience is worth messaging — shown to whoever is about to send. */
  intent: string
  rules: GroupRules
  /** {customer} {cat} {brand} are substituted per recipient. */
  message: string
}

// Audiences live in code rather than seeded rows so every tenant picks up an
// improved definition on deploy instead of drifting apart in their own database.
export const SYSTEM_GROUPS: CustomerGroup[] = [
  {
    key: 'at-risk',
    name: 'At risk',
    description: 'Past their own usual gap between visits, but not gone yet.',
    intent: 'The cheapest customer to keep is one who has not left. Reach these before they become win-backs.',
    rules: { churnRisk: ['At-risk'] },
    message: `Hi {customer}! It's been a little while since we saw {cat} at {brand} 🐾 Would you like us to find a slot this week?`,
  },
  {
    key: 'lapsed-90',
    name: 'Lapsed 90+ days',
    description: 'No visit in three months and nothing booked.',
    intent: 'Long enough to have drifted, recent enough to remember you.',
    rules: { minDaysSinceVisit: 90 },
    message: `Hi {customer}! We've missed {cat} at {brand} 🐾 There's a slot with their name on it whenever you're ready.`,
  },
  {
    key: 'gold-eligible',
    name: 'Gold eligible',
    description: 'Spending like a Gold member without the card.',
    intent: 'Recognition costs nothing and these are already your best customers.',
    rules: { minLifetimeRM: 3000, lacksMembershipTier: ['Gold', 'Black Circle'] },
    message: `Hi {customer}! {cat} has been such a regular with us that we'd love to move you onto Gold — same visits, better benefits 🐾`,
  },
  {
    key: 'new-this-month',
    name: 'New this month',
    description: 'First visit within the last 30 days.',
    intent: 'The second visit is the one that decides whether there is a third.',
    rules: { segments: ['New'], maxDaysSinceVisit: 30 },
    message: `Hi {customer}! Lovely to meet {cat} 🐾 If there's anything we should know before the next visit, just tell us.`,
  },
  {
    key: 'long-coat-overdue',
    name: 'Long coat, overdue',
    description: 'Long-coated cats past 45 days since their last visit.',
    intent: 'Long coats mat. This is a welfare nudge as much as a booking one.',
    rules: { coatType: ['Long'], minDaysSinceVisit: 45 },
    message: `Hi {customer}! Long coats can start to mat around now — shall we get {cat} in for a groom this week? 🐾`,
  },
  {
    key: 'boarding-only',
    name: 'Boarding only',
    description: 'Has boarded with you but never booked a groom.',
    intent: 'They already trust you with the cat overnight. Grooming is the easiest cross-sell you have.',
    rules: { serviceMix: 'boarding-only' },
    message: `Hi {customer}! Since {cat} already stays with us, would you like us to add a groom to the next visit? 🐾`,
  },
]

export const groupByKey = (key: string) => SYSTEM_GROUPS.find(g => g.key === key)

export interface Member {
  id: string
  name: string
  phone: string
  catName: string | null
  intel: CustomerIntel
  marketingConsent: boolean
  lastSentAt: Date | null
}

interface Candidate extends Member {
  coatTypes: string[]
  lifeStages: string[]
  source: string
  tiers: string[]
  hasBoarded: boolean
  hasGroomed: boolean
}

async function loadCandidates(now: Date): Promise<Candidate[]> {
  const sendSince = new Date(now.getTime() - MARKETING_SEND_LOOKBACK_DAYS * DAY)

  const [customers, sends] = await Promise.all([
    db.customer.findMany({
      // Erased customers are excluded at the query layer, not the prompt layer —
      // Track A's erasure guarantee has to hold here too.
      where: { erasedAt: null },
      select: {
        id: true, name: true, phone: true, source: true, marketingConsent: true, createdAt: true,
        // Deliberately NOT selecting healthNotes or medication: see the note at
        // the top of this file.
        cats: { select: { name: true, coatType: true, lifeStage: true } },
        memberships: { where: { status: 'Active' }, select: { tier: { select: { name: true } } } },
        appointments: { select: { scheduledAt: true, status: true, type: true } },
        transactions: { select: { total: true } },
      },
    }),
    db.groupSend.findMany({
      where: { sentAt: { gte: sendSince } },
      select: { customerId: true, sentAt: true },
      orderBy: { sentAt: 'desc' },
    }),
  ])

  const lastSend = new Map<string, Date>()
  for (const s of sends) if (!lastSend.has(s.customerId)) lastSend.set(s.customerId, s.sentAt)

  return customers.map(c => ({
    id: c.id,
    name: c.name ?? c.phone,
    phone: c.phone,
    catName: c.cats[0]?.name ?? null,
    // Segment and cadence are derived from history, not stored — so the column
    // filter above narrows the set and this pass decides membership.
    intel: buildCustomerIntel({
      createdAt: c.createdAt,
      appointments: c.appointments,
      transactions: c.transactions,
      memberships: c.memberships.map(m => ({ status: 'Active', tier: { name: m.tier.name } })),
    }, now),
    marketingConsent: c.marketingConsent,
    lastSentAt: lastSend.get(c.id) ?? null,
    coatTypes: c.cats.map(x => x.coatType).filter((v): v is string => !!v),
    lifeStages: c.cats.map(x => x.lifeStage).filter((v): v is string => !!v),
    source: c.source,
    tiers: c.memberships.map(m => m.tier.name),
    hasBoarded: c.appointments.some(a => a.type === 'Boarding' && a.status !== 'Cancelled'),
    hasGroomed: c.appointments.some(a => a.type === 'Grooming' && a.status !== 'Cancelled'),
  }))
}

function matches(c: Candidate, r: GroupRules): boolean {
  const { intel } = c
  if (r.segments && !r.segments.includes(intel.segment)) return false
  if (r.churnRisk && !r.churnRisk.includes(intel.churnRisk)) return false
  if (r.minVisits != null && intel.visits < r.minVisits) return false
  if (r.maxVisits != null && intel.visits > r.maxVisits) return false
  if (r.minLifetimeRM != null && intel.ltv < r.minLifetimeRM) return false
  if (r.neverVisited === true && intel.visits > 0) return false

  if (r.minDaysSinceVisit != null) {
    if (intel.daysSinceLastVisit == null || intel.daysSinceLastVisit < r.minDaysSinceVisit) return false
  }
  if (r.maxDaysSinceVisit != null) {
    if (intel.daysSinceLastVisit == null || intel.daysSinceLastVisit > r.maxDaysSinceVisit) return false
  }

  if (r.hasMembershipTier && !r.hasMembershipTier.some(t => c.tiers.includes(t))) return false
  if (r.lacksMembershipTier && r.lacksMembershipTier.some(t => c.tiers.includes(t))) return false
  if (r.coatType && !r.coatType.some(t => c.coatTypes.includes(t))) return false
  if (r.lifeStage && !r.lifeStage.some(t => c.lifeStages.includes(t))) return false
  if (r.source && !r.source.includes(c.source)) return false

  if (r.serviceMix === 'boarding-only' && !(c.hasBoarded && !c.hasGroomed)) return false
  if (r.serviceMix === 'grooming-only' && !(c.hasGroomed && !c.hasBoarded)) return false

  return true
}

export interface GroupAudience {
  total: number          // everyone matching the rules
  consented: number      // …of whom may legally be messaged
  sendable: Member[]     // …and are not inside the frequency cap
  cappedOut: number      // consented, but messaged too recently
  members: Member[]      // everyone matching, for analysis and preview
}

/**
 * Who is in this audience. For counting, previewing and analysis — this does
 * NOT filter on consent, because asking "how many at-risk customers do we have"
 * is a legitimate question about people who never opted into marketing.
 */
export async function evaluateGroup(group: CustomerGroup, now: Date = new Date()): Promise<GroupAudience> {
  const candidates = await loadCandidates(now)
  const matched = candidates.filter(c => matches(c, group.rules))

  const capCutoff = new Date(now.getTime() - MARKETING_FREQUENCY_CAP_DAYS * DAY)
  const consented = matched.filter(c => c.marketingConsent)
  const sendable = consented.filter(c => !c.lastSentAt || c.lastSentAt < capCutoff)

  const strip = (c: Candidate): Member => ({
    id: c.id, name: c.name, phone: c.phone, catName: c.catName,
    intel: c.intel, marketingConsent: c.marketingConsent, lastSentAt: c.lastSentAt,
  })

  return {
    total: matched.length,
    consented: consented.length,
    sendable: sendable.map(strip),
    cappedOut: consented.length - sendable.length,
    members: matched.map(strip),
  }
}

/**
 * The only path to outreach. Consent and non-erasure are enforced here rather
 * than left to the caller, so a new send surface cannot forget them.
 */
export async function sendableMembers(group: CustomerGroup, now: Date = new Date()): Promise<Member[]> {
  return (await evaluateGroup(group, now)).sendable
}

export type SendGate =
  | { ok: true; name: string; phone: string }
  | { ok: false; reason: string }

/**
 * The same floor as sendableMembers(), for one customer reached outside a
 * group — the copilot drafting a message (C2), or any future one-off surface.
 *
 * Every customer message originating from the OS goes through this, including
 * ones that read as operational rather than marketing. Service messages do not
 * legally need consent, but the alternative is letting the sender classify its
 * own intent, and when the sender is a model that is not a judgement to
 * delegate. Staff who need to send an operational message still do it from the
 * customer's own page, exactly as before.
 */
export async function canMessage(customerId: string, now: Date = new Date()): Promise<SendGate> {
  const c = await db.customer.findFirst({
    where: { id: customerId, erasedAt: null },
    select: { name: true, phone: true, marketingConsent: true },
  })
  if (!c) return { ok: false, reason: 'That customer is not contactable.' }
  if (!c.marketingConsent) return { ok: false, reason: `${c.name ?? c.phone} never agreed to marketing.` }

  const capCutoff = new Date(now.getTime() - MARKETING_FREQUENCY_CAP_DAYS * DAY)
  const recent = await db.groupSend.findFirst({
    where: { customerId, sentAt: { gte: capCutoff } },
    select: { sentAt: true },
  })
  if (recent) {
    return { ok: false, reason: `${c.name ?? c.phone} was messaged in the last ${MARKETING_FREQUENCY_CAP_DAYS} days.` }
  }
  return { ok: true, name: c.name ?? c.phone, phone: c.phone }
}

/** Fill {customer} {cat} {brand}; leave unknown tokens visible rather than blank. */
export function renderMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (vars[key] ? vars[key] : whole))
}
