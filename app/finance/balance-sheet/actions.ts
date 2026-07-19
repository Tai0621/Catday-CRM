'use server'

import { db } from '@/lib/db'
import { getSession, isManager } from '@/lib/auth'
import { KEYED_BS_KEYS } from '@/lib/balance-sheet'
import { revalidatePath } from 'next/cache'

export type SaveResult = { ok: true } | { ok: false; error: string }

// Save the accountant's hard-keyed balance-sheet lines (blue) for an as-of
// month. amount === null clears a line. Only KEYED lines are writable — the
// OS-derived lines (receivables, wallet, retained earnings) are read-only.
export async function saveBalanceSheetCells(payloadJson: string): Promise<SaveResult> {
  const session = await getSession()
  if (!session || !isManager(session)) return { ok: false, error: 'Manager sign-in required.' }

  let p: { asOf: string; cells: { lineKey: string; amount: number | null }[] }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  if (!/^\d{4}-\d{2}$/.test(p.asOf)) return { ok: false, error: 'Bad as-of month.' }
  if (!Array.isArray(p.cells) || p.cells.length === 0) return { ok: false, error: 'Nothing to save.' }

  const ops = []
  for (const c of p.cells) {
    if (!KEYED_BS_KEYS.includes(c.lineKey)) return { ok: false, error: `Line "${c.lineKey}" can't be keyed.` }
    if (c.amount === null) {
      ops.push(db.balanceSheetCell.deleteMany({ where: { asOf: p.asOf, lineKey: c.lineKey } }))
    } else {
      const amount = Math.round(Number(c.amount) * 100) / 100
      if (!Number.isFinite(amount)) return { ok: false, error: 'Amounts must be numbers.' }
      ops.push(db.balanceSheetCell.upsert({
        where: { asOf_lineKey: { asOf: p.asOf, lineKey: c.lineKey } },
        create: { asOf: p.asOf, lineKey: c.lineKey, amount },
        update: { amount },
      }))
    }
  }
  await db.$transaction(ops)
  revalidatePath('/finance/balance-sheet')
  return { ok: true }
}
