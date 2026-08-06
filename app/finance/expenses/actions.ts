'use server'

import { db } from '@/lib/db'
import { requireManager } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { EXPENSE_CATEGORIES } from '@/lib/finance-categories'

// The expense write, extracted from the page so the copilot's confirm gate
// (C2) executes the SAME function the manual form does. A second
// implementation would drift, and the one that drifts is always the one nobody
// is looking at.

export type ExpenseInput = {
  dateStr: string // YYYY-MM-DD
  category: string
  amount: number
  vendor?: string | null
  notes?: string | null
  paid?: boolean
  dueDateStr?: string | null
}
export type ExpenseResult = { ok: true; id: string } | { ok: false; error: string }

// An expense lands in the income statement, so a category outside the known set
// would post to no row at all — visible nowhere, and silently wrong in the
// totals. Membership in the list is validated here, not at the caller.
const VALID_CATEGORIES = new Set<string>(EXPENSE_CATEGORIES)

export async function createExpense(input: ExpenseInput): Promise<ExpenseResult> {
  await requireManager()

  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!(amount > 0)) return { ok: false, error: 'Amount must be more than zero.' }
  if (!VALID_CATEGORIES.has(input.category)) return { ok: false, error: `"${input.category}" is not an expense category.` }

  const date = new Date(`${input.dateStr}T12:00:00`)
  if (isNaN(date.getTime())) return { ok: false, error: 'Pick a valid date.' }

  const paid = input.paid !== false
  const due = !paid && input.dueDateStr ? new Date(`${input.dueDateStr}T12:00:00`) : null

  const expense = await db.expense.create({
    data: {
      date,
      category: input.category,
      amount,
      vendor: input.vendor?.trim() || null,
      notes: input.notes?.trim() || null,
      paid,
      dueDate: due && !isNaN(due.getTime()) ? due : null,
    },
  })

  revalidatePath('/finance/expenses')
  revalidatePath('/finance/aging')
  revalidatePath('/finance/income-statement')
  return { ok: true, id: expense.id }
}

export async function addExpenseForm(data: FormData) {
  await createExpense({
    dateStr: (data.get('date') as string) || '',
    category: (data.get('category') as string) || '',
    amount: parseFloat((data.get('amount') as string) || '0'),
    vendor: (data.get('vendor') as string) || null,
    notes: (data.get('notes') as string) || null,
    paid: data.get('paid') !== 'unpaid',
    dueDateStr: (data.get('dueDate') as string) || null,
  })
  redirect('/finance/expenses')
}

export async function togglePaid(data: FormData) {
  await requireManager()
  const id = data.get('id') as string
  const cur = await db.expense.findUnique({ where: { id }, select: { paid: true } })
  if (cur) await db.expense.update({ where: { id }, data: { paid: !cur.paid } })
  revalidatePath('/finance/expenses')
  revalidatePath('/finance/aging')
  revalidatePath('/finance/balance-sheet')
}

export async function removeExpense(data: FormData) {
  await requireManager()
  await db.expense.delete({ where: { id: data.get('id') as string } })
  revalidatePath('/finance/expenses')
}
