// HR · leave helpers. Dates are "YYYY-MM-DD" strings throughout.

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Inclusive day count between two YYYY-MM-DD dates (min 1). */
export function leaveDays(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00')
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
}

/** Whether a leave [start,end] covers the given day (all YYYY-MM-DD). */
export function coversDay(start: string, end: string, day: string): boolean {
  return start <= day && day <= end
}

export const LEAVE_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  Pending:  { color: '#8a6c00', bg: 'rgba(184,144,43,0.16)' },
  Approved: { color: '#4d6330', bg: 'rgba(95,122,63,0.16)' },
  Rejected: { color: '#B14919', bg: 'rgba(177,73,25,0.12)' },
}
