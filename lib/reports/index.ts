import { db } from '../db'
import { budgetState } from '../ai/budget'
import { aiConfigured } from '../ai/provider'
import { buildDepartmentFacts, DEPARTMENTS, DEPARTMENT_KEYS, departmentByKey, type DepartmentKey } from './facts'
import { narrateReport, narrationText } from './narrate'
import { checkGrounding } from './grounding'
import { previousMonth, currentMonth, monthLabel, isMonthKey } from './period'

export { DEPARTMENTS, DEPARTMENT_KEYS, departmentByKey, type DepartmentKey }
export { previousMonth, currentMonth, monthLabel, isMonthKey }
export { checkGrounding, factNumbers } from './grounding'

export type ReportStatus = 'Facts' | 'Published' | 'Flagged'

export interface Report {
  month: string
  department: DepartmentKey
  facts: unknown
  headline: string | null
  observations: string[]
  actions: { title: string; why: string; href: string | null }[]
  status: ReportStatus
  unsupported: string[]
  generatedAt: Date
  model: string | null
}

type Row = {
  month: string; department: string; facts: string
  headline: string | null; observations: string | null; actions: string | null
  status: string; unsupported: string | null; generatedAt: Date; model: string | null
}

function hydrate(r: Row): Report {
  return {
    month: r.month,
    department: r.department as DepartmentKey,
    facts: JSON.parse(r.facts),
    headline: r.headline,
    observations: r.observations ? JSON.parse(r.observations) : [],
    actions: r.actions ? JSON.parse(r.actions) : [],
    status: r.status as ReportStatus,
    unsupported: r.unsupported ? JSON.parse(r.unsupported) : [],
    generatedAt: r.generatedAt,
    model: r.model,
  }
}

export interface GenerateOptions {
  /** Re-narrate from the STORED facts rather than recomputing them. */
  renarrate?: boolean
}

/**
 * Build one department's report.
 *
 * Two phases, deliberately separable. The facts are computed and saved first —
 * they are useful alone and carry no AI risk — and only then is the narrative
 * attempted. A missing key, a disabled assistant or a model failure downgrades
 * the report to facts-only; none of them loses the report.
 */
export async function generateReport(
  department: DepartmentKey,
  month: string,
  options: GenerateOptions = {},
): Promise<Report> {
  const existing = await db.monthlyReport.findUnique({ where: { month_department: { month, department } } })

  // Regenerating narrative from stored facts is the cheap path and the honest
  // one: the figures the owner already read do not move underneath them.
  const facts = options.renarrate && existing
    ? JSON.parse(existing.facts)
    : await buildDepartmentFacts(department, month)

  const base = {
    facts: JSON.stringify(facts),
    headline: null as string | null,
    observations: null as string | null,
    actions: null as string | null,
    status: 'Facts',
    unsupported: null as string | null,
    model: null as string | null,
    inputTokens: 0,
    outputTokens: 0,
    generatedAt: new Date(),
  }

  let payload = base
  const budget = await budgetState()
  const canNarrate = aiConfigured() && budget.limit > 0

  if (canNarrate) {
    try {
      const n = await narrateReport(department, month, facts)
      if (n.observations.length > 0 || n.headline) {
        const grounding = checkGrounding(narrationText(n), facts, month)
        payload = {
          ...base,
          headline: n.headline || null,
          observations: JSON.stringify(n.observations),
          actions: JSON.stringify(n.actions),
          status: grounding.ok ? 'Published' : 'Flagged',
          unsupported: grounding.ok ? null : JSON.stringify(grounding.unsupported),
          model: n.model,
          inputTokens: n.inputTokens,
          outputTokens: n.outputTokens,
        }
      }
    } catch (e) {
      // Facts still get written. A report that exists without prose beats no
      // report, and the status says which one this is.
      console.error(`report narration failed (${department} ${month}):`, e instanceof Error ? e.message : e)
    }
  }

  const row = await db.monthlyReport.upsert({
    where: { month_department: { month, department } },
    create: { month, department, ...payload },
    update: payload,
  })
  return hydrate(row)
}

/** All six departments for a month, sequentially — six Haiku calls, once a month. */
export async function generateMonth(month: string, options: GenerateOptions = {}): Promise<Report[]> {
  const out: Report[] = []
  for (const key of DEPARTMENT_KEYS) out.push(await generateReport(key, month, options))
  return out
}

export async function reportsForMonth(month: string): Promise<Report[]> {
  const rows = await db.monthlyReport.findMany({ where: { month } })
  const byKey = new Map(rows.map(r => [r.department, hydrate(r)]))
  // Returned in department order, not insertion order, so the page reads the
  // same way every month.
  return DEPARTMENT_KEYS.map(k => byKey.get(k)).filter((r): r is Report => !!r)
}

export async function reportedMonths(): Promise<string[]> {
  const rows = await db.monthlyReport.findMany({
    distinct: ['month'], select: { month: true }, orderBy: { month: 'desc' },
  })
  return rows.map(r => r.month)
}
