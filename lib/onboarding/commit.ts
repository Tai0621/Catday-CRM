import { db } from '../db'
import { recordAudit } from '../audit'
import { SERVICE_CATEGORIES, ROOM_TYPES, TIER_QUALIFICATIONS } from '../constants'
import type { OnboardingPlan, PlanGroup } from './plan'
import { LIVE_CUSTOMER } from '../cat-stock'

// ── C6 · Committing a group ──────────────────────────────────────────────────
//
// Two rules, and they are the whole safety story:
//
//  1. CATALOGUE COMMITS ARE STRICTLY ADDITIVE. Services, rooms, tiers and
//     message templates are created if the name is free and SKIPPED if it is
//     taken. Nothing is updated, nothing is deleted. Onboarding run by mistake
//     on a live business leaves a few extra rows to remove — not a rewritten
//     price list and a week of appointments pointing at services that no longer
//     say what they cost.
//
//  2. SETTINGS OVERWRITE, SO THEY ARE GATED. Business identity, brand colours
//     and voice are single-valued: committing them replaces what is there. The
//     page requires an explicit confirmation for these on an instance that
//     already has customers.
//
// The values committed are the ones in the FORM, not the ones in the stored
// plan: the owner edits before committing, and what they saw is what gets
// written. Validation therefore runs again here — the form is a boundary.

const clamp = (n: number, lo: number, hi: number, fallback: number) =>
  (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback)

export interface CommitResult {
  group: PlanGroup
  created: number
  skipped: number
  skippedNames: string[]
}

/** Whether this instance is already carrying a real business. */
export async function hasLiveData(): Promise<boolean> {
  const [customers, transactions] = await Promise.all([
    db.customer.count({ where: LIVE_CUSTOMER }),
    db.transaction.count(),
  ])
  return customers > 0 || transactions > 0
}

export async function commitServices(items: OnboardingPlan['services']): Promise<CommitResult> {
  const existing = new Set((await db.service.findMany({ select: { name: true } })).map(s => s.name.toLowerCase()))
  let created = 0
  const skipped: string[] = []
  let order = await db.service.count()

  for (const s of items) {
    const name = s.name.trim()
    if (!name) continue
    if (existing.has(name.toLowerCase())) { skipped.push(name); continue }
    await db.service.create({
      data: {
        name,
        category: (SERVICE_CATEGORIES as readonly string[]).includes(s.category) ? s.category : 'Grooming',
        durationMin: Math.round(clamp(Number(s.durationMin), 5, 600, 60)),
        price: Math.round(clamp(Number(s.price), 0, 5000, 0) * 100) / 100,
        sortOrder: order++,
      },
    })
    existing.add(name.toLowerCase())
    created++
  }
  return { group: 'services', created, skipped: skipped.length, skippedNames: skipped }
}

export async function commitRooms(items: OnboardingPlan['rooms']): Promise<CommitResult> {
  const existing = new Set((await db.room.findMany({ select: { name: true } })).map(r => r.name.toLowerCase()))
  let created = 0
  const skipped: string[] = []
  let order = await db.room.count()

  for (const r of items) {
    const name = r.name.trim()
    if (!name) continue
    if (existing.has(name.toLowerCase())) { skipped.push(name); continue }
    await db.room.create({
      data: {
        name,
        type: (ROOM_TYPES as readonly string[]).includes(r.type) ? r.type : 'Standard',
        capacity: Math.round(clamp(Number(r.capacity), 1, 20, 2)),
        sortOrder: order++,
      },
    })
    existing.add(name.toLowerCase())
    created++
  }
  return { group: 'rooms', created, skipped: skipped.length, skippedNames: skipped }
}

export async function commitTiers(items: OnboardingPlan['tiers']): Promise<CommitResult> {
  const existing = new Set((await db.membershipTier.findMany({ select: { name: true } })).map(t => t.name.toLowerCase()))
  let created = 0
  const skipped: string[] = []
  let order = await db.membershipTier.count()

  for (const t of items) {
    const name = t.name.trim()
    if (!name) continue
    if (existing.has(name.toLowerCase())) { skipped.push(name); continue }
    const qualification = (TIER_QUALIFICATIONS as readonly string[]).includes(t.qualification) ? t.qualification : 'Auto'
    await db.membershipTier.create({
      data: {
        name,
        tagline: t.tagline?.trim() || '',
        monthlyPrice: 0,
        qualification,
        annualSpendThreshold: qualification === 'Spending' && t.annualSpendThreshold
          ? Math.round(clamp(Number(t.annualSpendThreshold), 0, 1_000_000, 0) * 100) / 100
          : null,
        pointsMultiplier: clamp(Number(t.pointsMultiplier), 1, 10, 1),
        cardType: 'Digital',
        benefits: JSON.stringify((t.benefits ?? []).filter(Boolean).slice(0, 8)),
        color: '#729094',
        sortOrder: order++,
      },
    })
    existing.add(name.toLowerCase())
    created++
  }
  return { group: 'tiers', created, skipped: skipped.length, skippedNames: skipped }
}

export async function commitTemplates(items: OnboardingPlan['templates']): Promise<CommitResult> {
  const existing = new Set(
    (await db.actionVariant.findMany({ select: { type: true, label: true } }))
      .map(v => `${v.type}:${v.label}`.toLowerCase()))
  let created = 0
  const skipped: string[] = []

  for (const t of items) {
    const label = t.label.trim()
    const body = t.body.trim()
    if (!label || !body) continue
    const key = `${t.type}:${label}`.toLowerCase()
    if (existing.has(key)) { skipped.push(label); continue }
    // Seeded INACTIVE. A variant row is live copy a customer reads, and C4's
    // rotation would start showing it the moment it exists; the owner turns it
    // on from the variants page once they have read it.
    await db.actionVariant.create({ data: { type: t.type, label, body, isActive: false } })
    existing.add(key)
    created++
  }
  return { group: 'templates', created, skipped: skipped.length, skippedNames: skipped }
}

/** Settings are single-valued, so this REPLACES. Gated in the UI. */
async function writeSettings(entries: [string, string][]): Promise<number> {
  let written = 0
  for (const [key, value] of entries) {
    if (value === '' || value == null) continue
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
    written++
  }
  return written
}

export async function commitBusiness(b: OnboardingPlan['business']): Promise<CommitResult> {
  const written = await writeSettings([
    ['business.name', b.name], ['business.tagline', b.tagline], ['business.phone', b.phone],
    ['business.address', b.address], ['business.email', b.email],
    ['currency.code', b.currencyCode], ['currency.symbol', b.currencySymbol],
    ['currency.locale', b.locale], ['timezone', b.timezone],
    ['ops.openHour', String(Math.round(clamp(Number(b.openHour), 0, 23, 9)))],
    ['ops.closeHour', String(Math.round(clamp(Number(b.closeHour), 1, 24, 18)))],
  ])
  return { group: 'business', created: written, skipped: 0, skippedNames: [] }
}

export async function commitBrand(brand: OnboardingPlan['brand']): Promise<CommitResult> {
  const hex = (v: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : '')
  const written = await writeSettings([['brand.primary', hex(brand.primary)], ['brand.ink', hex(brand.ink)]])
  return { group: 'brand', created: written, skipped: 0, skippedNames: [] }
}

export async function commitVoice(v: OnboardingPlan['voice']): Promise<CommitResult> {
  const written = await writeSettings([
    ['voice.tone', v.tone], ['voice.languages', v.languages], ['voice.emoji', v.emoji],
    ['voice.signature', v.signature], ['voice.avoid', v.avoid],
  ])
  return { group: 'voice', created: written, skipped: 0, skippedNames: [] }
}

/** Which groups replace what is already there, rather than adding to it. */
export const DESTRUCTIVE_GROUPS: PlanGroup[] = ['business', 'brand', 'voice']

export async function auditCommit(result: CommitResult, planId: string): Promise<void> {
  await recordAudit({
    action: `onboarding.${result.group}`,
    entityType: 'OnboardingPlan',
    entityId: planId,
    summary: `Onboarding — committed ${result.group}: ${result.created} created`
      + (result.skipped ? `, ${result.skipped} skipped (already present)` : ''),
    detail: { group: result.group, created: result.created, skipped: result.skippedNames },
  })
}
