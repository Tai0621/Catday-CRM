import { db } from './db'
import { getConfig } from './config'
import { buildGroomingPredictions } from './grooming-reminder'
import { lowStockProducts } from './inventory'
import { logRedFlags } from './care-log'
import { dewormStatus, defleaStatus } from './health'
import { trailingAnnualSpend } from './loyalty'
import { ACTION_SEGMENT, type SegmentKey } from './segments'
import { buildActionStats, priorityShifts, effectivePriority, isSuppressed, type TypeStats } from './actions-learning'
import { loadActiveVariants, messageFor } from './action-variants'
import { loadAcademy, unconverted } from './academy'
import {
  type ActionType,
  WINBACK_INACTIVE_DAYS,
  BIRTHDAY_LOOKAHEAD_DAYS,
  ACTION_DISMISS_WINDOW_DAYS,
  VACCINATION_ALERT_DAYS,
  MEMBERSHIP_EXPIRY_ALERT_DAYS,
  GOLD_SPEND_THRESHOLD,
  PRIVATE_CLUB_TIER,
  PRIVATE_CLUB_SPEND,
  PRIVATE_CLUB_VISITS,
} from './constants'

const DAY = 24 * 60 * 60 * 1000
const VIP_TIERS = ['Gold', 'Black Circle']

export interface ActionCard {
  key: string
  type: ActionType
  segment: SegmentKey // business area — drives colour coding in the UI
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
  variant?: string   // C4 · which copy arm this card is showing, recorded on the outcome
}

function band(priority: number): ActionCard['band'] {
  if (priority <= 3) return 'Do now'
  if (priority <= 6) return 'This week'
  return 'Opportunities'
}

function card(c: Omit<ActionCard, 'band' | 'segment'>): ActionCard {
  return { ...c, band: band(c.priority), segment: ACTION_SEGMENT[c.type] }
}

/** Days until the next occurrence of a birthday (0 = today). */
function daysToBirthday(dob: Date, now: Date): number {
  const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate())
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(next.getFullYear() + 1)
  return Math.round((next.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY)
}

export interface ActionInbox {
  queue: ActionCard[]
  stats: Map<ActionType, TypeStats>
  /** Types held back this run because staff consistently ignore them — shown, not hidden silently. */
  suppressed: { type: ActionType; held: number }[]
}

export async function buildActionInbox(now: Date = new Date()): Promise<ActionInbox> {
  const { business } = await getConfig()
  const brand = business.name
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + DAY)
  const winbackCutoff = new Date(now.getTime() - WINBACK_INACTIVE_DAYS * DAY)
  const vaxThreshold = new Date(now.getTime() + VACCINATION_ALERT_DAYS * DAY)
  const expiryThreshold = new Date(now.getTime() + MEMBERSHIP_EXPIRY_ALERT_DAYS * DAY)
  const logWindow = new Date(now.getTime() - (ACTION_DISMISS_WINDOW_DAYS + 15) * DAY)
  const yearAgo = new Date(now.getTime() - 365 * DAY)
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const [
    unpaid,
    todayAppts,
    checkoutsToday,
    customers,
    cats,
    expiringMemberships,
    logs,
    lifetimeSpendGroups,
    futureAppts,
    licenses,
    careLogs,
    academy,
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
      // select keeps base64 photo blobs out of this whole-table scan
      select: {
        id: true, name: true, breed: true, coatType: true, groomingInterval: true,
        dateOfBirth: true, vaccinationExpiry: true, lastDewormAt: true, lastDefleaAt: true,
        foundingNumber: true, customerId: true,
        customer: { select: { id: true, name: true, phone: true } },
        appointments: { select: { scheduledAt: true, status: true, type: true } },
      },
    }),
    db.membership.findMany({
      where: { status: 'Active', expiryDate: { lte: expiryThreshold } },
      include: { customer: true, tier: true },
    }),
    db.actionLog.findMany({ where: { createdAt: { gte: logWindow } }, orderBy: { createdAt: 'desc' } }),
    db.transaction.groupBy({ by: ['customerId'], _sum: { total: true } }),
    db.appointment.findMany({
      where: { scheduledAt: { gt: todayEnd }, status: { in: ['Scheduled', 'CheckedIn'] } },
      select: { customerId: true },
    }),
    db.license.findMany({ where: { archived: false } }),
    db.dailyCareLog.findMany({
      where: { date: todayStr },
      include: { appointment: { select: { status: true, customerId: true, customer: { select: { name: true, phone: true } }, cat: { select: { name: true } } } } },
    }),
    loadAcademy(now),
  ])
  const academyAttendees = academy.attendees

  // C4 · copy under test. Empty for any type with no variants, in which case the
  // generators below keep their built-in template.
  const variants = await loadActiveVariants()

  const lifetimeSpend = new Map<string, number>()
  for (const g of lifetimeSpendGroups) {
    if (g.customerId) lifetimeSpend.set(g.customerId, g._sum.total ?? 0)
  }
  // Households with a Founding Cat get the same white-glove treatment as Private Club
  const foundingCustomerIds = new Set(cats.filter(c => c.foundingNumber != null).map(c => c.customerId))

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

  // 1b · Boarding health concern — a red flag in today's structured care log
  // (SOP S004 immediate-action). One card per cat, with an owner-notification
  // WhatsApp for the manager to approve.
  const concernByCat = new Map<string, { flags: Set<string>; catName: string; customerId: string; phone: string }>()
  for (const l of careLogs) {
    if (l.appointment.status !== 'CheckedIn') continue
    const flags = logRedFlags(l)
    if (flags.length === 0) continue
    const e = concernByCat.get(l.catId) ?? { flags: new Set<string>(), catName: l.appointment.cat.name, customerId: l.appointment.customerId, phone: l.appointment.customer.phone }
    flags.forEach(f => e.flags.add(f))
    concernByCat.set(l.catId, e)
  }
  for (const [catId, e] of concernByCat) {
    const list = [...e.flags]
    out.push(card({
      key: `HealthConcern:${catId}:${todayStr}`, type: 'HealthConcern', priority: 1,
      title: `Health flag — ${e.catName}`,
      reason: `Today's log: ${list.join(', ')} · check on the cat and update the owner`,
      customerId: e.customerId, catId, phone: e.phone,
      waMessage: `Hi! A quick update on ${e.catName} 🐾 We noticed ${list.join(' and ').toLowerCase()} today and are keeping a close eye — we'll let you know if anything changes, and will involve a vet if needed. Please reach out with any questions.`,
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
  const futureByCustomer = new Set(futureAppts.map(a => a.customerId))
  for (const a of checkoutsToday) {
    if (futureByCustomer.has(a.customerId)) continue
    const msg = messageFor(variants, 'RebookCheckout', a.customerId, { cat: a.cat.name, brand, customer: a.customer.name ?? '' },
      `Hi! ${a.cat.name} checks out today — we'd love to see you again soon. Shall we lock in the next grooming or boarding date before you head off? 🐾`)
    out.push(card({
      key: `RebookCheckout:${a.id}`, type: 'RebookCheckout', priority: 3,
      title: `Rebook before checkout — ${a.cat.name}`,
      reason: `${a.customer.name ?? a.customer.phone} checks out today with no next booking`,
      customerId: a.customerId, catId: a.catId, phone: a.customer.phone,
      waMessage: msg.text, variant: msg.variant,
    }))
  }

  // 4 · Win-back (inactive 90+ days, no future booking)
  // Owner rule: Private Club / Founding Cat households never get automated blasts —
  // they get the personal monthly check-in (rule below) instead.
  for (const c of customers) {
    const isWhiteGlove = foundingCustomerIds.has(c.id) ||
      c.memberships.some(m => m.tier.name === PRIVATE_CLUB_TIER)
    if (isWhiteGlove) continue
    const last = c.appointments[0]?.scheduledAt
    if (!last || last > winbackCutoff) continue
    if (c.appointments.some(a => a.scheduledAt > now)) continue
    const catName = c.cats[0]?.name ?? 'your cat'
    const days = Math.floor((now.getTime() - last.getTime()) / DAY)
    const msg = messageFor(variants, 'WinBack', c.id, { cat: catName, brand, customer: c.name ?? '', days },
      `Hi! It's been a while — ${catName} misses us at ${brand} 🐾 We'd love to welcome you back. Book this week and we'll add a complimentary add-on for ${catName}!`)
    out.push(card({
      key: `WinBack:${c.id}`, type: 'WinBack', priority: 4,
      title: `Win back ${c.name ?? c.phone}`,
      reason: `Last visit ${days} days ago`,
      customerId: c.id, phone: c.phone,
      waMessage: msg.text, variant: msg.variant,
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

  // 5a · M7 · Academy attendees who never came back for a groom.
  //
  // A workshop is lead generation, so the follow-up IS the product. Deliberately
  // no earlier than ACADEMY_FOLLOWUP_AFTER_DAYS — chasing the day after a class
  // is pestering; chasing a fortnight later, while they still remember enjoying
  // it, is the entire reason to run one.
  for (const a of unconverted(academyAttendees)) {
    if (!a.phone) continue
    out.push(card({
      key: `AcademyFollowUp:${a.id}`, type: 'AcademyFollowUp', priority: 6,
      title: `Academy follow-up — ${a.studentName}`,
      reason: `${a.course} ${a.daysSinceEnrolment} days ago · never booked a groom`,
      customerId: a.customerId ?? undefined,
      phone: a.phone,
      waMessage: `Hi ${a.studentName}! Lovely having you at our ${a.course} session 🐾 If you'd like us to take care of the next groom ourselves, we'd be glad to — shall we find you a time?`,
      href: '/academy',
    }))
  }

  // 5b · Monthly personal check-in for Private Club / Founding Cat households.
  // Marking it Done hides it for 30 days, which naturally produces the monthly cadence.
  for (const c of customers) {
    const isWhiteGlove = foundingCustomerIds.has(c.id) ||
      c.memberships.some(m => m.tier.name === PRIVATE_CLUB_TIER)
    if (!isWhiteGlove) continue
    const catName = c.cats[0]?.name ?? 'your cat'
    out.push(card({
      key: `VipCheckIn:${c.id}`, type: 'VipCheckIn', priority: 5,
      title: `Personal check-in — ${c.name ?? c.phone}`,
      reason: 'Private Club / Founding Cat family · monthly one-to-one, never auto-blast',
      customerId: c.id, phone: c.phone,
      waMessage: `Hi ${c.name ?? ''}! A personal hello from ${brand} — how has ${catName} been doing? If there's anything we can prepare for your next visit, just let us know 🐾`,
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

  // 6b · Licence / permit renewal due (internal compliance task — no customer,
  // no WhatsApp). Surfaces reminderDays ahead of the renewal date; urgency rises
  // the closer (or more overdue) it is. Keyed by renewal date so each new cycle
  // produces a fresh card even after a past one was dismissed.
  for (const l of licenses) {
    const daysLeft = Math.floor((l.renewalDate.getTime() - todayStart.getTime()) / DAY)
    if (daysLeft > l.reminderDays) continue
    const overdue = daysLeft < 0
    out.push(card({
      key: `LicenseRenewal:${l.id}:${l.renewalDate.toISOString().slice(0, 10)}`, type: 'LicenseRenewal',
      priority: overdue || daysLeft <= 14 ? 3 : 6,
      title: `${overdue ? 'Overdue renewal' : 'Renew'} — ${l.name}`,
      reason: overdue
        ? `${l.category} · expired ${l.renewalDate.toLocaleDateString('en-MY')} (${Math.abs(daysLeft)} days ago)`
        : `${l.category} · due ${l.renewalDate.toLocaleDateString('en-MY')} (in ${daysLeft} day${daysLeft === 1 ? '' : 's'})`,
      href: '/admin/licenses',
    }))
  }

  // 6b · Pending leave requests — one manager card each, linking to the leave
  // screen to approve or reject. Disappears once actioned (no longer Pending).
  const pendingLeave = await db.leaveRequest.findMany({
    where: { status: 'Pending' }, include: { staff: { select: { name: true } } }, orderBy: { createdAt: 'asc' },
  })
  for (const lr of pendingLeave) {
    out.push(card({
      key: `LeaveApproval:${lr.id}`, type: 'LeaveApproval', priority: 4,
      title: `Leave request — ${lr.staff.name}`,
      reason: `${lr.type} · ${lr.startDate}${lr.endDate !== lr.startDate ? ` → ${lr.endDate}` : ''} (${lr.days} day${lr.days === 1 ? '' : 's'})${lr.reason ? ` · ${lr.reason}` : ''}`,
      href: '/hr/leave',
    }))
  }

  // 6b2 · New job applications — one aggregate manager card into the pipeline.
  const newApps = await db.jobApplication.count({ where: { status: 'New' } })
  if (newApps > 0) {
    out.push(card({
      key: 'ApplicationReview:new', type: 'ApplicationReview', priority: 4,
      title: `${newApps} new job application${newApps === 1 ? '' : 's'}`,
      reason: 'Review candidates and move them through the hiring pipeline',
      href: '/hr/applications',
    }))
  }

  // 6b3 · Low stock — one card per product at/below its reorder level.
  const lowStock = await lowStockProducts()
  for (const p of lowStock) {
    out.push(card({
      key: `LowStock:${p.id}`, type: 'LowStock', priority: 4,
      title: `Reorder — ${p.name}`,
      reason: `${p.stockQty} left (reorder at ${p.reorderLevel})`,
      href: `/products/${p.id}`,
    }))
  }

  // 6c · Deworm / deflea due (monthly parasite control, boarding SOP). One card
  // per cat covering whichever is due; monthly-scoped key so it re-fires each
  // cycle. Owner-facing — required before the next boarding stay.
  const treatmentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  for (const c of cats) {
    const dw = dewormStatus(c.lastDewormAt, now)
    const df = defleaStatus(c.lastDefleaAt, now)
    const due: string[] = []
    if (dw.state === 'due' || dw.state === 'overdue') due.push('deworming')
    if (df.state === 'due' || df.state === 'overdue') due.push('flea treatment')
    if (due.length === 0) continue
    out.push(card({
      key: `TreatmentDue:${c.id}:${treatmentMonth}`, type: 'TreatmentDue', priority: 6,
      title: `${due.map(d => d[0].toUpperCase() + d.slice(1)).join(' & ')} due — ${c.name}`,
      reason: `Monthly parasite control · ${c.customer.name ?? c.customer.phone} · required before boarding`,
      customerId: c.customerId, catId: c.id, phone: c.customer.phone,
      waMessage: `Hi! ${c.name} is due for ${due.join(' and ')} 🐾 It's a monthly must for a healthy kitty (and required before boarding). Want us to help arrange it?`,
    }))
  }

  // 7 · Grooming due / overdue
  for (const r of buildGroomingPredictions(cats)) {
    const msg = messageFor(variants, 'GroomingDue', r.customerId, { cat: r.catName, brand, days: Math.abs(r.daysUntilDue) },
      `Hi! ${r.catName} is due for grooming — shall we book a session this week? 🐾`)
    out.push(card({
      key: `GroomingDue:${r.catId}`, type: 'GroomingDue', priority: 7,
      title: `${r.isOverdue ? 'Overdue grooming' : 'Grooming due'} — ${r.catName}`,
      reason: r.isOverdue ? `Overdue by ${Math.abs(r.daysUntilDue)} days` : `Due in ${r.daysUntilDue} days`,
      customerId: r.customerId, catId: r.catId, phone: r.customerPhone,
      waMessage: msg.text, variant: msg.variant,
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
      waMessage: `Happy birthday to ${c.name}! 🎂🐾 As a ${brand} member, ${c.name} gets a birthday treat on us — come celebrate with a pamper session this month!`,
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

  // 9b · Private Club eligible (RM1000 lifetime spend OR 3+ visits, not yet in the club)
  for (const c of customers) {
    if (c.memberships.some(m => m.tier.name === PRIVATE_CLUB_TIER)) continue
    const spend = lifetimeSpend.get(c.id) ?? 0
    const visits = c.appointments.filter(a => a.scheduledAt <= now).length
    if (spend < PRIVATE_CLUB_SPEND && visits < PRIVATE_CLUB_VISITS) continue
    out.push(card({
      key: `PrivateClubEligible:${c.id}`, type: 'PrivateClubEligible', priority: 9,
      title: `Private Club invite — ${c.name ?? c.phone}`,
      reason: spend >= PRIVATE_CLUB_SPEND
        ? `RM ${spend.toFixed(0)} lifetime spend (threshold RM ${PRIVATE_CLUB_SPEND})`
        : `${visits} visits (threshold ${PRIVATE_CLUB_VISITS})`,
      customerId: c.id,
      href: `/memberships/new`,
    }))
  }

  // C3 · rank on evidence. The static priority above stays the anchor; observed
  // acceptance and conversion move a type by at most ACTION_LEARNING_MAX_SHIFT
  // around it, and the band is recomputed so a proven performer can climb.
  const stats = await buildActionStats(now)
  const shifts = priorityShifts(stats)

  const live = out.filter(a => !hidden.has(a.key))
  const held = new Map<ActionType, number>()
  const queue: ActionCard[] = []
  for (const a of live) {
    if (isSuppressed(stats.get(a.type), a.priority)) {
      held.set(a.type, (held.get(a.type) ?? 0) + 1)
      continue
    }
    const priority = effectivePriority(a.priority, shifts.get(a.type) ?? 0)
    queue.push({ ...a, priority, band: band(priority) })
  }
  queue.sort((a, b) => a.priority - b.priority)

  return {
    queue,
    stats,
    suppressed: [...held].map(([type, n]) => ({ type, held: n })),
  }
}

export async function buildActionQueue(now: Date = new Date()): Promise<ActionCard[]> {
  return (await buildActionInbox(now)).queue
}
