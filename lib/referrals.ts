import { db } from './db'
import { getConfig } from './config'

// ── M5 · Referral engine ─────────────────────────────────────────────────────
// Word of mouth already drives this business; nothing measured it.
//
// Credit is paid into the existing Cat Day Wallet, which means data-integrity
// rule 2 applies without exception: the ledger entry and the cached balance move
// together inside one db.$transaction. Never increment walletBalance alone —
// that loses the audit trail and makes reversal impossible.
//
// Credit is deliberately NOT awarded from POS checkout. Rule 3 requires
// everything a checkout creates to be reversible by deleting the sale, and
// wiring this in would mean unpicking two customers' ledgers on every
// correction. A manager confirms it instead, once the first visit is genuinely
// complete.

const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY349' // no O/0, I/1, S/5, B/8 — these get read aloud
const CODE_LEN = 6

function randomCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/** Stable per customer: generated once, then reused forever. */
export async function referralCodeFor(customerId: string): Promise<string> {
  const existing = await db.customer.findUnique({
    where: { id: customerId }, select: { referralCode: true },
  })
  if (existing?.referralCode) return existing.referralCode

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const clash = await db.customer.findUnique({ where: { referralCode: code }, select: { id: true } })
    if (clash) continue
    await db.customer.update({ where: { id: customerId }, data: { referralCode: code } })
    return code
  }
  throw new Error('could-not-allocate-referral-code')
}

export async function findByCode(code: string) {
  return db.customer.findUnique({
    where: { referralCode: code.trim().toUpperCase() },
    select: { id: true, name: true, phone: true },
  })
}

/**
 * Record that one customer brought in another. Guards against the three ways
 * this goes wrong: referring yourself, being referred twice, and a circular pair
 * crediting each other.
 */
export async function linkReferral(referrerId: string, referredId: string):
  Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (referrerId === referredId) return { ok: false, error: 'self-referral' }

  const existing = await db.referral.findUnique({ where: { referredId }, select: { id: true } })
  if (existing) return { ok: false, error: 'already-referred' }

  const reverse = await db.referral.findUnique({ where: { referredId: referrerId }, select: { referrerId: true } })
  if (reverse?.referrerId === referredId) return { ok: false, error: 'circular-referral' }

  const created = await db.referral.create({ data: { referrerId, referredId } })
  await db.customer.update({ where: { id: referredId }, data: { referredById: referrerId } })
  return { ok: true, id: created.id }
}

export interface PendingReferral {
  id: string
  referrerName: string
  referredName: string
  referredId: string
  /** A referral only becomes payable once the new customer has actually shown up. */
  firstVisitAt: Date | null
  eligible: boolean
}

export async function pendingReferrals(now: Date = new Date()): Promise<PendingReferral[]> {
  const rows = await db.referral.findMany({
    where: { status: 'Pending' },
    select: {
      id: true, referredId: true,
      referrer: { select: { name: true, phone: true } },
      referred: {
        select: {
          name: true, phone: true,
          appointments: {
            where: { status: 'Completed' },
            select: { scheduledAt: true },
            orderBy: { scheduledAt: 'asc' },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return rows.map(r => {
    const first = r.referred.appointments[0]?.scheduledAt ?? null
    return {
      id: r.id,
      referrerName: r.referrer.name ?? r.referrer.phone,
      referredName: r.referred.name ?? r.referred.phone,
      referredId: r.referredId,
      firstVisitAt: first,
      eligible: !!first && first <= now,
    }
  })
}

/**
 * Pay both sides. Ledger entries and both cached balances move in a single
 * transaction with the referral's own status — a partial write here would leave
 * money credited with no record of why, or a referral marked paid that never was.
 */
export async function creditReferral(referralId: string, now: Date = new Date()):
  Promise<{ ok: true; referrerRM: number; referredRM: number } | { ok: false; error: string }> {
  const referral = await db.referral.findUnique({
    where: { id: referralId },
    select: {
      id: true, status: true, referrerId: true, referredId: true,
      referred: {
        select: {
          appointments: { where: { status: 'Completed' }, select: { id: true }, take: 1 },
        },
      },
    },
  })
  if (!referral) return { ok: false, error: 'not-found' }
  if (referral.status !== 'Pending') return { ok: false, error: 'already-settled' }
  if (referral.referred.appointments.length === 0) return { ok: false, error: 'no-completed-visit' }

  const { marketing } = await getConfig()
  const referrerRM = Math.round(marketing.referrerCreditRM * 100) / 100
  const referredRM = Math.round(marketing.referredCreditRM * 100) / 100
  if (referrerRM <= 0 && referredRM <= 0) return { ok: false, error: 'credit-not-configured' }

  await db.$transaction([
    ...(referrerRM > 0 ? [
      db.walletEntry.create({
        data: { customerId: referral.referrerId, amount: referrerRM, kind: 'Bonus', note: 'Referral reward' },
      }),
      db.customer.update({
        where: { id: referral.referrerId }, data: { walletBalance: { increment: referrerRM } },
      }),
    ] : []),
    ...(referredRM > 0 ? [
      db.walletEntry.create({
        data: { customerId: referral.referredId, amount: referredRM, kind: 'Bonus', note: 'Referral welcome credit' },
      }),
      db.customer.update({
        where: { id: referral.referredId }, data: { walletBalance: { increment: referredRM } },
      }),
    ] : []),
    db.referral.update({
      where: { id: referral.id },
      data: { status: 'Credited', creditedAt: now, referrerCreditRM: referrerRM, referredCreditRM: referredRM },
    }),
  ])

  return { ok: true, referrerRM, referredRM }
}

export interface ReferralStats {
  pending: number
  credited: number
  creditedRM: number
  /** Lifetime spend of everyone who arrived through a referral. */
  referredRevenueRM: number
}

export async function referralStats(): Promise<ReferralStats> {
  const [pending, credited, referredCustomers] = await Promise.all([
    db.referral.count({ where: { status: 'Pending' } }),
    db.referral.findMany({
      where: { status: 'Credited' },
      select: { referrerCreditRM: true, referredCreditRM: true, referredId: true },
    }),
    db.customer.findMany({
      where: { referredById: { not: null } },
      select: { transactions: { select: { total: true } } },
    }),
  ])

  const creditedRM = credited.reduce((s, r) => s + r.referrerCreditRM + r.referredCreditRM, 0)
  const referredRevenueRM = referredCustomers.reduce(
    (s, c) => s + c.transactions.reduce((t, x) => t + x.total, 0), 0)

  return {
    pending,
    credited: credited.length,
    creditedRM: Math.round(creditedRM * 100) / 100,
    referredRevenueRM: Math.round(referredRevenueRM * 100) / 100,
  }
}
