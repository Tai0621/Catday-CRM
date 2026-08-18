import { db } from './db'
import {
  MIN_SALE_AGE_DAYS, KITTEN_MAX_AGE_DAYS, SENIOR_MIN_AGE_DAYS,
  RESIDENCY_TYPE, type LifeStage,
} from './constants'

// Cat inventory — the business's own cats, as stock.
//
// The animal stays in `Cat`; a `CatStock` row is what makes one of them stock.
// That absence-means-not-inventory shape is load-bearing: it means selling a cat
// moves ownership and closes the stock row, and the buyer inherits the animal's
// whole history rather than a fresh, empty file.
//
// Everything customer-facing must exclude these. See NOT_HOUSE below — never
// hand-write `isHouse: false` into a query, because the one place it gets
// forgotten is the place that composes a WhatsApp message to a customer who does
// not exist.

const DAY = 24 * 60 * 60 * 1000

// ── the house customer ───────────────────────────────────────────────────────

export const HOUSE_CUSTOMER_NAME = 'House — owned cats'
/**
 * A real phone column with a UNIQUE constraint, so the holding record needs a
 * value no human will ever dial. Not a blank: two blanks would collide.
 */
export const HOUSE_CUSTOMER_PHONE = 'HOUSE-OWNED-CATS'

/** Reuse in every customer-facing query. One spelling, one place to fix. */
export const NOT_HOUSE = { isHouse: false } as const
/** The same exclusion, one level down — for queries that start from Cat. */
export const CAT_NOT_HOUSE = { customer: { isHouse: false } } as const
/**
 * A customer who is a real, contactable person: not erased, not the house.
 *
 * The codebase already carried `{ erasedAt: null }` in a dozen places as
 * "someone the OS may still talk about". The house record fails the same test
 * for a different reason, so it belongs in the same predicate rather than in a
 * second one that has to be remembered separately.
 */
export const LIVE_CUSTOMER = { erasedAt: null, isHouse: false } as const

/**
 * The single holding record every owned cat hangs off.
 *
 * `Cat.customerId` is NOT NULL and SQLite cannot drop that without rebuilding a
 * live table, so owned cats point at this row instead. Created on demand so a
 * fresh deployment needs no seed step.
 */
export async function houseCustomer(): Promise<{ id: string }> {
  const found = await db.customer.findFirst({ where: { isHouse: true }, select: { id: true } })
  if (found) return found
  return db.customer.create({
    data: {
      phone: HOUSE_CUSTOMER_PHONE,
      name: HOUSE_CUSTOMER_NAME,
      isHouse: true,
      // Marketing consent stays false and must never be set: there is nobody to
      // consent. A campaign that picked this row up would send to a dead number
      // and count it as reach.
      marketingConsent: false,
    },
    select: { id: true },
  })
}

// ── breeds & SKUs ────────────────────────────────────────────────────────────

/**
 * Canonical breeds and their SKU codes, taken from the owner's own numbering.
 *
 * Free-text breed is why the workbook holds "Golden Bristish" (13 cats) and
 * "Golden British" (8) as different breeds — 21 cats of one breed that no report
 * will ever group. ALIASES maps every spelling seen in the real data onto the
 * canonical name so the import lands them together.
 */
export const BREED_CODES: Record<string, string> = {
  'British Shorthair': 'BSH',
  'British Longhair': 'BLH',
  'Devon Rex': 'DRX',
  'Munchkin': 'MNS',
  'Minuet': 'MNL',
  'Exotic Shorthair': 'EXO',
  'Persian': 'PER',
  'Selkirk Rex': 'SRL',
  'Ragdoll': 'RAG',
  'American Shorthair': 'AME',
  'Maine Coon': 'MCO',
  'Scottish Fold': 'SFD',
  'Domestic': 'HHP',
}
export const CAT_BREEDS = Object.keys(BREED_CODES)

const ALIASES: Record<string, string> = {
  'golden bristish': 'British Shorthair',
  'golden british': 'British Shorthair',
  'british': 'British Shorthair',
  'british short hair': 'British Shorthair',
  'british shorthair': 'British Shorthair',
  'british long hair': 'British Longhair',
  'british longhair': 'British Longhair',
  'muchkin': 'Munchkin',
  'munchkin': 'Munchkin',
  'minuet': 'Minuet',
  'devon rex': 'Devon Rex',
  'exotic short hair': 'Exotic Shorthair',
  'exotic shorthair': 'Exotic Shorthair',
  'sellkirk rex': 'Selkirk Rex',
  'selkirk rex': 'Selkirk Rex',
  'persian': 'Persian',
  'ragdoll': 'Ragdoll',
  'american short hair': 'American Shorthair',
  'american shorthair': 'American Shorthair',
  'domestic long hair': 'Domestic',
  'domestic short hair': 'Domestic',
  'domestic': 'Domestic',
}

/** Best canonical name for a free-text breed; null when it is not recognised. */
export function canonicalBreed(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return ALIASES[key] ?? (CAT_BREEDS.includes(raw.trim()) ? raw.trim() : null)
}

export function breedCode(breed: string | null | undefined): string {
  const canon = canonicalBreed(breed)
  return (canon && BREED_CODES[canon]) || 'HHP'
}

/**
 * Next SKU for a breed: CD-<code>-<3 digits>.
 *
 * Reads the highest existing number for that code rather than counting rows —
 * counting would reissue a number the moment a cat was removed, and two cats
 * sharing a SKU is a records problem nobody notices until an audit.
 */
export async function nextSku(breed: string | null | undefined, prefix = 'CD'): Promise<string> {
  const code = breedCode(breed)
  const stem = `${prefix}-${code}-`
  const existing = await db.catStock.findMany({
    where: { sku: { startsWith: stem } },
    select: { sku: true },
  })
  const highest = existing.reduce((max, s) => {
    const n = parseInt(s.sku.slice(stem.length), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `${stem}${String(highest + 1).padStart(3, '0')}`
}

// ── age & sex, derived ───────────────────────────────────────────────────────

export function ageInDays(dob: Date | null, now: Date = new Date()): number | null {
  if (!dob) return null
  return Math.floor((now.getTime() - dob.getTime()) / DAY)
}

/**
 * Life stage from date of birth.
 *
 * The workbook types Adult/Kitten by hand, so it is wrong the day after a
 * kitten's birthday. Derived here instead; `Cat.lifeStage` remains only as an
 * override for a cat whose birthday nobody knows.
 */
export function lifeStageFor(dob: Date | null, fallback: string | null = null, now: Date = new Date()): LifeStage | null {
  const days = ageInDays(dob, now)
  if (days == null) return (fallback as LifeStage) ?? null
  if (days < KITTEN_MAX_AGE_DAYS) return 'Kitten'
  if (days >= SENIOR_MIN_AGE_DAYS) return 'Senior'
  return 'Adult'
}

export function ageLabel(dob: Date | null, now: Date = new Date()): string {
  const days = ageInDays(dob, now)
  if (days == null) return 'age unknown'
  if (days < 90) return `${Math.max(0, Math.floor(days / 7))} wk`
  const months = Math.floor(days / 30.44)
  if (months < 24) return `${months} mo`
  return `${Math.floor(days / 365.25)} yr`
}

/**
 * The right word for a desexed cat of this sex.
 *
 * The workbook used "Neutered" and "Spayed" as gender markers, reversed — every
 * male read "Spayed". Storing a date and deriving the word means the mistake
 * cannot recur, whatever anyone types.
 */
export function desexLabel(gender: string | null, desexedAt: Date | null): string {
  if (!desexedAt) return 'Intact'
  if (gender === 'Female') return 'Spayed'
  if (gender === 'Male') return 'Neutered'
  return 'Desexed'
}

// ── the sale-readiness gate ──────────────────────────────────────────────────

export interface CatSaleGate {
  ready: boolean
  blockers: string[]   // hard — the cat may not be sold
  warnings: string[]   // sellable, but the buyer must be told
  ageDays: number | null
}

export type SaleGateInput = {
  role: string
  status: string
  microchipNo: string | null
  cat: {
    dateOfBirth: Date | null
    vaccinationExpiry: Date | null
    lastVaccinatedAt: Date | null
    lastDewormAt: Date | null
    desexedAt: Date | null
  }
}

/**
 * May this cat be sold today?
 *
 * Shaped after boardingHealthGate() in lib/health.ts on purpose — same split
 * between a hard blocker and a thing the buyer merely has to be told, so the two
 * gates in the OS read the same way.
 */
export function saleGate(s: SaleGateInput, now: Date = new Date()): CatSaleGate {
  const ageDays = ageInDays(s.cat.dateOfBirth, now)
  const blockers: string[] = []
  const warnings: string[] = []

  if (s.role === 'Breeder') blockers.push('Working breeder')
  if (s.role === 'Resident') blockers.push('Shop cat, not for sale')
  if (s.status === 'Sold' || s.status === 'Rehomed') blockers.push('Already left')
  if (s.status === 'Deceased') blockers.push('Deceased')
  if (s.status === 'Reserved') blockers.push('Reserved for a buyer')

  // Age unknown is a blocker, not a pass. 22 of the owner's 64 rows have no
  // usable date of birth, and "we do not know how old it is" is precisely the
  // case where a kitten must not go out of the door.
  if (ageDays == null) blockers.push('Date of birth unknown')
  else if (ageDays < MIN_SALE_AGE_DAYS) blockers.push(`Under ${Math.round(MIN_SALE_AGE_DAYS / 7)} weeks (${Math.floor(ageDays / 7)} wk)`)

  if (!s.cat.lastVaccinatedAt) blockers.push('No vaccination recorded')
  else if (s.cat.vaccinationExpiry && s.cat.vaccinationExpiry < now) warnings.push('Vaccination overdue')

  if (!s.cat.lastDewormAt) warnings.push('No deworming recorded')
  if (!s.microchipNo) warnings.push('No microchip number')
  if (!s.cat.desexedAt) warnings.push('Intact — agree desexing with the buyer')

  return { ready: blockers.length === 0, blockers, warnings, ageDays }
}

// ── money ────────────────────────────────────────────────────────────────────

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * What the balance sheet may carry this cat at.
 *
 * Acquisition only. Vet, vaccination, transport and feed are expensed in the
 * month they are paid, so capitalising them here would count the same ringgit as
 * both a cost and an asset and overstate profit by the difference. A home-bred
 * kitten therefore carries at nil, which is conservative and correct.
 */
export function carryingValue(stock: { acquisitionRM: number }): number {
  return r2(stock.acquisitionRM)
}

/** Total spent on a cat — for pricing decisions, not for any statement. */
export function costToDate(stock: { acquisitionRM: number }, costs: { amountRM: number }[]): number {
  return r2(stock.acquisitionRM + costs.reduce((s, c) => s + c.amountRM, 0))
}

/**
 * Split one vet bill across cats.
 *
 * `PerCat` multiplies a rate by head count (the owner's sheet: 57 × RM45);
 * `EvenSplit` divides a total. The rounding remainder goes to the first cat, so
 * the parts always add back to the total — a split that loses two sen per cat
 * fails reconciliation against the invoice and looks like a missing payment.
 */
export function allocate(totalRM: number, count: number, method: string): number[] {
  if (count <= 0) return []
  if (method === 'PerCat') return Array(count).fill(r2(totalRM))
  const each = Math.floor((totalRM / count) * 100) / 100
  const parts = Array(count).fill(each)
  parts[0] = r2(each + (totalRM - each * count))
  return parts
}

// ── operational reads ────────────────────────────────────────────────────────

/** Appointment types that represent paid work. Excludes house residencies. */
export const REVENUE_APPT_TYPES = { type: { not: RESIDENCY_TYPE } } as const

export type StockWithCat = Awaited<ReturnType<typeof stockList>>[number]

/**
 * The inventory list. One query — the cat's fields come along via the relation
 * rather than a second pass, because every Prisma call here is a serial round
 * trip (docs/PERFORMANCE.md).
 */
export async function stockList(where: Record<string, unknown> = {}) {
  return db.catStock.findMany({
    where,
    select: {
      id: true, sku: true, role: true, status: true, askingRM: true, acquisitionRM: true,
      acquiredAt: true, microchipNo: true, reservedForId: true, reservedUntil: true,
      soldAt: true, exitAt: true,
      litterId: true, createdAt: true,
      cat: {
        select: {
          id: true, name: true, breed: true, gender: true, dateOfBirth: true,
          vaccinationExpiry: true, lastVaccinatedAt: true, lastDewormAt: true, desexedAt: true,
        },
      },
    },
    orderBy: [{ status: 'asc' }, { sku: 'asc' }],
  })
}

/** Head count and value, for the inventory overview and the balance sheet. */
export async function stockSummary() {
  const rows = await db.catStock.findMany({
    where: { status: { in: ['InStock', 'Reserved'] } },
    select: { status: true, role: true, acquisitionRM: true },
  })
  return {
    head: rows.length,
    inStock: rows.filter(r => r.status === 'InStock').length,
    reserved: rows.filter(r => r.status === 'Reserved').length,
    breeders: rows.filter(r => r.role === 'Breeder').length,
    forSale: rows.filter(r => r.role === 'ForSale' || r.role === 'Retired').length,
    atCost: r2(rows.reduce((s, r) => s + r.acquisitionRM, 0)),
  }
}

/**
 * Livestock carrying value at a month end — the balance sheet's `a.livestock`.
 *
 * A cat counts if it had been acquired by then and had not yet left. `acquiredAt`
 * null means the date was never recorded, and those are counted as held: the
 * alternative silently drops a real animal off the asset register.
 */
export async function livestockAtCost(monthEndExclusive: Date): Promise<number> {
  const rows = await db.catStock.findMany({
    where: {
      OR: [{ acquiredAt: null }, { acquiredAt: { lt: monthEndExclusive } }],
      AND: [{ OR: [{ soldAt: null }, { soldAt: { gte: monthEndExclusive } }] },
            { OR: [{ exitAt: null }, { exitAt: { gte: monthEndExclusive } }] }],
    },
    select: { acquisitionRM: true },
  })
  return r2(rows.reduce((s, r) => s + r.acquisitionRM, 0))
}
