'use server'

import { db } from '@/lib/db'
import { getSession, isManager } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export type DeleteResult = { ok: true; removed: number; total: number } | { ok: false; error: string }

// Remove a wrongly-recorded transaction. Deletes its line items too, and any
// sibling rows sharing the same reference (a split POS payment stores its
// wallet portion as a second row with the same reference) so revenue and the
// cash-up stay consistent — never half-removed.
export async function deleteTransaction(id: string): Promise<DeleteResult> {
  const session = await getSession()
  if (!session || !isManager(session)) return { ok: false, error: 'Manager sign-in required.' }

  const txn = await db.transaction.findUnique({ where: { id }, select: { reference: true } })
  if (!txn) return { ok: false, error: 'Transaction not found (already deleted?).' }

  // Group by reference only when it exists — a null reference must not sweep up
  // every other manual entry that also has no reference.
  const group = txn.reference
    ? await db.transaction.findMany({ where: { reference: txn.reference }, select: { id: true, total: true } })
    : [{ id, total: (await db.transaction.findUnique({ where: { id }, select: { total: true } }))!.total }]

  const ids = group.map(t => t.id)
  const total = group.reduce((s, t) => s + t.total, 0)

  await db.$transaction([
    db.transactionLine.deleteMany({ where: { transactionId: { in: ids } } }),
    db.transaction.deleteMany({ where: { id: { in: ids } } }),
  ])

  revalidatePath('/revenue')
  revalidatePath('/finance/income-statement')
  revalidatePath('/cashup')
  revalidatePath('/')
  return { ok: true, removed: ids.length, total: Math.round(total * 100) / 100 }
}
