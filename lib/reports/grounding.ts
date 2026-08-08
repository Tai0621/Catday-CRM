// ── C9 · The numeric grounding check ─────────────────────────────────────────
//
// The rule the whole department-report design rests on is that the model never
// computes a number. This is what makes that testable rather than aspirational:
// every figure in the generated prose is matched against the stored facts, and
// prose containing a figure that is not there does not get published.
//
// Why this is worth the trouble: an owner will eventually put one of these in
// front of an accountant. A revenue figure the OS invented ends the system's
// credibility in one meeting, and it would be invented plausibly — off by a
// rounding, not by an order of magnitude, so nobody catches it by eye.
//
// The check is deliberately strict about ARITHMETIC too. A model given
// "noShows: 4, total: 50" that writes "an 8% no-show rate" has done sound
// maths, but allowing derived values means allowing any value that some
// combination of facts could produce, which is nearly all of them. So every
// ratio worth quoting is precomputed in the fact builders, and anything else is
// flagged. If a legitimate figure keeps getting flagged, the fix is to add it
// to the facts, not to loosen this.

/** Numbers that are structure rather than measurement: the year and month being reported. */
function structuralAllowances(month: string): number[] {
  const [y, m] = month.split('-').map(Number)
  return [y, m]
}

/** Every numeric leaf anywhere in the facts object. */
export function factNumbers(facts: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof facts === 'number') {
    if (Number.isFinite(facts)) into.add(facts)
    return into
  }
  if (Array.isArray(facts)) {
    for (const v of facts) factNumbers(v, into)
    return into
  }
  if (facts && typeof facts === 'object') {
    for (const v of Object.values(facts)) factNumbers(v, into)
  }
  return into
}

export interface GroundingResult {
  ok: boolean
  checked: number
  unsupported: string[]
}

// Written as digits, optionally with thousands separators, decimals, a sign or
// a trailing percent. Words ("three cats") are not checked — they carry the
// same risk but flagging every "one" would make the check unusable.
const NUMERIC = /-?\d[\d,]*(?:\.\d+)?%?/g

/**
 * Does every number in `text` appear in `facts`?
 *
 * A match is allowed when the emitted value equals a fact value exactly, or
 * equals it rounded to the precision the model chose to write. "RM 12,438"
 * for 12437.50 is a legitimate rounding; "RM 12,700" is not.
 */
export function checkGrounding(text: string, facts: unknown, month: string): GroundingResult {
  const allowed = factNumbers(facts)
  for (const n of structuralAllowances(month)) allowed.add(n)

  // Percentages are commonly written as the same number the facts hold, but a
  // fact stored as a fraction (0.32) may be written as 32%. Admit both readings.
  const candidates = [...allowed]
  const matches = (value: number, decimals: number): boolean => {
    for (const a of candidates) {
      if (a === value) return true
      // The model rounded a stored value to the precision it wrote.
      const factor = Math.pow(10, decimals)
      if (Math.round(a * factor) / factor === value) return true
      if (Math.round(a * 100 * factor) / factor === value) return true // fraction → percent
    }
    return false
  }

  const unsupported: string[] = []
  let checked = 0
  for (const raw of text.match(NUMERIC) ?? []) {
    const cleaned = raw.replace(/,/g, '').replace(/%$/, '')
    const value = Number(cleaned)
    if (!Number.isFinite(value)) continue
    checked++
    const decimals = (cleaned.split('.')[1] ?? '').length
    if (!matches(value, decimals)) unsupported.push(raw)
  }

  return { ok: unsupported.length === 0, checked, unsupported: [...new Set(unsupported)] }
}
