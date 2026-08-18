'use server'

import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { awardPoints } from '@/lib/loyalty'
import { generateReceiptToken } from '@/lib/receipt'

export interface CheckoutItem {
  // 'cat' sells an animal out of inventory; refId is the CatStock id, not the
  // Cat id. It goes through the POS rather than its own screen so a cat sale
  // lands in revenue, on the customer's record and in the monthly close like
  // any other sale — a second sale path is how a business ends up with two sets
  // of numbers.
  kind: 'appointment' | 'product' | 'service' | 'custom' | 'cat'
  refId?: string // appointmentId / productId / serviceId / catStockId
  label: string
  qty: number
  unitPrice: number
  catId?: string
  needsPrice?: boolean // UI flag: price couldn't be derived, cashier confirms it (server ignores)
}

export interface CheckoutPayload {
  customerId: string | null
  items: CheckoutItem[]
  walletAmount: number // portion paid from stored value
  method: 'Cash' | 'Card' | 'QR' // method for the remainder
  note?: string
}

export type CheckoutResult = { ok: true; receiptId: string } | { ok: false; error: string }

// One tap closes the whole visit: transaction + lines, appointments marked
// paid, stock decremented, wallet deducted, points awarded at tier multiplier.
export async function checkout(payloadJson: string): Promise<CheckoutResult> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Not signed in.' }

  let p: CheckoutPayload
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  const items = (p.items ?? []).filter(i => i.qty > 0 && i.unitPrice >= 0 && i.label)
  if (items.length === 0) return { ok: false, error: 'Basket is empty.' }

  const total = Math.round(items.reduce((s, i) => s + i.qty * i.unitPrice, 0) * 100) / 100
  if (total <= 0) return { ok: false, error: 'Total must be above zero.' }

  // Wallet portion — validated against the live balance
  let walletAmount = Math.max(0, Math.min(p.walletAmount ?? 0, total))
  let multiplier = 1
  if (p.customerId) {
    const customer = await db.customer.findUnique({
      where: { id: p.customerId },
      select: {
        walletBalance: true,
        memberships: { where: { status: 'Active' }, select: { tier: { select: { pointsMultiplier: true } } } },
      },
    })
    if (!customer) return { ok: false, error: 'Customer not found.' }
    if (walletAmount > customer.walletBalance) {
      return { ok: false, error: `Wallet only has RM ${customer.walletBalance.toFixed(2)}.` }
    }
    multiplier = customer.memberships[0]?.tier.pointsMultiplier ?? 1
  } else if (walletAmount > 0) {
    return { ok: false, error: 'Wallet payment needs a customer selected.' }
  }
  const remainder = Math.round((total - walletAmount) * 100) / 100

  // Category = the biggest slice of the basket (appointment types win over Retail)
  const catTotals = new Map<string, number>()
  const apptIds = items.filter(i => i.kind === 'appointment' && i.refId).map(i => i.refId!)
  const appts = apptIds.length
    ? await db.appointment.findMany({ where: { id: { in: apptIds } }, select: { id: true, type: true } })
    : []
  const apptType = new Map(appts.map(a => [a.id, a.type]))

  // ── cats ──
  // Resolved server-side from the CatStock id: the animal it points at, and
  // whether it may leave at all, are not things the till is allowed to assert.
  const catStockIds = items.filter(i => i.kind === 'cat' && i.refId).map(i => i.refId!)
  const catStocks = catStockIds.length
    ? await db.catStock.findMany({
        where: { id: { in: catStockIds } },
        select: { id: true, catId: true, sku: true, status: true, reservedForId: true },
      })
    : []
  if (catStocks.length !== new Set(catStockIds).size) return { ok: false, error: 'A cat in the basket no longer exists.' }
  if (catStockIds.length > 0 && !p.customerId) {
    return { ok: false, error: 'A cat sale needs the buyer selected — the animal is transferred to them.' }
  }
  for (const s of catStocks) {
    if (s.status === 'Sold' || s.status === 'Rehomed' || s.status === 'Deceased') {
      return { ok: false, error: `${s.sku} has already left (${s.status}).` }
    }
    // A hold belongs to whoever paid the deposit. Selling it over their head is
    // not a till decision — release the reservation first, deliberately.
    if (s.status === 'Reserved' && s.reservedForId && s.reservedForId !== p.customerId) {
      return { ok: false, error: `${s.sku} is reserved for someone else. Release the hold first.` }
    }
  }
  const catIdOf = new Map(catStocks.map(s => [s.id, s.catId]))

  for (const i of items) {
    const key = i.kind === 'appointment' ? (apptType.get(i.refId!) ?? 'Other')
      : i.kind === 'product' ? 'Retail'
      : i.kind === 'cat' ? 'Cat Sale'
      : 'Other'
    const mapped = key === 'Bath' || key === 'Diagnosis' ? 'Grooming' : key
    catTotals.set(mapped, (catTotals.get(mapped) ?? 0) + i.qty * i.unitPrice)
  }
  const category = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other'

  const reference = 'CD-' + Date.now().toString(36).toUpperCase()
  const receiptToken = generateReceiptToken() // customer-facing receipt link
  const now = new Date()
  const staffName = session.name

  // One shape for a sale line, because the wallet-only branch below builds the
  // same rows again and the two drifting apart would mean a cat sold entirely
  // from wallet credit lost its link to the animal.
  const lineFor = (i: CheckoutItem) => ({
    catId: (i.kind === 'cat' && i.refId ? catIdOf.get(i.refId) : i.catId) || null,
    appointmentId: i.kind === 'appointment' ? i.refId ?? null : null,
    productId: i.kind === 'product' ? i.refId ?? null : null,
    description: i.label,
    quantity: i.qty,
    unitPrice: i.unitPrice,
    subtotal: Math.round(i.qty * i.unitPrice * 100) / 100,
  })

  const ops = []

  // Primary transaction carries the lines; wallet portion is its own row so
  // revenue sums stay right and cash-up counts real money-in correctly.
  const primaryId = crypto.randomUUID()
  ops.push(db.transaction.create({
    data: {
      id: primaryId,
      customerId: p.customerId,
      date: now,
      total: remainder > 0 ? remainder : 0,
      category,
      method: remainder > 0 ? p.method : 'Wallet',
      reference,
      publicToken: receiptToken,
      notes: [p.note?.trim(), `POS · ${staffName}`].filter(Boolean).join(' · '),
      lines: {
        create: items.map(lineFor),
      },
    },
  }))
  if (remainder > 0 && walletAmount > 0) {
    ops.push(db.transaction.create({
      data: {
        customerId: p.customerId, date: now, total: walletAmount,
        category, method: 'Wallet', reference, notes: `POS wallet portion · ${staffName}`,
      },
    }))
  } else if (remainder === 0 && walletAmount > 0) {
    // fully wallet-paid: primary row must carry the value
    ops.pop()
    ops.push(db.transaction.create({
      data: {
        id: primaryId,
        customerId: p.customerId, date: now, total: walletAmount, category,
        method: 'Wallet', reference, publicToken: receiptToken,
        notes: [p.note?.trim(), `POS · ${staffName}`].filter(Boolean).join(' · '),
        lines: {
          create: items.map(lineFor),
        },
      },
    }))
  }

  if (apptIds.length > 0) {
    ops.push(db.appointment.updateMany({ where: { id: { in: apptIds } }, data: { paid: true, status: 'Completed' } }))
  }
  for (const i of items) {
    if (i.kind === 'product' && i.refId) {
      ops.push(db.product.update({ where: { id: i.refId }, data: { stockQty: { decrement: i.qty } } }))
      ops.push(db.stockMovement.create({ data: { productId: i.refId, delta: -i.qty, reason: 'Sale', reference } }))
    }
    // Selling a cat moves the ANIMAL to the buyer and closes its stock record.
    // The Cat row is not copied or recreated: the new owner inherits the
    // vaccination history, the photographs and every past visit, which is the
    // whole reason owned cats live in the Cat table rather than beside it.
    if (i.kind === 'cat' && i.refId) {
      const catId = catIdOf.get(i.refId)
      const price = Math.round(i.qty * i.unitPrice * 100) / 100
      ops.push(db.catStock.update({
        where: { id: i.refId },
        data: {
          status: 'Sold', soldAt: now, soldToId: p.customerId, saleRM: price,
          saleReference: reference,
          reservedForId: null, reservedUntil: null, depositRM: null,
        },
      }))
      if (catId && p.customerId) ops.push(db.cat.update({ where: { id: catId }, data: { customerId: p.customerId } }))
      // It no longer lives here, so it no longer holds a room.
      if (catId) {
        ops.push(db.appointment.updateMany({
          where: { catId, type: 'Residency', status: 'CheckedIn' },
          data: { status: 'Completed', endsAt: now },
        }))
      }
    }
  }
  if (walletAmount > 0 && p.customerId) {
    ops.push(db.walletEntry.create({ data: { customerId: p.customerId, amount: -walletAmount, kind: 'Spend', note: `POS ${reference}` } }))
    ops.push(db.customer.update({ where: { id: p.customerId }, data: { walletBalance: { decrement: walletAmount } } }))
  }

  try {
    await db.$transaction(ops)
  } catch (e) {
    console.error('checkout failed', e)
    return { ok: false, error: 'Could not complete the sale — nothing was charged. Try again.' }
  }

  // Points ride outside the main transaction: a points hiccup must never void a sale
  if (p.customerId) {
    const points = Math.floor(total * multiplier)
    if (points > 0) await awardPoints(p.customerId, points, 'Purchase', reference).catch(() => {})
  }

  return { ok: true, receiptId: primaryId }
}
