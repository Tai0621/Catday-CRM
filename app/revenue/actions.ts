'use server'

import { db } from '@/lib/db'
import { getSession, isManager } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { houseCustomer } from '@/lib/cat-stock'

export type DeleteResult =
  | { ok: true; removed: number; total: number; pointsReversed: number; walletRefunded: number; restocked: number; apptsReopened: number; catsReturned: number }
  | { ok: false; error: string }

// Remove a wrongly-recorded transaction AND unwind the side effects the POS
// created for it — loyalty points, wallet payment, and product stock — so the
// customer's balances and inventory return to what they were. Sibling rows
// sharing the reference (split payment) go together. Deposits / manual entries
// (no reference) just delete the single row.
export async function deleteTransaction(id: string): Promise<DeleteResult> {
  const session = await getSession()
  if (!session || !isManager(session)) return { ok: false, error: 'Manager sign-in required.' }

  const txn = await db.transaction.findUnique({ where: { id }, select: { reference: true, total: true } })
  if (!txn) return { ok: false, error: 'Transaction not found (already deleted?).' }

  const reference = txn.reference
  const group = reference
    ? await db.transaction.findMany({ where: { reference }, select: { id: true, total: true } })
    : [{ id, total: txn.total }]
  const ids = group.map(t => t.id)
  const total = group.reduce((s, t) => s + t.total, 0)

  const ops = []
  let pointsReversed = 0
  let walletRefunded = 0
  let restocked = 0

  // ── reverse loyalty points + wallet payment (linked by the reference) ──
  if (reference) {
    const pointEntries = await db.loyaltyEntry.findMany({ where: { note: reference }, select: { id: true, points: true, customerId: true } })
    if (pointEntries.length > 0) {
      const byCust = new Map<string, number>()
      for (const e of pointEntries) byCust.set(e.customerId, (byCust.get(e.customerId) ?? 0) + e.points)
      pointsReversed = pointEntries.reduce((s, e) => s + e.points, 0)
      ops.push(db.loyaltyEntry.deleteMany({ where: { id: { in: pointEntries.map(e => e.id) } } }))
      for (const [customerId, pts] of byCust) {
        ops.push(db.customer.update({ where: { id: customerId }, data: { pointsBalance: { decrement: pts } } }))
      }
    }

    const walletEntries = await db.walletEntry.findMany({ where: { note: `POS ${reference}` }, select: { id: true, amount: true, customerId: true } })
    if (walletEntries.length > 0) {
      const byCust = new Map<string, number>()
      for (const e of walletEntries) byCust.set(e.customerId, (byCust.get(e.customerId) ?? 0) + e.amount)
      walletRefunded = walletEntries.reduce((s, e) => s + Math.abs(e.amount), 0)
      ops.push(db.walletEntry.deleteMany({ where: { id: { in: walletEntries.map(e => e.id) } } }))
      for (const [customerId, amt] of byCust) {
        // amt is negative (a spend) — subtracting it refunds the wallet
        ops.push(db.customer.update({ where: { id: customerId }, data: { walletBalance: { decrement: amt } } }))
      }
    }
  }

  // ── restock any products sold on these transactions ──
  const productLines = await db.transactionLine.findMany({
    where: { transactionId: { in: ids }, productId: { not: null } },
    select: { productId: true, quantity: true },
  })
  for (const l of productLines) {
    restocked += l.quantity
    ops.push(db.product.update({ where: { id: l.productId! }, data: { stockQty: { increment: l.quantity } } }))
    ops.push(db.stockMovement.create({ data: { productId: l.productId!, delta: l.quantity, reason: 'SaleReversal', reference: reference ?? null } }))
  }

  // ── return any cats this sale sold to inventory ──
  //
  // Matched on the SALE REFERENCE, never on the line's catId. Once a cat is
  // sold its new owner brings it in for grooming, and those sale lines carry the
  // same catId — reversing one of those would quietly take a customer's pet back
  // into stock and put it on sale again.
  let catsReturned = 0
  if (reference) {
    const soldCats = await db.catStock.findMany({
      where: { saleReference: reference, status: 'Sold' },
      select: { id: true, catId: true, sku: true },
    })
    if (soldCats.length > 0) {
      catsReturned = soldCats.length
      const house = await houseCustomer()
      ops.push(db.catStock.updateMany({
        where: { id: { in: soldCats.map(c => c.id) } },
        data: { status: 'InStock', soldAt: null, soldToId: null, saleRM: null, saleReference: null },
      }))
      // Ownership goes back to the house with the stock record, or the animal
      // would sit in inventory while still listed as the buyer's pet.
      ops.push(db.cat.updateMany({
        where: { id: { in: soldCats.map(c => c.catId) } },
        data: { customerId: house.id },
      }))
    }
  }

  // ── re-open any appointments this sale settled (mark unpaid again) ──
  const apptLines = await db.transactionLine.findMany({
    where: { transactionId: { in: ids }, appointmentId: { not: null } },
    select: { appointmentId: true },
  })
  const apptIds = [...new Set(apptLines.map(l => l.appointmentId!))]
  let apptsReopened = 0
  if (apptIds.length > 0) {
    apptsReopened = apptIds.length
    ops.push(db.appointment.updateMany({ where: { id: { in: apptIds } }, data: { paid: false } }))
  }

  // ── finally, remove the lines and the transaction rows ──
  ops.push(db.transactionLine.deleteMany({ where: { transactionId: { in: ids } } }))
  ops.push(db.transaction.deleteMany({ where: { id: { in: ids } } }))

  await db.$transaction(ops)

  const roundedTotal = Math.round(total * 100) / 100
  const roundedRefund = Math.round(walletRefunded * 100) / 100
  await recordAudit({
    action: 'transaction.delete',
    entityType: 'Transaction',
    entityId: id,
    summary: `Deleted sale ${reference ?? id} (RM ${roundedTotal.toFixed(2)}) — ${ids.length} row(s), ${pointsReversed} pts reversed, RM ${roundedRefund.toFixed(2)} wallet refunded, ${restocked} restocked, ${apptsReopened} appt(s) reopened, ${catsReturned} cat(s) returned to stock`,
    detail: { reference, ids, total: roundedTotal, pointsReversed, walletRefunded: roundedRefund, restocked, apptsReopened, catsReturned },
  }, session)

  revalidatePath('/revenue')
  revalidatePath('/inventory/cats')
  revalidatePath('/finance/income-statement')
  revalidatePath('/finance/aging')
  revalidatePath('/cashup')
  revalidatePath('/')
  return {
    ok: true,
    removed: ids.length,
    total: Math.round(total * 100) / 100,
    pointsReversed,
    walletRefunded: Math.round(walletRefunded * 100) / 100,
    restocked,
    apptsReopened,
    catsReturned,
  }
}
