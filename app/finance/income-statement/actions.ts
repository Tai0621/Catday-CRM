'use server'

import { db } from '@/lib/db'
import { getSession, isManager } from '@/lib/auth'
import { statementRowKeys } from '@/lib/finance'
import { revalidatePath } from 'next/cache'

export type SaveCellResult = { ok: true } | { ok: false; error: string }

// Accountant keys a figure into a statement cell (blue), or clears it back to
// the live OS figure (black). amount === null clears.
export async function saveStatementCell(payloadJson: string): Promise<SaveCellResult> {
  const session = await getSession()
  if (!session || !isManager(session)) return { ok: false, error: 'Manager sign-in required.' }

  let p: { year: number; month: number; rowKey: string; amount: number | null }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  const year = Math.trunc(p.year), month = Math.trunc(p.month)
  if (!(year >= 2000 && year <= 2100)) return { ok: false, error: 'Bad year.' }
  if (!(month >= 0 && month <= 11)) return { ok: false, error: 'Bad month.' }
  if (!statementRowKeys().includes(p.rowKey)) return { ok: false, error: 'Unknown statement row.' }

  if (p.amount === null) {
    await db.statementCell.deleteMany({ where: { year, month, rowKey: p.rowKey } })
  } else {
    const amount = Math.round(Number(p.amount) * 100) / 100
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Amount must be zero or above.' }
    await db.statementCell.upsert({
      where: { year_month_rowKey: { year, month, rowKey: p.rowKey } },
      create: { year, month, rowKey: p.rowKey, amount },
      update: { amount },
    })
  }
  revalidatePath('/finance/income-statement')
  return { ok: true }
}
