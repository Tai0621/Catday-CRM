'use server'

import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { awardPoints } from '@/lib/loyalty'
import { generateReceiptToken } from '@/lib/receipt'

export interface CheckoutItem {
  kind: 'appointment' | 'product' | 'service' | 'custom'
  refId?: string // appointmentId / productId / serviceId
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
  for (const i of items) {
    const key = i.kind === 'appointment' ? (apptType.get(i.refId!) ?? 'Other')
      : i.kind === 'product' ? 'Retail'
      : 'Other'
    const mapped = key === 'Bath' || key === 'Diagnosis' ? 'Grooming' : key
    catTotals.set(mapped, (catTotals.get(mapped) ?? 0) + i.qty * i.unitPrice)
  }
  const category = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other'

  const reference = 'CD-' + Date.now().toString(36).toUpperCase()
  const receiptToken = generateReceiptToken() // customer-facing receipt link
  const now = new Date()
  const staffName = session.name

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
        create: items.map(i => ({
          catId: i.catId || null,
          appointmentId: i.kind === 'appointment' ? i.refId ?? null : null,
          productId: i.kind === 'product' ? i.refId ?? null : null,
          description: i.label,
          quantity: i.qty,
          unitPrice: i.unitPrice,
          subtotal: Math.round(i.qty * i.unitPrice * 100) / 100,
        })),
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
          create: items.map(i => ({
            catId: i.catId || null,
            appointmentId: i.kind === 'appointment' ? i.refId ?? null : null,
            productId: i.kind === 'product' ? i.refId ?? null : null,
            description: i.label,
            quantity: i.qty,
            unitPrice: i.unitPrice,
            subtotal: Math.round(i.qty * i.unitPrice * 100) / 100,
          })),
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
