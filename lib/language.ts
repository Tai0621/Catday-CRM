import { CUSTOMER_LANGUAGES, type CustomerLanguage } from './constants'

// ── M9 · Language ────────────────────────────────────────────────────────────
//
// This market is trilingual and a message written natively in the customer's
// language reads better than one translated into it. Two rules shape everything
// here:
//
//  1. UNKNOWN IS A REAL ANSWER. Null does not mean English — it means nobody has
//     established it, and the business default is used. Guessing wrong is worse
//     than staying neutral, because a household written to in the wrong language
//     reads as a business that does not know them.
//
//  2. DETECTION IS A HINT, NEVER AN OVERRIDE. What someone typed once is weak
//     evidence; what a staff member recorded is strong. `detect` is only ever
//     applied to a customer whose language is still null.

export const isLanguage = (v: unknown): v is CustomerLanguage =>
  (CUSTOMER_LANGUAGES as readonly string[]).includes(String(v))

// CJK ideographs. Unambiguous in this market: nothing in English or Malay uses
// them, so a single character is enough.
const CJK = /[一-鿿㐀-䶿]/

// Malay function words that are rare or absent in English. Matched whole-word
// and scored, because a single hit is not evidence — "dan" appears in names and
// "ada" in other languages.
const MALAY_MARKERS = [
  'saya', 'anda', 'awak', 'boleh', 'tak', 'tidak', 'nak', 'dengan', 'untuk',
  'yang', 'ini', 'itu', 'ada', 'sudah', 'belum', 'bila', 'berapa', 'harga', 'kucing',
  'macam', 'mana', 'terima kasih', 'sila', 'jumpa', 'hari', 'esok', 'petang',
]
const MALAY_THRESHOLD = 2

/**
 * Best guess at the language of a piece of customer-written text.
 *
 * Returns null when there is no real signal, which is most short messages —
 * "ok thanks" is not evidence of anything. Deliberately simple: this runs on
 * inbound WhatsApp and must not cost a model call, and a wrong confident answer
 * is worse than an honest null.
 */
export function detect(text: string): CustomerLanguage | null {
  const raw = String(text ?? '').trim()
  if (raw.length < 8) return null
  if (CJK.test(raw)) return 'Mandarin'

  const lower = ` ${raw.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `
  let hits = 0
  for (const marker of MALAY_MARKERS) if (lower.includes(` ${marker} `)) hits++
  if (hits >= MALAY_THRESHOLD) return 'Bahasa Malaysia'

  // No positive signal for English — only the absence of the other two, which is
  // not the same thing. Left null so the business default applies.
  return null
}

/**
 * The language to write to this customer in, or null to use the business default.
 * Anything not in the allow-list is treated as unknown rather than passed through.
 */
export function languageOf(customer: { language?: string | null } | null | undefined): CustomerLanguage | null {
  return isLanguage(customer?.language) ? customer.language as CustomerLanguage : null
}

/**
 * Prompt fragment telling a generator which language to write in.
 *
 * "Write in X" rather than "translate into X" on purpose: a translated message
 * carries English sentence shapes and reads like a translation, which is exactly
 * the tell this feature exists to remove.
 */
export function languagePrompt(language: CustomerLanguage | null): string {
  if (!language) return ''
  return `Write this in ${language}, natively — compose it in that language rather than translating an English sentence into it. Keep names, prices and dates exactly as given.`
}
