import { SERVICE_CATEGORIES, ROOM_TYPES, TIER_QUALIFICATIONS } from '../constants'

// ── C6 · The onboarding plan ─────────────────────────────────────────────────
//
// A new client describes their business in a paragraph and gets back a full
// starting configuration to review, edit and commit. This is the resale lever:
// today a second client gets `seed-baseline.mjs`, which is four generic
// services and two rooms called "Room 1" and "Room 2".
//
// The plan is DATA, not instructions. Everything the model returns is
// normalised and range-checked here before it is ever shown, let alone
// committed — a proposed price of -50, a room capacity of 900 or a service
// category the OS has never heard of must not reach a form the owner will
// click Commit on, because at that point it looks like the system's own
// suggestion rather than a model's guess.

export const PLAN_GROUPS = ['business', 'services', 'rooms', 'tiers', 'brand', 'voice', 'templates'] as const
export type PlanGroup = (typeof PLAN_GROUPS)[number]

export interface PlanBusiness {
  name: string; tagline: string; phone: string; address: string; email: string
  currencyCode: string; currencySymbol: string; locale: string; timezone: string
  openHour: number; closeHour: number
}
export interface PlanService { name: string; category: string; durationMin: number; price: number }
export interface PlanRoom { name: string; type: string; capacity: number }
export interface PlanTier {
  name: string; tagline: string; qualification: string
  annualSpendThreshold: number | null; pointsMultiplier: number; benefits: string[]
}
export interface PlanBrand { primary: string; ink: string }
export interface PlanVoice { tone: string; languages: string; emoji: string; signature: string; avoid: string }
export interface PlanTemplate { type: string; label: string; body: string }

export interface OnboardingPlan {
  business: PlanBusiness
  services: PlanService[]
  rooms: PlanRoom[]
  tiers: PlanTier[]
  brand: PlanBrand
  voice: PlanVoice
  templates: PlanTemplate[]
  /** Advisory only. Expense categories are a code constant, so these map the
   *  client's described costs onto the categories that already exist rather
   *  than inventing new ones that no statement row would ever read. */
  expenseGuidance: { category: string; examples: string }[]
  /** Anything the model could not infer and the owner must decide. */
  notes: string[]
}

// ── normalisation ────────────────────────────────────────────────────────────

const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}
const money = (v: unknown, hi: number) => Math.round(num(v, 0, hi, 0) * 100) / 100
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  const s = String(v ?? '')
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback
}
const HEX = /^#[0-9a-fA-F]{6}$/
const hex = (v: unknown, fallback: string) => (HEX.test(String(v ?? '')) ? String(v).toUpperCase() : fallback)

// Ceilings are sanity limits, not business rules: they exist so an obviously
// wrong figure never reaches a Commit button looking authoritative.
const MAX_SERVICE_PRICE = 5000
const MAX_SERVICES = 24
const MAX_ROOMS = 80
const MAX_TIERS = 6
const MAX_TEMPLATES = 12

const dedupe = <T>(items: T[], key: (t: T) => string): T[] => {
  const seen = new Set<string>()
  return items.filter(i => {
    const k = key(i).toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function normalisePlan(raw: unknown, templateTypes: readonly string[]): OnboardingPlan {
  const r = (raw ?? {}) as Record<string, unknown>
  const b = (r.business ?? {}) as Record<string, unknown>
  const brand = (r.brand ?? {}) as Record<string, unknown>
  const voice = (r.voice ?? {}) as Record<string, unknown>

  const openHour = num(b.openHour, 0, 23, 9)

  return {
    business: {
      name: str(b.name, 80),
      tagline: str(b.tagline, 120),
      phone: str(b.phone, 40),
      address: str(b.address, 200),
      email: str(b.email, 120),
      currencyCode: str(b.currencyCode, 3).toUpperCase() || 'MYR',
      currencySymbol: str(b.currencySymbol, 5) || 'RM',
      locale: str(b.locale, 12) || 'en-MY',
      timezone: str(b.timezone, 60) || 'Asia/Kuala_Lumpur',
      openHour,
      // Closing before opening would break the slot engine outright.
      closeHour: num(b.closeHour, openHour + 1, 24, Math.max(openHour + 1, 18)),
    },
    services: dedupe(arr(r.services).map(s => {
      const x = (s ?? {}) as Record<string, unknown>
      return {
        name: str(x.name, 60),
        category: pick(x.category, SERVICE_CATEGORIES, 'Grooming'),
        durationMin: Math.round(num(x.durationMin, 5, 600, 60)),
        price: money(x.price, MAX_SERVICE_PRICE),
      }
    }).filter(s => s.name), s => s.name).slice(0, MAX_SERVICES),

    rooms: dedupe(arr(r.rooms).map(s => {
      const x = (s ?? {}) as Record<string, unknown>
      return {
        name: str(x.name, 40),
        type: pick(x.type, ROOM_TYPES, 'Standard'),
        capacity: Math.round(num(x.capacity, 1, 20, 2)),
      }
    }).filter(x => x.name), x => x.name).slice(0, MAX_ROOMS),

    tiers: dedupe(arr(r.tiers).map(s => {
      const x = (s ?? {}) as Record<string, unknown>
      const qualification = pick(x.qualification, TIER_QUALIFICATIONS, 'Auto')
      return {
        name: str(x.name, 40),
        tagline: str(x.tagline, 120),
        qualification,
        // Only a spending tier has a threshold; carrying one on an Auto tier
        // would show a number that nothing ever evaluates.
        annualSpendThreshold: qualification === 'Spending'
          ? money(x.annualSpendThreshold, 1_000_000) || null
          : null,
        pointsMultiplier: num(x.pointsMultiplier, 1, 10, 1),
        benefits: arr(x.benefits).map(v => str(v, 80)).filter(Boolean).slice(0, 8),
      }
    }).filter(x => x.name), x => x.name).slice(0, MAX_TIERS),

    brand: { primary: hex(brand.primary, '#B14919'), ink: hex(brand.ink, '#2D1907') },

    voice: {
      tone: str(voice.tone, 400),
      languages: str(voice.languages, 300),
      emoji: str(voice.emoji, 200),
      signature: str(voice.signature, 400),
      avoid: str(voice.avoid, 400),
    },

    templates: dedupe(arr(r.templates).map(s => {
      const x = (s ?? {}) as Record<string, unknown>
      return {
        type: pick(x.type, templateTypes, templateTypes[0]),
        label: str(x.label, 40),
        body: str(x.body, 600),
      }
    }).filter(x => x.label && x.body), x => `${x.type}:${x.label}`).slice(0, MAX_TEMPLATES),

    expenseGuidance: arr(r.expenseGuidance).map(s => {
      const x = (s ?? {}) as Record<string, unknown>
      return { category: str(x.category, 60), examples: str(x.examples, 200) }
    }).filter(x => x.category).slice(0, 20),

    notes: arr(r.notes).map(v => str(v, 300)).filter(Boolean).slice(0, 8),
  }
}

export function groupCount(plan: OnboardingPlan, group: PlanGroup): number {
  switch (group) {
    case 'services': return plan.services.length
    case 'rooms': return plan.rooms.length
    case 'tiers': return plan.tiers.length
    case 'templates': return plan.templates.length
    default: return 1
  }
}
