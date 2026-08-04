import { cache } from 'react'
import { db } from './db'

// ── The productization seam ──────────────────────────────────────────────────
// Every business-specific value the app used to hardcode flows through here.
// DEFAULT_CONFIG holds Cat Day's current values, so an un-seeded Setting table
// behaves identically to before — editing Settings is what changes anything.
//
// Single-tenant today. When multi-tenancy ever lands, getConfig() gains an
// optional orgId and reads that tenant's rows — the shape here does not change.

export interface AppConfig {
  business: {
    name: string       // display name (receipts, login)
    tagline: string
    legalName: string  // registered entity name (invoices)
    regNo: string      // SSM / company registration number
    address: string
    phone: string
    email: string
  }
  currency: {
    code: string       // ISO 4217, e.g. 'MYR'
    symbol: string     // 'RM'
    locale: string     // 'en-MY' — drives number & date formatting
  }
  timezone: string     // IANA, e.g. 'Asia/Kuala_Lumpur'
  tax: {
    regime: string     // 'MY-SST' | 'none' — which tax rules apply
    corporateRatePct: number
  }
  ops: {
    openHour: number   // 24h; grooming slot engine
    closeHour: number
    slotStepMin: number
  }
  data: {
    retentionYears: number // financial-record retention window; drives the erasure purge (A3)
  }
  brand: {
    logoUrl: string      // light-background logo (login) — URL or /public path
    logoDarkUrl: string  // logo for the dark sidebar
    primary: string      // accent hex — buttons, links, active states
    ink: string          // primary text hex
  }
  // M8 · the written voice. Every generator in the OS (assistant replies, and in
  // future campaign copy, captions and message variants) renders these into its
  // prompt, so generated text sounds like this business rather than like a
  // language model. See lib/brand-voice.ts.
  voice: {
    tone: string       // how it should read
    languages: string  // which languages are acceptable, and when
    emoji: string      // emoji policy — the fastest way to sound off-brand
    signature: string  // phrases and framings to favour
    avoid: string      // never-say list
  }
  marketing: {
    // M2 · what one outbound message costs, so attributed revenue can be shown
    // against a spend figure instead of on its own. Covers the WhatsApp
    // conversation fee, or a staff-time estimate while sending is manual.
    messageCostRM: number
  }
  portalLabel: string  // small footer on the login screen
}

export const DEFAULT_CONFIG: AppConfig = {
  business: {
    name: 'Cat Day',
    tagline: 'A Good Day for Every Cat',
    legalName: '',
    regNo: '',
    address: '',
    phone: '',
    email: '',
  },
  currency: { code: 'MYR', symbol: 'RM', locale: 'en-MY' },
  timezone: 'Asia/Kuala_Lumpur',
  tax: { regime: 'MY-SST', corporateRatePct: 24 },
  ops: { openHour: 10, closeHour: 19, slotStepMin: 30 },
  data: { retentionYears: 7 },
  brand: {
    logoUrl: '/catday-logo.png',
    logoDarkUrl: '/catday-logo-cream.png',
    primary: '#B14919',
    ink: '#2D1907',
  },
  voice: {
    tone: 'Warm, calm and premium. Speak like an attentive concierge who genuinely knows the cat by name — never pushy, never salesy, never gushing.',
    languages: 'Malaysian English by default. Mirror the language the customer writes in (English, Bahasa Malaysia or Mandarin) rather than translating at them.',
    emoji: 'Sparing — at most one, and 🐾 is the house emoji. Never more than one per message.',
    signature: 'Refer to the cat by name. Offer, never demand ("shall we…", "would you like us to…"). Keep it to a few short sentences a person can read on a phone.',
    avoid: 'ALL CAPS, exclamation stacking, discount-hype language ("HURRY", "LAST CHANCE"), "dear customer", "furbaby", and any claim about a cat\'s health the record does not support.',
  },
  marketing: { messageCostRM: 0.35 },
  portalLabel: 'Staff Portal',
}

// Flat "section.key" → where it maps in AppConfig, with parse/serialize.
// This is the single list the Settings form and the accessor both use.
type Field = { key: string; label: string; kind: 'text' | 'number'; group: string; hint?: string }
export const SETTING_FIELDS: Field[] = [
  { group: 'Business Identity', key: 'business.name', label: 'Business name', kind: 'text' },
  { group: 'Business Identity', key: 'business.tagline', label: 'Tagline', kind: 'text' },
  { group: 'Business Identity', key: 'business.legalName', label: 'Registered legal name', kind: 'text', hint: 'shown on invoices' },
  { group: 'Business Identity', key: 'business.regNo', label: 'Registration no. (SSM)', kind: 'text' },
  { group: 'Business Identity', key: 'business.address', label: 'Address', kind: 'text' },
  { group: 'Business Identity', key: 'business.phone', label: 'Phone', kind: 'text' },
  { group: 'Business Identity', key: 'business.email', label: 'Email', kind: 'text' },
  { group: 'Localization', key: 'currency.code', label: 'Currency code', kind: 'text', hint: 'ISO, e.g. MYR' },
  { group: 'Localization', key: 'currency.symbol', label: 'Currency symbol', kind: 'text', hint: 'e.g. RM' },
  { group: 'Localization', key: 'currency.locale', label: 'Locale', kind: 'text', hint: 'e.g. en-MY — number & date format' },
  { group: 'Localization', key: 'timezone', label: 'Timezone', kind: 'text', hint: 'IANA, e.g. Asia/Kuala_Lumpur' },
  { group: 'Tax', key: 'tax.regime', label: 'Tax regime', kind: 'text', hint: 'MY-SST or none' },
  { group: 'Tax', key: 'tax.corporateRatePct', label: 'Corporate tax rate (%)', kind: 'number' },
  { group: 'Operations', key: 'ops.openHour', label: 'Opening hour (24h)', kind: 'number' },
  { group: 'Operations', key: 'ops.closeHour', label: 'Closing hour (24h)', kind: 'number' },
  { group: 'Operations', key: 'ops.slotStepMin', label: 'Booking slot step (min)', kind: 'number' },
  { group: 'Data & Privacy', key: 'data.retentionYears', label: 'Financial record retention (years)', kind: 'number', hint: 'anonymised customers are purged once their newest record ages past this' },
  { group: 'Branding', key: 'brand.logoUrl', label: 'Logo (light background)', kind: 'text', hint: 'URL or /public path — shown on the login screen' },
  { group: 'Branding', key: 'brand.logoDarkUrl', label: 'Logo (dark sidebar)', kind: 'text', hint: 'URL or /public path — shown in the sidebar' },
  { group: 'Branding', key: 'brand.primary', label: 'Accent colour', kind: 'text', hint: 'hex, e.g. #B14919 — buttons, links' },
  { group: 'Branding', key: 'brand.ink', label: 'Text colour', kind: 'text', hint: 'hex, e.g. #2D1907' },
  { group: 'Brand Voice', key: 'voice.tone', label: 'Tone', kind: 'text', hint: 'how written messages should read' },
  { group: 'Brand Voice', key: 'voice.languages', label: 'Languages', kind: 'text', hint: 'which languages, and when to use each' },
  { group: 'Brand Voice', key: 'voice.emoji', label: 'Emoji policy', kind: 'text', hint: 'the fastest way to sound off-brand' },
  { group: 'Brand Voice', key: 'voice.signature', label: 'Signature moves', kind: 'text', hint: 'phrases and framings to favour' },
  { group: 'Brand Voice', key: 'voice.avoid', label: 'Never say', kind: 'text', hint: 'words and claims to avoid entirely' },
  { group: 'Marketing', key: 'marketing.messageCostRM', label: 'Cost per message sent', kind: 'number', hint: 'WhatsApp conversation fee or staff-time estimate; 0 to ignore spend' },
  { group: 'Business Identity', key: 'portalLabel', label: 'Login portal label', kind: 'text' },
]

// read a "a.b" path off the config object
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] ?? {}
    cur = cur[parts[i]] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

// The default value for a field key, as a string (for the form's placeholders)
export function defaultFor(key: string): string {
  const v = getPath(DEFAULT_CONFIG, key)
  return v == null ? '' : String(v)
}

// Request-cached: one DB read serves every getConfig() in a render.
export const getConfig = cache(async (): Promise<AppConfig> => {
  const rows = await db.setting.findMany({ select: { key: true, value: true } })
  // deep clone the defaults so we never mutate the module-level constant
  const config: AppConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  for (const row of rows) {
    const field = SETTING_FIELDS.find(f => f.key === row.key)
    if (!field) continue
    const raw = row.value.trim()
    if (raw === '') continue // blank override → keep the default
    setPath(config as unknown as Record<string, unknown>, row.key, field.kind === 'number' ? Number(raw) : raw)
  }
  return config
})

// ── Formatting helpers (config-aware) ───────────────────────────────────────
// Sync — a page awaits getConfig() once, then formats many values with it.
export function fmtMoney(n: number, c: AppConfig, opts?: { decimals?: number; parens?: boolean }): string {
  const decimals = opts?.decimals ?? 0
  const abs = Math.abs(n).toLocaleString(c.currency.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const body = `${c.currency.symbol} ${abs}`
  if (n < 0) return opts?.parens === false ? `-${body}` : `(${body})`
  return body
}
export function fmtDate(d: Date, c: AppConfig, style: 'short' | 'medium' | 'long' = 'medium'): string {
  return d.toLocaleDateString(c.currency.locale, { dateStyle: style, timeZone: c.timezone })
}
