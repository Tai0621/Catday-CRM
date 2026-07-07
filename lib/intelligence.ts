import { WINBACK_INACTIVE_DAYS } from './constants'

const DAY = 24 * 60 * 60 * 1000
const DEFAULT_CADENCE_DAYS = 45
const VIP_TIERS = ['Gold', 'Black Circle']

export interface CustomerIntel {
  ltv: number
  visits: number
  avgTicket: number
  personalCadenceDays: number
  daysSinceLastVisit: number | null // null = never visited
  churnRisk: 'Healthy' | 'At-risk' | 'Lost'
  segment: 'New' | 'Regular' | 'VIP' | 'At-risk' | 'Lost'
}

export const SEGMENTS = ['New', 'Regular', 'VIP', 'At-risk', 'Lost'] as const

interface IntelInput {
  createdAt: Date
  appointments: { scheduledAt: Date; status?: string }[] // any order
  transactions: { total: number }[]
  memberships?: { status: string; tier: { name: string } }[]
}

/**
 * Derive a customer's health from their own history — cadence is personal
 * (median gap between their visits), so a monthly groomer and a quarterly
 * boarder are judged against their own rhythm, not a global rule.
 */
export function buildCustomerIntel(c: IntelInput, now: Date = new Date()): CustomerIntel {
  const past = c.appointments
    .filter(a => a.scheduledAt <= now && a.status !== 'Cancelled' && a.status !== 'NoShow')
    .map(a => a.scheduledAt.getTime())
    .sort((a, b) => a - b)

  const ltv = c.transactions.reduce((s, t) => s + t.total, 0)
  const visits = past.length
  const avgTicket = c.transactions.length > 0 ? ltv / c.transactions.length : 0

  // Personal cadence: median gap between consecutive visits
  let cadence = DEFAULT_CADENCE_DAYS
  if (past.length >= 2) {
    const gaps = past.slice(1).map((t, i) => (t - past[i]) / DAY).sort((a, b) => a - b)
    cadence = Math.max(7, Math.round(gaps[Math.floor(gaps.length / 2)]))
  }

  const daysSinceLastVisit = past.length > 0 ? Math.floor((now.getTime() - past[past.length - 1]) / DAY) : null

  let churnRisk: CustomerIntel['churnRisk'] = 'Healthy'
  if (daysSinceLastVisit !== null) {
    if (daysSinceLastVisit >= WINBACK_INACTIVE_DAYS) churnRisk = 'Lost'
    else if (daysSinceLastVisit > cadence * 1.5) churnRisk = 'At-risk'
  }

  const isVip = (c.memberships ?? []).some(m => m.status === 'Active' && VIP_TIERS.includes(m.tier.name))
  const isNew = now.getTime() - c.createdAt.getTime() < 30 * DAY

  let segment: CustomerIntel['segment']
  if (churnRisk === 'Lost' && visits > 0) segment = 'Lost'
  else if (churnRisk === 'At-risk') segment = 'At-risk'
  else if (isVip) segment = 'VIP'
  else if (isNew || visits === 0) segment = 'New'
  else segment = 'Regular'

  return { ltv, visits, avgTicket, personalCadenceDays: cadence, daysSinceLastVisit, churnRisk, segment }
}

export function segmentStyle(segment: string): { background: string; color: string } {
  const m: Record<string, { background: string; color: string }> = {
    New:       { background: 'rgba(114,144,148,0.2)', color: '#729094' },
    Regular:   { background: 'rgba(45,25,7,0.1)', color: '#2D1907' },
    VIP:       { background: 'rgba(184,144,43,0.2)', color: '#8a6c00' },
    'At-risk': { background: 'rgba(231,206,122,0.4)', color: '#7a5c00' },
    Lost:      { background: 'rgba(177,73,25,0.15)', color: '#B14919' },
  }
  return m[segment] ?? { background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.5)' }
}
