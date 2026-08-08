'use server'

import { requireManager } from '@/lib/auth'
import { generateMonth, generateReport, isMonthKey, currentMonth, departmentByKey, type DepartmentKey } from '@/lib/reports'
import { revalidatePath } from 'next/cache'

// Manual triggers. Same functions the scheduled job calls.

export async function generateMonthNow(data: FormData) {
  await requireManager()
  const month = String(data.get('month') ?? '')
  if (!isMonthKey(month) || month >= currentMonth()) return
  await generateMonth(month)
  revalidatePath('/reports')
}

/**
 * Rewrite one department's prose from the facts already stored.
 *
 * Deliberately does not recompute the figures: this exists for a report the
 * grounding check flagged, and the point is to get sound prose about the same
 * numbers the owner has already seen — not to quietly move the numbers.
 */
export async function renarrateDepartment(data: FormData) {
  await requireManager()
  const month = String(data.get('month') ?? '')
  const department = String(data.get('department') ?? '')
  if (!isMonthKey(month) || !departmentByKey(department)) return
  await generateReport(department as DepartmentKey, month, { renarrate: true })
  revalidatePath('/reports')
}
