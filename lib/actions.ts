import { db } from './db'
import { buildGroomingPredictions } from './grooming-reminder'
import { trailingAnnualSpend } from './loyalty'
import {
  type ActionType,
  WINBACK_INACTIVE_DAYS,
  BIRTHDAY_LOOKAHEAD_DAYS,
  ACTION_DISMISS_WINDOW_DAYS,
  VACCINATION_ALERT_DAYS,
  MEMBERSHIP_EXPIRY_ALERT_DAYS,
  GOLD_SPEND_THRESHOLD,
} from './constants'

const DAY = 24 * 60 * 60 * 1000
const VIP_TIERS = ['Gold', 'Black Circle']

export interface ActionCard {
  key: string
  type: ActionType
  priority: number // 1 (most urgent) … 9
  band: 'Do now' | 'This week' | 'Opportunities'
  title: string
  reason: string
  customerId?: string
  catId?: string
  phone?: string
  waMessage?: string // pre-composed WhatsApp text
  href?: string      // in-app link when WhatsApp isn't the action
  amountRM?: number
}

function band(priority: number): ActionCard['band'] {
  if (priority <= 3) return 'Do now'
  if (priority <= 6) return 'This week'
  return 'Opportunities'
}

function card(c: Omit<ActionCard, 'band'>): ActionCard {
  return { ...c, band: band(c.priority) }
}

/** Days until the next occurrence of a birthday (0 = today). */
function daysToBirthday(dob: Date, now: Date): number {
  const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate())
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(next.getFullYear() + 1)
  return Math.round((next.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY)
}

export async function buildActionQueue(now: Date = new Date()): Promise<ActionCard[]> {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + DAY)
  const winbackCutoff = new Date(now.getTime() - WINBACK_INACTIVE_DAYS * DAY)
  const vaxThreshold = new Date(now.getTime() + VACCINATION_ALERT_DAYS * DAY)
  const expiryThreshold = new Date(now.getTime() + MEMBERSHIP_EXPIRY_ALERT_DAYS * DAY)
  const logWindow = new Date(now.getTime() - (ACTION_DISMISS_WINDOW_DAYS + 15) * DAY)
  const yearAgo = new Date(now.getTime() - 365 * DAY)

  const [
    unpaid,
    todayAppts,
    checkoutsToday,
    customers,
    cats,
    expiringMemberships,
    logs,
  ] = await Promise.all([
    db.appointment.findMany({
      where: { status: 'Completed', paid: false, price: { not: null } },
      include: { customer: true, cat: true },
      orderBy: { scheduledAt: 'desc' },
      take: 25,
    }),
    db.appointment.findMany({
      where: { scheduledAt: { gte: todayStart, lt: todayEnd }, status: { not: 'Cancelled' } },
      include: {
        customer: { include: { memberships: { where: { status: 'Active' }, include: { tier: true } } } },
        cat: true,
      },
    }),
    db.appointment.findMany({
      where: { type: 'Boarding', endsAt: { gte: todayStart, lt: todayEnd }, status: { not: 'Cancelled' } },
      include: { customer: true, cat: true },
    }),
    db.customer.findMany({
      include: {
        appointments: { select: { scheduledAt: true }, orderBy: { scheduledAt: 'desc' } },
        transactions: { where: { date: { gte: yearAgo } }, select: { date: true, total: true } },
        memberships: { where: { status: 'Active' }, include: { tier: true } },
        cats: { select: { name: true } },
      },
    }),
    db.cat.findMany({
      include: { customer: true, appointments: { select: { scheduledAt: true, status: true, type: true } } },
    }),
    db.membership.findMany({
      where: { status: 'Active', expiryDate: { lte: expiryThreshold } },
      include: { customer: true, tier: true },
    }),
    db.actionLog.findMany({ where: { createdAt: { gte: logWindow } }, orderBy: { createdAt: 'desc' } }),
  ])

  // Hidden keys: Done/Dismissed within window, or snoozed into the future
  const hidden = new Set<string>()
  const dismissCutoff = new Date(now.getTime() - ACTION_DISMISS_WINDOW_DAYS * DAY)
  for (const log of logs) {
    if (hidden.has(log.actionKey)) continue
    if (log.status === 'Snoozed' && log.snoozeUntil && log.snoozeUntil > now) hidden.add(log.actionKey)
    if ((log.status === 'Done' || log.status === 'Dismissed') && log.createdAt >= dismissCutoff) hidden.add(log.actionKey)
  }

  const out: ActionCard[] = []

  // 1 · Outstanding payments
  for (const a of unpaid) {
    out.push(card({
      key: `OutstandingPayment:${a.id}`, type: 'OutstandingPayment', priority: 1,
      title: `Collect RM ${a.price!.toFixed(2)} — ${a.customer.name ?? a.customer.phone}`,
      reason: `${a.type} for ${a.cat.name} on ${a.scheduledAt.toLocaleDateString('en-MY')} is unpaid`,
      customerId: a.customerId, catId: a.catId, phone: a.customer.phone, amountRM: a.price!,
      waMessage: `Hi! Gentle reminder — ${a.cat.name}'s ${a.type.toLowerCase()} on ${a.scheduledAt.toLocaleDateString('en-MY')} (RM ${a.price!.toFixed(2)}) is still pending payment. Thank you! 🐾`,
      href: `/appointments/${a.id}`,
    }))
  }

  // 2 · VIP arriving today
  for (const a of todayAppts) {
    const vip = a.customer.memberships.find(m => VIP_TIERS.includes(m.tier.name))
    if (!vip) continue
    out.push(card({
      key: `VipArrival:${a.id}`, type: 'VipArrival', priority: 2,
      title: `VIP arriving ${a.scheduledAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })} — ${a.customer.name ?? a.customer.phone}`,
      reason: `${vip.tier.name} member · ${a.type} for ${a.cat.name}. Prep the premium check-in.`,
      customerId: a.customerId, catId: a.catId,
      href: `/customers/${a.customerId}`,
    }))
  }

  // 3 · Boarding checkout today with no future booking
  const futureByCustomer = new Set(
    (await db.appointment.findMany({
      where: { scheduledAt: { gt: todayEnd }, status: { in: ['Scheduled', 'CheckedIn'] } },
      select: { customerId: true },
    })).map(a => a.customerId),
  )
  for (const a of checkoutsToday) {
    if (futureByCustomer.has(a.customerId)) continue
    out.push(card({
      key: `RebookCheckout:${a.id}`, type: 'RebookCheckout', priority: 3,
      title: `Rebook before checkout — ${a.cat.name}`,
      reason: `${a.customer.name ?? a.customer.phone} checks out today with no next booking`,
      customerId: a.customerId, catId: a.catId, phone: a.customer.phone,
      waMessage: `Hi! ${a.cat.name} checks out today — we'd love to see you again soon. Shall we lock in the next grooming or boarding date before you head off? 🐾`,
    }))
  }

  // 4 · Win-back (inactive 90+ days, no future booking)
  for (const c of customers) {
    const last = c.appointments[0]?.scheduledAt
    if (!last || last > winbackCutoff) continue
    if (c.appointments.some(a => a.scheduledAt > now)) continue
    const catName = c.cats[0]?.name ?? 'your cat'
    const days = Math.floor((now.getTime() - last.getTime()) / DAY)
    out.push(card({
      key: `WinBack:${c.id}`, type: 'WinBack', priority: 4,
      title: `Win back ${c.name ?? c.phone}`,
      reason: `Last visit ${days} days ago`,
      customerId: c.id, phone: c.phone,
      waMessage: `Hi! It's been a while — ${catName} misses us at Cat Day 🐾 We'd love to welcome you back. Book this week and we'll add a complimentary add-on for ${catName}!`,
    }))
  }

  // 5 · Membership expiring
  for (const m of expiringMemberships) {
    out.push(card({
      key: `MembershipExpiry:${m.id}`, type: 'MembershipExpiry', priority: 5,
      title: `Renew ${m.tier.name} — ${m.customer.name ?? m.customer.phone}`,
      reason: `Expires ${m.expiryDate.toLocaleDateString('en-MY')}`,
      customerId: m.customerId, phone: m.customer.phone,
      waMessage: `Hi! Your ${m.tier.name} membership expires on ${m.expiryDate.toLocaleDateString('en-MY')}. Renew now to keep your member benefits running without a gap 🐾`,
      href: `/memberships/${m.id}`,
    }))
  }

  // 6 · Vaccination expiring
  for (const c of cats) {
    if (!c.vaccinationExpiry || c.vaccinationExpiry > vaxThreshold) continue
    out.push(card({
      key: `VaccinationExpiry:${c.id}`, type: 'VaccinationExpiry', priority: 6,
      title: `Vaccination due — ${c.name}`,
      reason: `Expires ${c.vaccinationExpiry.toLocaleDateString('en-MY')} (${c.customer.name ?? c.customer.phone})`,
      customerId: c.customerId, catId: c.id, phone: c.customer.phone,
      waMessage: `Hi! ${c.name}'s vaccination expires on ${c.vaccinationExpiry.toLocaleDateString('en-MY')}. A quick top-up keeps boarding and grooming stress-free — want us to help schedule it?`,
    }))
  }

  // 7 · Grooming due / overdue
  for (const r of buildGroomingPredictions(cats)) {
    out.push(card({
      key: `GroomingDue:${r.catId}`, type: 'GroomingDue', priority: 7,
      title: `${r.isOverdue ? 'Overdue grooming' : 'Grooming due'} — ${r.catName}`,
      reason: r.isOverdue ? `Overdue by ${Math.abs(r.daysUntilDue)} days` : `Due in ${r.daysUntilDue} days`,
      customerId: r.customerId, catId: r.catId, phone: r.customerPhone,
      waMessage: `Hi! ${r.catName} is due for grooming — shall we book a session this week? 🐾`,
    }))
  }

  // 8 · Birthday within a week
  for (const c of cats) {
    if (!c.dateOfBirth) continue
    const d = daysToBirthday(c.dateOfBirth, now)
    if (d > BIRTHDAY_LOOKAHEAD_DAYS) continue
    out.push(card({
      key: `Birthday:${c.id}:${now.getFullYear()}`, type: 'Birthday', priority: 8,
      title: d === 0 ? `🎂 ${c.name}'s birthday is today!` : `🎂 ${c.name}'s birthday in ${d} day${d === 1 ? '' : 's'}`,
      reason: `${c.customer.name ?? c.customer.phone} — send the birthday reward`,
      customerId: c.customerId, catId: c.id, phone: c.customer.phone,
      waMessage: `Happy birthday to ${c.name}! 🎂🐾 As a Cat Day member, ${c.name} gets a birthday treat on us — come celebrate with a pamper session this month!`,
    }))
  }

  // 9 · Gold-eligible
  for (const c of customers) {
    const hasVip = c.memberships.some(m => VIP_TIERS.includes(m.tier.name))
    if (hasVip) continue
    const spend = trailingAnnualSpend(c.transactions, now)
    if (spend < GOLD_SPEND_THRESHOLD) continue
    out.push(card({
      key: `GoldEligible:${c.id}`, type: 'GoldEligible', priority: 9,
      title: `Gold-eligible — ${c.name ?? c.phone}`,
      reason: `RM ${spend.toFixed(0)} spent in 12 months (threshold RM ${GOLD_SPEND_THRESHOLD})`,
      customerId: c.id,
      href: `/memberships/new`,
    }))
  }

  return out
    .filter(a => !hidden.has(a.key))
    .sort((a, b) => a.priority - b.priority)
}
