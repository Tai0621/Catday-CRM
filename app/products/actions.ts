'use server'

import { db } from '@/lib/db'
import { requireManager } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// The reorder-level write, extracted so the copilot's confirm gate (C2)
// executes the same clamped write the products page does.
//
// Deliberately narrow: it sets the reorder threshold and nothing else. The
// manual form submits price, cost and threshold together, so reusing that
// action from a proposal carrying only a threshold would blank the prices —
// the kind of collateral damage a confirm card gives no warning about.

export type ReorderResult = { ok: true; id: string } | { ok: false; error: string }

export async function setReorderLevel(productId: string, level: number | null): Promise<ReorderResult> {
  await requireManager()

  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, name: true } })
  if (!product) return { ok: false, error: 'That product no longer exists.' }

  const clamped = level == null ? null : Math.max(0, Math.floor(level))
  await db.product.update({ where: { id: productId }, data: { reorderLevel: clamped } })

  revalidatePath('/products')
  revalidatePath(`/products/${productId}`)
  return { ok: true, id: productId }
}
