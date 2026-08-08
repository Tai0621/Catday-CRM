// ── C9 · The month a report covers ───────────────────────────────────────────
//
// Deliberately NOT the tenant-local helper C5 uses (lib/timezone.ts).
//
// A monthly report is read next to the income statement, and the moment its
// revenue figure disagrees with the statement's — even by one late-evening sale
// on the 31st — the report stops being evidence and starts being a second
// opinion. So the boundaries here are exactly the ones `buildIncomeStatement`,
// `computeCommission` and `buildCashFlow` already use.
//
// Those builders use server-local dates, and on Vercel that is UTC, which means
// finance months across the whole OS start at 08:00 Kuala Lumpur rather than
// midnight. That is a real and pre-existing seam. It is not fixed here on
// purpose: changing it would silently restate every historical statement, which
// is a decision for the owner and their accountant, not a side effect of adding
// reports. Reports agree with the statements, right or wrong, and both move
// together when it is addressed.

export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) }
}

/** The month before the one containing `now` — what a run on the 1st reports on. */
export function previousMonth(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })
}

export const isMonthKey = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
