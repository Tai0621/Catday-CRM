// Pure statement category constants — safe to import from client components
// (lib/finance.ts re-exports these; it can't be imported client-side as it
// pulls in the database).

export const TAX_RATE = 0.24 // Malaysian corporate rate, per the model's assumptions

// Expense categories from the Excel's OPEX BASE, split the way its
// Income Statement sheet splits them.
export const COGS_CATEGORIES = ['Grooming Supplies', 'Food & Litter', 'Vet Visit', 'Retail Stock'] as const
export const OPEX_CATEGORIES = ['Rent', 'Salaries', 'Cleaning Supplies', 'Utilities', 'Marketing', 'Maintenance', 'Other Expense'] as const
export const EXPENSE_CATEGORIES = [...COGS_CATEGORIES, ...OPEX_CATEGORIES] as const
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
