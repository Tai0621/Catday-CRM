'use server'

import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { houseCustomer, nextSku, canonicalBreed, allocate } from '@/lib/cat-stock'
import {
  CAT_STOCK_ROLES, CAT_STOCK_STATUSES, CAT_COST_CATEGORIES, CAT_COST_ALLOCATIONS,
  RESIDENCY_TYPE,
} from '@/lib/constants'

// Cat inventory mutations.
//
// File-level so a verification script can drive them (AGENTS.md, technique A),
// and every one re-checks manager access: this module carries acquisition cost
// and margin, and a server action is a public endpoint whatever renders the form.
//
// These are driven by plain `<form action={fn}>`, which React types as returning
// nothing — so a failure cannot be handed back as a typed result the way the POS
// actions do. It redirects with `?error=` instead, which the page renders. That
// keeps the forms working with no client JavaScript, and means a rejected
// submission says why rather than appearing to do nothing.

const str = (d: FormData, k: string) => ((d.get(k) as string) ?? '').trim()
const opt = (d: FormData, k: string) => str(d, k) || null
const num = (d: FormData, k: string) => {
  const n = parseFloat(str(d, k))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}
const optNum = (d: FormData, k: string) => (str(d, k) ? num(d, k) : null)
const int = (d: FormData, k: string) => {
  const n = parseInt(str(d, k), 10)
  return Number.isFinite(n) ? n : null
}
const date = (d: FormData, k: string) => {
  const v = str(d, k)
  if (!v) return null
  const parsed = new Date(v)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const oneOf = <T extends readonly string[]>(v: string, allowed: T, fallback: T[number]): T[number] =>
  (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback

function touch(id?: string) {
  revalidatePath('/inventory')
  revalidatePath('/inventory/cats')
  revalidatePath('/inventory/litters')
  if (id) revalidatePath(`/inventory/cats/${id}`)
}

/** Bounce back to the form that failed, carrying the reason. Never returns. */
function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`)
}

/**
 * Add a cat to inventory.
 *
 * Creates the animal AND the stock row. The Cat is hung off the house customer
 * so it inherits photos, health and boarding for free; the CatStock row is what
 * makes it stock. A Cat with no stock row would be an invisible orphan — hidden
 * from the customer cat list by the house filter, and absent from inventory.
 */
export async function addStockCat(data: FormData): Promise<void> {
  await requireManager()
  const back = '/inventory/cats'
  const name = str(data, 'name')
  if (!name) fail(back, 'A name is required.')

  const breed = canonicalBreed(str(data, 'breed'))
  const genderRaw = str(data, 'gender')
  const gender = genderRaw === 'Female' ? 'Female' : genderRaw === 'Male' ? 'Male' : null
  const role = oneOf(str(data, 'role'), CAT_STOCK_ROLES, 'ForSale')
  const house = await houseCustomer()
  const sku = str(data, 'sku') || await nextSku(breed)

  if (await db.catStock.findUnique({ where: { sku }, select: { id: true } })) {
    fail(back, `SKU ${sku} is already in use.`)
  }

  const cat = await db.cat.create({
    data: {
      name,
      breed,
      gender,
      dateOfBirth: date(data, 'dateOfBirth'),
      customerId: house.id,
      lastVaccinatedAt: date(data, 'lastVaccinatedAt'),
      vaccinationExpiry: date(data, 'vaccinationExpiry'),
      rabiesAt: date(data, 'rabiesAt'),
      desexedAt: date(data, 'desexedAt'),
    },
    select: { id: true },
  })

  const stock = await db.catStock.create({
    data: {
      catId: cat.id,
      sku,
      role,
      status: 'InStock',
      acquiredAt: date(data, 'acquiredAt'),
      acquiredFrom: opt(data, 'acquiredFrom'),
      acquisitionRM: num(data, 'acquisitionRM'),
      askingRM: optNum(data, 'askingRM'),
      microchipNo: opt(data, 'microchipNo'),
      registrationNo: opt(data, 'registrationNo'),
      notes: opt(data, 'notes'),
    },
    select: { id: true },
  })

  await recordAudit({
    action: 'catstock.add', entityType: 'CatStock', entityId: stock.id,
    summary: `${sku} ${name} added to inventory`,
  })
  touch(stock.id)
  redirect(`/inventory/cats/${stock.id}`)
}

/** Edit the commercial fields. The animal's own record is edited at /cats/[id]. */
export async function updateStock(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const back = `/inventory/cats/${id}`
  if (!await db.catStock.findUnique({ where: { id }, select: { id: true } })) fail('/inventory/cats', 'Not found.')

  await db.catStock.update({
    where: { id },
    data: {
      role: oneOf(str(data, 'role'), CAT_STOCK_ROLES, 'ForSale'),
      askingRM: optNum(data, 'askingRM'),
      acquisitionRM: num(data, 'acquisitionRM'),
      acquiredFrom: opt(data, 'acquiredFrom'),
      microchipNo: opt(data, 'microchipNo'),
      registrationNo: opt(data, 'registrationNo'),
      notes: opt(data, 'notes'),
    },
  })
  touch(id)
  redirect(back)
}

/**
 * Hold a cat for a buyer.
 *
 * A deposit is recorded on the stock row, not as revenue: the money is not earned
 * until the cat leaves, and booking it early would flatter the month and then
 * need reversing when the buyer changes their mind.
 */
export async function reserveCat(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const back = `/inventory/cats/${id}`
  const stock = await db.catStock.findUnique({ where: { id }, select: { status: true, sku: true } })
  if (!stock) fail('/inventory/cats', 'Not found.')
  if (stock.status !== 'InStock') fail(back, `Cannot reserve a cat that is ${stock.status}.`)

  const customerId = opt(data, 'reservedForId')
  if (!customerId) fail(back, 'Choose the customer holding it.')

  await db.catStock.update({
    where: { id },
    data: {
      status: 'Reserved',
      reservedForId: customerId,
      depositRM: optNum(data, 'depositRM'),
      reservedUntil: date(data, 'reservedUntil'),
    },
  })
  await recordAudit({ action: 'catstock.reserve', entityType: 'CatStock', entityId: id, summary: `${stock.sku} reserved` })
  touch(id)
  redirect(back)
}

export async function releaseReservation(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const back = `/inventory/cats/${id}`
  const stock = await db.catStock.findUnique({ where: { id }, select: { status: true, sku: true } })
  if (!stock) fail('/inventory/cats', 'Not found.')
  if (stock.status !== 'Reserved') fail(back, 'Not reserved.')

  await db.catStock.update({
    where: { id },
    data: { status: 'InStock', reservedForId: null, depositRM: null, reservedUntil: null },
  })
  await recordAudit({ action: 'catstock.release', entityType: 'CatStock', entityId: id, summary: `${stock.sku} reservation released` })
  touch(id)
  redirect(back)
}

/**
 * A cat leaves without a sale — rehomed, or died.
 *
 * Never a DELETE. A death is a welfare record and a cost write-off, and a
 * rehomed retired breeder is a real disposal; both are things the business may
 * be asked about a year later. Rehoming to a named customer moves the animal to
 * them, exactly as a sale does, so its history goes with it.
 */
export async function exitCat(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const back = `/inventory/cats/${id}`
  const status = str(data, 'status') === 'Deceased' ? 'Deceased' : 'Rehomed'
  const stock = await db.catStock.findUnique({ where: { id }, select: { status: true, sku: true, catId: true } })
  if (!stock) fail('/inventory/cats', 'Not found.')
  if (stock.status === 'Sold') fail(back, 'This cat was sold — correct the sale in Revenue instead.')

  const toCustomerId = status === 'Rehomed' ? opt(data, 'toCustomerId') : null
  const reason = opt(data, 'exitReason')

  await db.$transaction([
    db.catStock.update({
      where: { id },
      data: {
        status,
        exitAt: date(data, 'exitAt') ?? new Date(),
        exitReason: reason,
        reservedForId: null, reservedUntil: null,
        ...(toCustomerId ? { soldToId: toCustomerId, saleRM: optNum(data, 'saleRM') ?? 0 } : {}),
      },
    }),
    ...(toCustomerId ? [db.cat.update({ where: { id: stock.catId }, data: { customerId: toCustomerId } })] : []),
    // A cat that has left is not in a room. Ending the residency frees the room
    // on the calendar; leaving it holds capacity for an animal that is gone.
    db.appointment.updateMany({
      where: { catId: stock.catId, type: RESIDENCY_TYPE, status: 'CheckedIn' },
      data: { status: 'Completed', endsAt: new Date() },
    }),
  ])

  await recordAudit({
    action: 'catstock.exit', entityType: 'CatStock', entityId: id,
    summary: `${stock.sku} ${status}${reason ? ` — ${reason}` : ''}`,
  })
  revalidatePath('/runsheet')
  revalidatePath('/rooms/calendar')
  touch(id)
  redirect(back)
}

/** Undo an exit recorded in error. */
export async function undoExit(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const back = `/inventory/cats/${id}`
  const stock = await db.catStock.findUnique({ where: { id }, select: { status: true, catId: true, sku: true } })
  if (!stock) fail('/inventory/cats', 'Not found.')
  if (stock.status !== 'Rehomed' && stock.status !== 'Deceased') fail(back, 'Not an exit.')

  const house = await houseCustomer()
  await db.$transaction([
    db.catStock.update({
      where: { id },
      data: { status: 'InStock', exitAt: null, exitReason: null, soldToId: null, saleRM: null },
    }),
    db.cat.update({ where: { id: stock.catId }, data: { customerId: house.id } }),
  ])
  await recordAudit({ action: 'catstock.undoExit', entityType: 'CatStock', entityId: id, summary: `${stock.sku} exit undone` })
  touch(id)
  redirect(back)
}

// ── costs ───────────────────────────────────────────────────────────────────

/**
 * One cost against one cat.
 *
 * Management data only. It never reaches a financial statement — the matching
 * Expense row is what the income statement sees, and adding this to the balance
 * sheet as well would count the same money twice and overstate profit.
 */
export async function addCost(data: FormData): Promise<void> {
  await requireManager()
  const catStockId = str(data, 'catStockId')
  const back = `/inventory/cats/${catStockId}`
  const amountRM = num(data, 'amountRM')
  if (amountRM <= 0) fail(back, 'Amount must be more than zero.')

  await db.catCost.create({
    data: {
      catStockId,
      date: date(data, 'date') ?? new Date(),
      category: oneOf(str(data, 'category'), CAT_COST_CATEGORIES, 'Other'),
      amountRM,
      vendor: opt(data, 'vendor'),
      notes: opt(data, 'notes'),
    },
  })
  touch(catStockId)
  redirect(back)
}

export async function deleteCost(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const cost = await db.catCost.findUnique({ where: { id }, select: { catStockId: true } })
  if (!cost) fail('/inventory/cats', 'Not found.')
  await db.catCost.delete({ where: { id } })
  touch(cost.catStockId)
  redirect(`/inventory/cats/${cost.catStockId}`)
}

/**
 * One vet visit, many cats — the owner's Costing sheet.
 *
 * `PerCat` multiplies a rate by head count (57 × RM45); `EvenSplit` divides one
 * invoice. The split always adds back to the total: a half-sen lost per cat
 * leaves the batch failing to reconcile against the bill, which reads as a
 * missing payment rather than a rounding choice.
 */
export async function addCostBatch(data: FormData): Promise<void> {
  await requireManager()
  const back = '/inventory/cats'
  const ids = (data.getAll('catStockIds') as string[]).filter(Boolean)
  if (ids.length === 0) fail(back, 'Select at least one cat.')

  const method = oneOf(str(data, 'method'), CAT_COST_ALLOCATIONS, 'PerCat')
  const rate = num(data, 'amountRM')
  if (rate <= 0) fail(back, 'Amount must be more than zero.')

  const category = oneOf(str(data, 'category'), CAT_COST_CATEGORIES, 'Vaccination')
  const when = date(data, 'date') ?? new Date()
  const vendor = opt(data, 'vendor')
  const total = method === 'PerCat' ? Math.round(rate * ids.length * 100) / 100 : rate
  const parts = allocate(total, ids.length, method)

  const batch = await db.catCostBatch.create({
    data: { date: when, vendor, totalRM: total, method, notes: opt(data, 'notes') },
    select: { id: true },
  })

  await db.catCost.createMany({
    data: ids.map((catStockId, i) => ({
      catStockId, date: when, category, amountRM: parts[i], batchId: batch.id, vendor,
    })),
  })

  // Vaccination and deworming are health facts as well as costs — recording the
  // bill without moving the dates would leave the boarding gate and the Action
  // Inbox believing nothing had been done.
  const stocks = await db.catStock.findMany({ where: { id: { in: ids } }, select: { catId: true } })
  const catIds = stocks.map(s => s.catId)
  if (category === 'Vaccination') {
    const nextDue = new Date(when.getTime())
    nextDue.setFullYear(nextDue.getFullYear() + 1)
    await db.cat.updateMany({ where: { id: { in: catIds } }, data: { lastVaccinatedAt: when, vaccinationExpiry: nextDue } })
  } else if (category === 'Deworm') {
    await db.cat.updateMany({ where: { id: { in: catIds } }, data: { lastDewormAt: when } })
  }

  await recordAudit({
    action: 'catstock.costBatch', entityType: 'CatCostBatch', entityId: batch.id,
    summary: `${category} × ${ids.length} cats = RM ${total}`,
  })
  touch()
  redirect(`/inventory/cats?batched=${ids.length}`)
}

// ── rooms ───────────────────────────────────────────────────────────────────

/**
 * Move a house cat into a room, as a `Residency` appointment.
 *
 * An appointment rather than a column on CatStock, because that is what the room
 * calendar and the run sheet already read: the room is blocked against paying
 * guests and the cat gets its daily care tasks, with no second source of truth
 * about who is in which room. `CareTask.appointmentId` is NOT NULL and part of a
 * unique constraint, so the alternative meant rebuilding a live table for a
 * worse result.
 */
export async function assignRoom(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const back = `/inventory/cats/${id}`
  const roomId = opt(data, 'roomId')
  const stock = await db.catStock.findUnique({ where: { id }, select: { catId: true, sku: true } })
  if (!stock) fail('/inventory/cats', 'Not found.')

  const house = await houseCustomer()
  await db.appointment.updateMany({
    where: { catId: stock.catId, type: RESIDENCY_TYPE, status: 'CheckedIn' },
    data: { status: 'Completed', endsAt: new Date() },
  })

  if (roomId) {
    await db.appointment.create({
      data: {
        customerId: house.id,
        catId: stock.catId,
        type: RESIDENCY_TYPE,
        scheduledAt: new Date(),
        status: 'CheckedIn',
        roomId,
        price: 0,
        paid: true, // nothing is owed; an unpaid RM0 visit would join the debt chase
      },
    })
  }
  revalidatePath('/runsheet')
  revalidatePath('/rooms')
  revalidatePath('/rooms/calendar')
  touch(id)
  redirect(back)
}

// ── litters ─────────────────────────────────────────────────────────────────

export async function addLitter(data: FormData): Promise<void> {
  await requireManager()
  const back = '/inventory/litters'
  const code = str(data, 'code')
  if (!code) fail(back, 'A litter code is required.')
  if (await db.litter.findUnique({ where: { code }, select: { id: true } })) {
    fail(back, `Litter ${code} already exists.`)
  }

  await db.litter.create({
    data: {
      code,
      damId: opt(data, 'damId'),
      sireId: opt(data, 'sireId'),
      sireName: opt(data, 'sireName'),
      expectedAt: date(data, 'expectedAt'),
      bornAt: date(data, 'bornAt'),
      bornCount: int(data, 'bornCount'),
      survivingCount: int(data, 'survivingCount'),
      notes: opt(data, 'notes'),
    },
  })
  touch()
  redirect(back)
}

export async function setLitter(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  await db.catStock.update({ where: { id }, data: { litterId: opt(data, 'litterId') } })
  touch(id)
  redirect(`/inventory/cats/${id}`)
}

/** Statuses a manager may set by hand. Sale and exit have their own actions. */
export async function setStatus(data: FormData): Promise<void> {
  await requireManager()
  const id = str(data, 'id')
  const back = `/inventory/cats/${id}`
  const status = oneOf(str(data, 'status'), CAT_STOCK_STATUSES, 'InStock')
  if (status === 'Sold') fail(back, 'Sell through the POS so the sale is recorded.')
  await db.catStock.update({ where: { id }, data: { status } })
  touch(id)
  redirect(back)
}
