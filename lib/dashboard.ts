import { db } from './db'
import { buildGroomingPredictions } from './grooming-reminder'
import { computePacing, monthKey, monthLabel } from './plan'
import { REVENUE_CATEGORIES, VACCINATION_ALERT_DAYS, MEMBERSHIP_EXPIRY_ALERT_DAYS } from './constants'

const DAY = 24 * 60 * 60 * 1000
const VIP_TIERS = ['Gold', 'Black Circle']

function toStreamMap(groups: { category: string; _sum: { total: number | null } }[]) {
  const m: Record<string, number> = Object.fromEntries(REVENUE_CATEGORIES.map(c => [c, 0]))
  for (const g of groups) {
    const key = (REVENUE_CATEGORIES as readonly string[]).includes(g.category) ? g.category : 'Other'
    m[key] += g._sum.total ?? 0
  }
  return m
}

export async function getDashboardData() {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + DAY)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const vaxThreshold = new Date(now.getTime() + VACCINATION_ALERT_DAYS * DAY)
  const expiryThreshold = new Date(now.getTime() + MEMBERSHIP_EXPIRY_ALERT_DAYS * DAY)

  const [
    todayByCat,
    monthByCat,
    todayAppointments,
    rooms,
    cats,
    newCustomers,
    monthConversions,
    monthAppts,
    incidentGroups,
    expiringMemberships,
    totalCustomers,
    pendingLeads,
    checkouts,
    outstanding,
    plan,
    monthTarget,
    foundingCount,
    privateClubCount,
    walletAgg,
  ] = await Promise.all([
    db.transaction.groupBy({ by: ['category'], where: { date: { gte: todayStart, lt: todayEnd } }, _sum: { total: true } }),
    db.transaction.groupBy({ by: ['category'], where: { date: { gte: monthStart, lt: monthEnd } }, _sum: { total: true } }),
    db.appointment.findMany({
      where: { scheduledAt: { gte: todayStart, lt: todayEnd }, status: { not: 'Cancelled' } },
      include: {
        customer: { include: { memberships: { where: { status: 'Active' }, include: { tier: true } } } },
        cat: true,
        room: true,
      },
      orderBy: { scheduledAt: 'asc' },
    }),
    db.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.cat.findMany({
      include: { customer: true, appointments: { select: { scheduledAt: true, status: true, type: true } } },
    }),
    db.customer.count({ where: { createdAt: { gte: monthStart, lt: monthEnd } } }),
    db.membership.count({ where: { createdAt: { gte: monthStart, lt: monthEnd } } }),
    db.appointment.findMany({
      where: { scheduledAt: { gte: monthStart, lt: monthEnd } },
      select: { customerId: true, customer: { select: { createdAt: true } } },
    }),
    db.incident.groupBy({ by: ['type'], where: { resolved: false }, _count: true }),
    db.membership.findMany({
      where: { status: 'Active', expiryDate: { lte: expiryThreshold } },
      include: { customer: true, tier: true },
      orderBy: { expiryDate: 'asc' },
    }),
    db.customer.count(),
    db.whatsAppLead.count({ where: { status: 'Pending' } }),
    db.appointment.findMany({
      where: { type: 'Boarding', endsAt: { gte: todayStart, lt: todayEnd }, status: { not: 'Cancelled' } },
      include: { customer: true, cat: true, room: true },
      orderBy: { endsAt: 'asc' },
    }),
    db.appointment.findMany({
      where: { status: 'Completed', paid: false, price: { not: null } },
      include: { customer: true, cat: true },
      orderBy: { scheduledAt: 'desc' },
      take: 10,
    }),
    db.businessPlan.findUnique({ where: { id: 'default' } }),
    db.monthlyTarget.findUnique({ where: { month: monthKey(now) } }),
    db.cat.count({ where: { foundingNumber: { not: null } } }),
    db.membership.count({ where: { status: 'Active', tier: { name: 'Black Circle' } } }),
    db.customer.aggregate({ _sum: { walletBalance: true } }),
  ])

  // ── Revenue by stream ──
  const revToday = toStreamMap(todayByCat)
  const revMonth = toStreamMap(monthByCat)
  const totalToday = Object.values(revToday).reduce((s, v) => s + v, 0)
  const totalMonth = Object.values(revMonth).reduce((s, v) => s + v, 0)

  // ── Operations ──
  const catsBoarding = todayAppointments.filter(a => a.type === 'Boarding' && a.status === 'CheckedIn').length
  const groomingToday = todayAppointments.filter(a => a.type === 'Grooming').length
  const occupiedRooms = rooms.filter(r => r.status === 'Occupied').length
  const availableRooms = rooms.filter(r => r.status === 'Available').length
  const occupancyPct = rooms.length > 0 ? Math.round((occupiedRooms / rooms.length) * 100) : 0
  const incidentMap = Object.fromEntries(incidentGroups.map(g => [g.type, g._count])) as Record<string, number>
  const safetyOpen = incidentMap['Safety'] ?? 0
  const complaintsOpen = incidentMap['Complaint'] ?? 0

  // ── Customer signals ──
  const seen = new Set<string>()
  let returningCustomers = 0
  for (const a of monthAppts) {
    if (seen.has(a.customerId)) continue
    seen.add(a.customerId)
    if (a.customer.createdAt < monthStart) returningCustomers++
  }

  const birthdaysToday = cats.filter(c => {
    if (!c.dateOfBirth) return false
    return c.dateOfBirth.getMonth() === now.getMonth() && c.dateOfBirth.getDate() === now.getDate()
  })

  const groomingReminders = buildGroomingPredictions(cats)

  // ── Alerts ──
  const vipArriving = todayAppointments.filter(a =>
    a.customer.memberships.some(m => VIP_TIERS.includes(m.tier.name)),
  )
  const vaccinationsExpiring = cats
    .filter(c => c.vaccinationExpiry && c.vaccinationExpiry <= vaxThreshold)
    .sort((a, b) => (a.vaccinationExpiry!.getTime() - b.vaccinationExpiry!.getTime()))

  // ── Breakeven pacing ──
  const pacing = computePacing(monthTarget?.revenueTarget ?? 0, totalMonth, plan?.avgSaleValue ?? 0, now)

  return {
    now,
    revenue: { today: revToday, month: revMonth, totalToday, totalMonth },
    ops: { catsBoarding, groomingToday, occupiedRooms, availableRooms, occupancyPct, safetyOpen, complaintsOpen, totalRooms: rooms.length },
    customer: {
      newCustomers,
      returningCustomers,
      monthConversions,
      birthdaysToday,
      catsDue: groomingReminders,
      totalCustomers,
      pendingLeads,
    },
    alerts: { vipArriving, vaccinationsExpiring, checkouts, outstanding },
    prive: {
      foundingCount,
      privateClubCount,
      walletLiability: walletAgg._sum.walletBalance ?? 0,
    },
    panels: { todayAppointments, rooms, groomingReminders, expiringMemberships },
    breakeven: {
      pacing,
      monthName: monthLabel(monthKey(now)),
      hasPlan: (monthTarget?.revenueTarget ?? 0) > 0,
      hasAvgSale: (plan?.avgSaleValue ?? 0) > 0,
    },
  }
}
