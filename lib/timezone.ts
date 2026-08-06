// Tenant-local calendar days.
//
// Everything scheduled runs on Vercel, where the process clock is UTC, so
// `new Date(y, m, d)` gives midnight UTC — 08:00 in Kuala Lumpur. A "yesterday"
// built that way starts and ends eight hours late, quietly attributing the
// first eight hours of one trading day to the previous one. Every report that
// says "yesterday" has to mean the business's own day, so it goes through here.
//
// The zone comes from config.timezone, not a constant: a second tenant may not
// be in Malaysia.

const PARTS = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = PARTS.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    PARTS.set(timeZone, f)
  }
  return f
}

function fields(instant: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(instant)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') }
}

/** Offset of `timeZone` from UTC at this instant, in ms. Positive east of Greenwich. */
function offsetMs(instant: Date, timeZone: string): number {
  const f = fields(instant, timeZone)
  return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(instant.getTime() / 1000) * 1000
}

/** The calendar date at this instant in the tenant's zone, as "YYYY-MM-DD". */
export function zonedDayKey(instant: Date, timeZone: string): string {
  const f = fields(instant, timeZone)
  return `${f.y}-${String(f.mo).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`
}

/**
 * The instant local midnight begins on `dayKey`.
 *
 * Resolved in two passes: guess using the offset at the naive UTC instant, then
 * re-derive at the guess. Malaysia has no DST so one pass would do, but a
 * tenant in a zone that shifts would land an hour out on two days a year, and
 * the second pass costs nothing.
 */
export function zonedDayStart(dayKey: string, timeZone: string): Date {
  const naive = Date.parse(`${dayKey}T00:00:00Z`)
  const first = naive - offsetMs(new Date(naive), timeZone)
  return new Date(naive - offsetMs(new Date(first), timeZone))
}

/** Half-open [start, end) covering one local calendar day. */
export function zonedDayRange(dayKey: string, timeZone: string): { start: Date; end: Date } {
  return { start: zonedDayStart(dayKey, timeZone), end: zonedDayStart(shiftDayKey(dayKey, 1), timeZone) }
}

/** Move a "YYYY-MM-DD" key by whole days, staying on the calendar (no zone maths). */
export function shiftDayKey(dayKey: string, days: number): string {
  const d = new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86400000)
  return d.toISOString().slice(0, 10)
}
