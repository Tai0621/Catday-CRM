import { db } from '../../db'
import { monthRange } from '../period'
import { computeCommission } from '../../commission'

// C9 · Human Resource. Hours, leave, commission, hiring.
//
// Hours come from closed TimeEntry rows only — an open clock-in is someone
// still on shift or someone who forgot to clock out, and neither belongs in a
// monthly total. The count of unclosed entries is reported instead, because
// that number IS the finding: it is how much of the payroll picture is missing.

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

export interface HrFacts {
  staff: {
    active: number
    withHours: number
    totalHours: number
    averageHoursPerActiveStaff: number
    perStaff: { name: string; hours: number; shifts: number; commissionRM: number }[]
    unclosedClockIns: number
  }
  leave: {
    daysTaken: number
    requests: number
    approved: number
    rejected: number
    pending: number
    byType: { type: string; days: number }[]
  }
  commission: { totalRM: number; onRevenueRM: number; defaultRatePct: number }
  hiring: { applicationsReceived: number; hired: number; rejected: number; inPipeline: number }
}

export async function hrFacts(month: string): Promise<HrFacts> {
  const { start, end } = monthRange(month)

  const [activeStaff, closed, openEntries, leave, applications, hired, turnedDown, pipeline, commission] = await Promise.all([
    db.staff.count({ where: { active: true } }),
    db.timeEntry.findMany({
      where: { clockInAt: { gte: start, lt: end }, clockOutAt: { not: null } },
      select: { clockInAt: true, clockOutAt: true, staff: { select: { name: true } } },
    }),
    db.timeEntry.count({ where: { clockInAt: { gte: start, lt: end }, clockOutAt: null } }),
    // Leave is keyed by "YYYY-MM-DD" strings, so a month is a prefix match.
    db.leaveRequest.findMany({
      where: { startDate: { startsWith: month } },
      select: { type: true, days: true, status: true },
    }),
    db.jobApplication.count({ where: { createdAt: { gte: start, lt: end } } }),
    db.jobApplication.count({ where: { status: 'Hired', reviewedAt: { gte: start, lt: end } } }),
    db.jobApplication.count({ where: { status: 'Rejected', reviewedAt: { gte: start, lt: end } } }),
    db.jobApplication.count({ where: { status: { in: ['New', 'Reviewing', 'Interview'] } } }),
    computeCommission(month),
  ])

  const hours = new Map<string, { hours: number; shifts: number }>()
  for (const e of closed) {
    const h = (e.clockOutAt!.getTime() - e.clockInAt.getTime()) / 3600000
    const cur = hours.get(e.staff.name) ?? { hours: 0, shifts: 0 }
    cur.hours += h
    cur.shifts++
    hours.set(e.staff.name, cur)
  }

  const commissionByName = new Map(commission.rows.map(r => [r.staffName, r.commission]))
  const totalHours = r1([...hours.values()].reduce((s, v) => s + v.hours, 0))

  const byType = new Map<string, number>()
  let daysTaken = 0
  for (const l of leave) {
    if (l.status !== 'Approved') continue
    daysTaken += l.days
    byType.set(l.type, (byType.get(l.type) ?? 0) + l.days)
  }

  return {
    staff: {
      active: activeStaff,
      withHours: hours.size,
      totalHours,
      averageHoursPerActiveStaff: activeStaff > 0 ? r1(totalHours / activeStaff) : 0,
      perStaff: [...hours.entries()]
        .map(([name, v]) => ({
          name, hours: r1(v.hours), shifts: v.shifts,
          commissionRM: r2(commissionByName.get(name) ?? 0),
        }))
        .sort((a, b) => b.hours - a.hours),
      unclosedClockIns: openEntries,
    },
    leave: {
      daysTaken,
      requests: leave.length,
      approved: leave.filter(l => l.status === 'Approved').length,
      rejected: leave.filter(l => l.status === 'Rejected').length,
      pending: leave.filter(l => l.status === 'Pending').length,
      byType: [...byType.entries()].map(([type, days]) => ({ type, days })).sort((a, b) => b.days - a.days),
    },
    commission: {
      totalRM: r2(commission.totalCommission),
      onRevenueRM: r2(commission.totalRevenue),
      defaultRatePct: commission.defaultPct,
    },
    hiring: { applicationsReceived: applications, hired, rejected: turnedDown, inPipeline: pipeline },
  }
}
