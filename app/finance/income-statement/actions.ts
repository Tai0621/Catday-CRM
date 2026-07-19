'use server'

import { db } from '@/lib/db'
import { getSession, isManager } from '@/lib/auth'
import { statementRowKeys } from '@/lib/finance'
import { revalidatePath } from 'next/cache'

export type ActionResult = { ok: true } | { ok: false; error: string }

async function requireAccountant(): Promise<string | null> {
  const session = await getSession()
  return session && isManager(session) ? null : 'Manager sign-in required.'
}

async function allowedKeys(year: number): Promise<Set<string>> {
  const defs = await db.statementRowDef.findMany({ where: { year }, select: { id: true } })
  return new Set([...statementRowKeys(), ...defs.map(d => `custom:${d.id}`)])
}

// Excel-style Save: commit every changed cell in one batch.
// amount === null clears the override back to the live OS figure.
export async function saveStatementCells(payloadJson: string): Promise<ActionResult> {
  const denied = await requireAccountant()
  if (denied) return { ok: false, error: denied }

  let p: { year: number; cells: { month: number; rowKey: string; amount: number | null }[] }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  const year = Math.trunc(p.year)
  if (!(year >= 2000 && year <= 2100)) return { ok: false, error: 'Bad year.' }
  if (!Array.isArray(p.cells) || p.cells.length === 0) return { ok: false, error: 'Nothing to save.' }
  if (p.cells.length > 400) return { ok: false, error: 'Too many changes in one save.' }

  const keys = await allowedKeys(year)
  for (const c of p.cells) {
    const month = Math.trunc(c.month)
    if (!(month >= 0 && month <= 11)) return { ok: false, error: 'Bad month.' }
    if (!keys.has(c.rowKey)) return { ok: false, error: `Unknown statement row: ${c.rowKey}` }
    if (c.amount !== null) {
      const amount = Number(c.amount)
      if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Amounts must be zero or above.' }
    }
  }

  const ops = p.cells.map(c =>
    c.amount === null
      ? db.statementCell.deleteMany({ where: { year, month: Math.trunc(c.month), rowKey: c.rowKey } })
      : db.statementCell.upsert({
          where: { year_month_rowKey: { year, month: Math.trunc(c.month), rowKey: c.rowKey } },
          create: { year, month: Math.trunc(c.month), rowKey: c.rowKey, amount: Math.round(Number(c.amount) * 100) / 100 },
          update: { amount: Math.round(Number(c.amount) * 100) / 100 },
        }),
  )
  await db.$transaction(ops)
  revalidatePath('/finance/income-statement')
  return { ok: true }
}

// Add a custom row to a section (fully manual line, e.g. Depreciation)
export async function addStatementRow(payloadJson: string): Promise<ActionResult & { id?: string }> {
  const denied = await requireAccountant()
  if (denied) return { ok: false, error: denied }

  let p: { year: number; section: string; label: string }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  const year = Math.trunc(p.year)
  if (!(year >= 2000 && year <= 2100)) return { ok: false, error: 'Bad year.' }
  if (!['rev', 'cogs', 'opex'].includes(p.section)) return { ok: false, error: 'Bad section.' }
  const label = (p.label ?? '').trim()
  if (!label || label.length > 60) return { ok: false, error: 'Row name must be 1–60 characters.' }

  const count = await db.statementRowDef.count({ where: { year, section: p.section } })
  const def = await db.statementRowDef.create({ data: { year, section: p.section, label, sortOrder: count } })
  revalidatePath('/finance/income-statement')
  return { ok: true, id: def.id }
}

// Remove a built-in row from a year's statement (its totals exclude it) —
// the OS data underneath is untouched, so it can always be restored.
export async function hideStatementRow(payloadJson: string): Promise<ActionResult> {
  const denied = await requireAccountant()
  if (denied) return { ok: false, error: denied }

  let p: { year: number; rowKey: string }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  const year = Math.trunc(p.year)
  if (!(year >= 2000 && year <= 2100)) return { ok: false, error: 'Bad year.' }
  if (!statementRowKeys().includes(p.rowKey) || p.rowKey === 'tax') {
    return { ok: false, error: 'This row cannot be removed.' }
  }

  await db.statementHiddenRow.upsert({
    where: { year_rowKey: { year, rowKey: p.rowKey } },
    create: { year, rowKey: p.rowKey },
    update: {},
  })
  revalidatePath('/finance/income-statement')
  return { ok: true }
}

// Persist the drag-reordered row order for a section.
export async function reorderStatementRows(payloadJson: string): Promise<ActionResult> {
  const denied = await requireAccountant()
  if (denied) return { ok: false, error: denied }

  let p: { year: number; section: string; keys: string[] }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  const year = Math.trunc(p.year)
  if (!(year >= 2000 && year <= 2100)) return { ok: false, error: 'Bad year.' }
  if (!['rev', 'cogs', 'opex'].includes(p.section)) return { ok: false, error: 'Bad section.' }
  if (!Array.isArray(p.keys) || p.keys.length > 200 || p.keys.some(k => typeof k !== 'string')) {
    return { ok: false, error: 'Bad order.' }
  }

  const orderJson = JSON.stringify(p.keys)
  await db.statementRowOrder.upsert({
    where: { year_section: { year, section: p.section } },
    create: { year, section: p.section, orderJson },
    update: { orderJson },
  })
  revalidatePath('/finance/income-statement')
  return { ok: true }
}

export async function unhideStatementRow(payloadJson: string): Promise<ActionResult> {
  const denied = await requireAccountant()
  if (denied) return { ok: false, error: denied }

  let p: { year: number; rowKey: string }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  await db.statementHiddenRow.deleteMany({ where: { year: Math.trunc(p.year), rowKey: p.rowKey } })
  revalidatePath('/finance/income-statement')
  return { ok: true }
}

// Delete a custom row and every figure keyed into it.
export async function removeStatementRow(payloadJson: string): Promise<ActionResult> {
  const denied = await requireAccountant()
  if (denied) return { ok: false, error: denied }

  let p: { id: string }
  try {
    p = JSON.parse(payloadJson)
  } catch {
    return { ok: false, error: 'Bad request.' }
  }

  const def = await db.statementRowDef.findUnique({ where: { id: p.id } })
  if (!def) return { ok: false, error: 'Row not found.' }

  await db.$transaction([
    db.statementCell.deleteMany({ where: { year: def.year, rowKey: `custom:${def.id}` } }),
    db.statementRowDef.delete({ where: { id: def.id } }),
  ])
  revalidatePath('/finance/income-statement')
  return { ok: true }
}
