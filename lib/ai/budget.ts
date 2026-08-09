import { db } from '../db'
import { getConfig } from '../config'
import { aiConfigured } from './provider'

// ── C1 · AI spend control ────────────────────────────────────────────────────
// The copilot is reachable from every page, so a stuck loop or a busy afternoon
// could run up real cost on a tenant who never agreed to it. Two rules:
//
//   1. Checked BEFORE the call, recorded AFTER it, against actual token counts
//      returned by the API — not an estimate.
//   2. A budget of zero disables the assistant entirely. It disappears rather
//      than erroring, which is also how a tenant who does not want AI turns it
//      off without a deploy.
//
// Fails CLOSED: if the budget cannot be read, the assistant does not run.

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface BudgetState {
  enabled: boolean
  configured: boolean // an API key exists
  limit: number
  used: number
  remaining: number
}

export async function budgetState(now: Date = new Date()): Promise<BudgetState> {
  const configured = aiConfigured()
  const { ai } = await getConfig()
  const limit = Math.max(0, Math.floor(ai.dailyTokenBudget))

  if (limit === 0) return { enabled: false, configured, limit: 0, used: 0, remaining: 0 }

  const row = await db.aiUsage.findUnique({
    where: { date: dayKey(now) },
    select: { inputTokens: true, outputTokens: true },
  })
  const used = (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0)

  return {
    configured,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    enabled: configured && used < limit,
  }
}

/** Accumulate real usage for today. Upsert so the first call of a day creates the row. */
export async function recordUsage(inputTokens: number, outputTokens: number, now: Date = new Date()): Promise<void> {
  const date = dayKey(now)
  await db.aiUsage.upsert({
    where: { date },
    create: { date, inputTokens, outputTokens, calls: 1 },
    update: {
      inputTokens: { increment: inputTokens },
      outputTokens: { increment: outputTokens },
      calls: { increment: 1 },
    },
  })
}
