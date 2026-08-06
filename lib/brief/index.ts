import { db } from '../db'
import { getConfig } from '../config'
import { budgetState } from '../ai/budget'
import { buildBriefFacts, briefDayKey, type BriefFacts } from './facts'
import { narrateBrief } from './narrate'

export { buildBriefFacts, briefDayKey, type BriefFacts }
export { BRIEF_LINKS } from './narrate'

export interface Brief {
  date: string
  createdAt: Date
  facts: BriefFacts
  observations: string[]
  actions: { title: string; why: string; href: string | null }[]
}

export type BriefOutcome =
  | { ok: true; brief: Brief; reused: boolean }
  | { ok: false; reason: 'no-key' | 'ai-disabled' | 'failed'; detail?: string }

function hydrate(row: {
  date: string; createdAt: Date; facts: string; observations: string; actions: string
}): Brief {
  return {
    date: row.date,
    createdAt: row.createdAt,
    facts: JSON.parse(row.facts) as BriefFacts,
    observations: JSON.parse(row.observations) as string[],
    actions: JSON.parse(row.actions) as Brief['actions'],
  }
}

/**
 * Write the brief for one business day.
 *
 * Idempotent by date. A cron retry, a manual "generate now", and a duplicate
 * scheduled invocation all return the stored row rather than paying for a
 * second call — the reason the unique index on `date` exists.
 */
export async function generateBrief(dayKey: string): Promise<BriefOutcome> {
  const existing = await db.dailyBrief.findUnique({ where: { date: dayKey } })
  if (existing) return { ok: true, brief: hydrate(existing), reused: true }

  // Fails closed, and is not faked: without a key there is no brief, rather
  // than a template with the numbers dropped in. The value of this feature is
  // the reading of the data, not the reprinting of it.
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no-key' }

  // A budget of zero means the tenant has switched AI off, and that covers the
  // brief too. Exhaustion does NOT: the ceiling exists to cap unbounded
  // interactive use, and one scheduled call a day is bounded by construction.
  // Losing the morning brief because someone asked the assistant twenty
  // questions yesterday would make the most valuable output the least reliable.
  const budget = await budgetState()
  if (budget.limit === 0) return { ok: false, reason: 'ai-disabled' }

  const facts = await buildBriefFacts(dayKey)

  let narration
  try {
    narration = await narrateBrief(facts)
  } catch (e) {
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) }
  }
  if (narration.observations.length === 0 && narration.actions.length === 0) {
    return { ok: false, reason: 'failed', detail: 'the model returned nothing usable' }
  }

  const row = await db.dailyBrief.create({
    data: {
      date: dayKey,
      facts: JSON.stringify(facts),
      observations: JSON.stringify(narration.observations),
      actions: JSON.stringify(narration.actions),
      model: narration.model,
      inputTokens: narration.inputTokens,
      outputTokens: narration.outputTokens,
    },
  })
  return { ok: true, brief: hydrate(row), reused: false }
}

/** The day the next scheduled run would cover. */
export async function pendingBriefDay(now: Date = new Date()): Promise<string> {
  const { timezone } = await getConfig()
  return briefDayKey(now, timezone)
}

/** The most recent brief, for the dashboard. */
export async function latestBrief(): Promise<Brief | null> {
  const row = await db.dailyBrief.findFirst({ orderBy: { date: 'desc' } })
  return row ? hydrate(row) : null
}

export async function recentBriefs(take = 14): Promise<Brief[]> {
  const rows = await db.dailyBrief.findMany({ orderBy: { date: 'desc' }, take })
  return rows.map(hydrate)
}
