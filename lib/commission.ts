import { db } from './db'
import { GROOMING_APPT_TYPES } from './constants'

// Per-service groomer commission. A completed grooming appointment earns its
// assigned groomer a % of the service revenue. Rate precedence (most specific
// wins): the groomer's own rate → the service's rate → the global default.
// Computed on read from Appointment/Service — never writes to operations.

const KEY_DEFAULT = 'hr.commissionDefaultPct'

export function resolveRate(
  staffRate: number | null | undefined,
  serviceRate: number | null | undefined,
  globalDefault: number,
): number {
  if (staffRate != null) return staffRate
  if (serviceRate != null) return serviceRate
  return globalDefault
}

export async function getCommissionDefault(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: KEY_DEFAULT } })
  const v = Number(row?.value ?? '')
  return Number.isFinite(v) && v >= 0 ? v : 0
}

export async function setCommissionDefault(pct: number): Promise<void> {
  const value = String(Math.max(0, Math.round(pct * 100) / 100))
  await db.setting.upsert({ where: { key: KEY_DEFAULT }, create: { key: KEY_DEFAULT, value }, update: { value } })
}

const round2 = (n: number) => Math.round(n * 100) / 100

export type CommissionAppt = {
  id: string; date: Date; staffName: string; serviceName: string
  revenue: number; ratePct: number; commission: number
}
export type CommissionRow = { staffId: string; staffName: string; count: number; revenue: number; commission: number }
export type CommissionReport = {
  month: string; defaultPct: number
  rows: CommissionRow[]; appts: CommissionAppt[]
  totalRevenue: number; totalCommission: number
}

export async function computeCommission(month: string): Promise<CommissionReport> {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 1)

  const [defaultPct, appts] = await Promise.all([
    getCommissionDefault(),
    db.appointment.findMany({
      where: {
        type: { in: [...GROOMING_APPT_TYPES] },
        status: 'Completed',
        staffId: { not: null },
        scheduledAt: { gte: start, lt: end },
      },
      select: {
        id: true, scheduledAt: true, price: true, staffId: true,
        staff: { select: { name: true, commissionRatePct: true } },
        service: { select: { name: true, price: true, commissionRatePct: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    }),
  ])

  const detail: CommissionAppt[] = []
  const byStaff = new Map<string, CommissionRow>()
  for (const a of appts) {
    const revenue = round2(a.price ?? a.service?.price ?? 0)
    const ratePct = resolveRate(a.staff?.commissionRatePct, a.service?.commissionRatePct, defaultPct)
    const commission = round2(revenue * ratePct / 100)
    detail.push({
      id: a.id, date: a.scheduledAt, staffName: a.staff?.name ?? '—',
      serviceName: a.service?.name ?? 'Service', revenue, ratePct, commission,
    })
    const row = byStaff.get(a.staffId!) ?? { staffId: a.staffId!, staffName: a.staff?.name ?? '—', count: 0, revenue: 0, commission: 0 }
    row.count += 1
    row.revenue = round2(row.revenue + revenue)
    row.commission = round2(row.commission + commission)
    byStaff.set(a.staffId!, row)
  }

  const rows = [...byStaff.values()].sort((a, b) => b.commission - a.commission)
  return {
    month, defaultPct, rows, appts: detail,
    totalRevenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
    totalCommission: round2(rows.reduce((s, r) => s + r.commission, 0)),
  }
}
