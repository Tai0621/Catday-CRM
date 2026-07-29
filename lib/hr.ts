import { db } from './db'

// ── On-premises check (pure, unit-testable) ─────────────────────────────────
// An allowlist entry matches when the IP equals it, or — for a subnet — when the
// entry ends with '.' and the IP is under it (e.g. '203.0.113.' covers the /24).
// An empty allowlist means "not configured": we can't tell, so on-premise is
// unknown (null) and never blocks.
export function checkOnPremise(ip: string | null, allowlist: string[]): boolean | null {
  if (allowlist.length === 0) return null
  if (!ip) return false
  return allowlist.some(entry => ip === entry || (entry.endsWith('.') && ip.startsWith(entry)))
}

// ── HR settings (kept as generic Setting rows — operational, not branding) ──
const KEY_IPS = 'hr.allowedIps'
const KEY_ENFORCE = 'hr.enforceOnPremise'

export type HrConfig = { allowedIps: string[]; enforceOnPremise: boolean }

export async function getHrConfig(): Promise<HrConfig> {
  const rows = await db.setting.findMany({ where: { key: { in: [KEY_IPS, KEY_ENFORCE] } } })
  const map = new Map(rows.map(r => [r.key, r.value]))
  return {
    allowedIps: (map.get(KEY_IPS) ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    enforceOnPremise: (map.get(KEY_ENFORCE) ?? '') === '1',
  }
}

export async function setHrConfig(allowedIpsCsv: string, enforceOnPremise: boolean): Promise<void> {
  const ips = allowedIpsCsv.split(/[\s,]+/).map(s => s.trim()).filter(Boolean).join(',')
  const enforce = enforceOnPremise ? '1' : '0'
  await db.$transaction([
    db.setting.upsert({ where: { key: KEY_IPS }, create: { key: KEY_IPS, value: ips }, update: { value: ips } }),
    db.setting.upsert({ where: { key: KEY_ENFORCE }, create: { key: KEY_ENFORCE, value: enforce }, update: { value: enforce } }),
  ])
}

// ── Duration helpers ─────────────────────────────────────────────────────────
export function entryMinutes(clockInAt: Date, clockOutAt: Date | null): number {
  const end = clockOutAt ?? new Date()
  return Math.max(0, Math.round((end.getTime() - clockInAt.getTime()) / 60000))
}

export function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function clientIp(headerValue: string | null): string | null {
  return (headerValue ?? '').split(',')[0].trim() || null
}
