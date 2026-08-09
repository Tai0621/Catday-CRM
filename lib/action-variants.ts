import { db } from './db'
import type { ActionType } from './constants'

// ── C4 · Message A/B variants ────────────────────────────────────────────────
// Every win-back message this business has sent was the same sentence, and there
// was no way to know whether it worked. A type with variants rotates competing
// copy and records which arm each customer saw, so lib/actions-learning.ts can
// score them on the same conversion definition the type itself is judged by.
//
// A type with no variant rows keeps its built-in template untouched, so this is
// opt-in per type rather than a rewrite of every message in the OS.

export interface Variant {
  label: string
  body: string
  /** M9 · null = language-neutral, eligible for anyone. */
  language?: string | null
}

export type VariantVars = Record<string, string | number>

/**
 * FNV-1a. Deterministic and stable across processes and deploys, which is the
 * whole point: assignment is by customer, so one person always sees the same
 * voice. Math.random() or a rotating counter would give the same household three
 * different personalities in a month and make the comparison meaningless.
 */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Substitute {cat}, {brand}, {customer}, {days}… leaving unknown tokens visible rather than blank. */
export function renderVariant(body: string, vars: VariantVars): string {
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole))
}

/** Active variants for every type under test, in a stable order so assignment is reproducible. */
export async function loadActiveVariants(): Promise<Map<ActionType, Variant[]>> {
  const rows = await db.actionVariant.findMany({
    where: { isActive: true },
    select: { type: true, label: true, body: true, language: true },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  })
  const out = new Map<ActionType, Variant[]>()
  for (const r of rows) {
    const key = r.type as ActionType
    const list = out.get(key) ?? []
    list.push({ label: r.label, body: r.body, language: r.language })
    out.set(key, list)
  }
  return out
}

/**
 * The message for one card. Returns the built-in template unchanged when the
 * type has no variants, so callers can adopt this without a behaviour change.
 */
export function messageFor(
  variants: Map<ActionType, Variant[]>,
  type: ActionType,
  seed: string,
  vars: VariantVars,
  fallback: string,
  language?: string | null,
): { text: string; variant?: string } {
  const all = variants.get(type)
  if (!all || all.length === 0) return { text: fallback }

  // M9 · Prefer copy written in the customer's own language; fall back to
  // language-neutral arms, and only then to everything.
  //
  // Narrowing BEFORE the hash is what makes localisation and A/B testing
  // coexist: the arms within a language still compete against each other on the
  // same conversion join, so a Malay win-back is measured against another Malay
  // win-back rather than against an English one it was never comparable to.
  const inLanguage = language ? all.filter(v => v.language === language) : []
  const neutral = all.filter(v => !v.language)
  const arms = inLanguage.length > 0 ? inLanguage : neutral.length > 0 ? neutral : all

  const arm = arms[hash(`${type}:${seed}`) % arms.length]
  return { text: renderVariant(arm.body, vars), variant: arm.label }
}
