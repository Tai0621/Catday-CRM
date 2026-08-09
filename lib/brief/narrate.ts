import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, aiModel } from '../ai/provider'
import { getConfig } from '../config'
import { recordUsage } from '../ai/budget'
import type { BriefFacts } from './facts'

// ── C5 · Turning facts into a brief ──────────────────────────────────────────
//
// One call. The model receives the computed facts and is asked to interpret
// them — never to supply them. It cannot reach the database, so the worst it
// can do is misread a number that is stored next to its output for comparison.
//
// Deliberately NOT using the M8 brand voice: that profile shapes what customers
// read. This is an internal note to the owner, and dressing an occupancy figure
// in marketing tone would make it harder to scan, not easier.

/**
 * Where a recommendation may point. The model picks from this list and nothing
 * else — an invented href is a dead link in the one place the owner is most
 * likely to click, and "/dashboard/insights" is exactly the sort of plausible
 * route a model produces.
 */
export const BRIEF_LINKS: Record<string, string> = {
  '/actions': 'Action Inbox — the queue of customers needing contact',
  '/runsheet': 'Run sheet — today\'s boarding rounds',
  '/appointments': 'Appointments — the booking diary',
  '/customers': 'Customers — profiles and segments',
  '/marketing/groups': 'Customer groups — targeted outreach lists',
  '/products': 'Products — stock levels and reorder thresholds',
  '/finance/income-statement': 'Income statement — revenue and costs',
  '/finance/expenses': 'Expenses — recorded costs',
  '/finance/aging': 'A/R and A/P aging — who owes what',
  '/revenue': 'Revenue — the transaction ledger',
  '/rooms': 'Rooms — occupancy and the boarding calendar',
  '/incidents': 'Incidents — unresolved complaints and issues',
  '/hr/attendance': 'Attendance — staff clock-ins and hours',
}

export interface BriefNarration {
  observations: string[]
  actions: { title: string; why: string; href: string | null }[]
  model: string
  inputTokens: number
  outputTokens: number
}

const briefTool: Anthropic.Tool = {
  name: 'daily_brief',
  description: 'Record the finished brief.',
  input_schema: {
    type: 'object' as const,
    properties: {
      observations: {
        type: 'array',
        description: 'Exactly three things worth knowing about yesterday, most important first. One sentence each.',
        items: { type: 'string' },
      },
      actions: {
        type: 'array',
        description: 'Exactly three things to do today, most important first.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The action, as an instruction. Under 60 characters.' },
            why: { type: 'string', description: 'One sentence: which fact makes this worth doing.' },
            href: { type: 'string', description: 'A page from the provided list, or omit if none fits.' },
          },
          required: ['title', 'why'],
        },
      },
    },
    required: ['observations', 'actions'],
  },
}

export async function narrateBrief(facts: BriefFacts): Promise<BriefNarration> {
  const model = aiModel()
  const { business, currency } = await getConfig()

  const system = `You write the morning brief for ${business.name}, a premium cat grooming and boarding business. The reader is the owner, opening the OS with a coffee. Currency is ${currency.symbol}.

You are given yesterday's figures, already computed. Interpret them — never invent, restate or recompute a number that is not in the data. If something is not in the data, it is not in the brief.

Be specific and short. "Boarding was RM 340 below its four-week Saturday average" beats "revenue was down". Say what is unusual, not what is normal: a figure in line with its baseline is not an observation. If yesterday was genuinely unremarkable, say so plainly in one observation and spend the others on what is building up — overdue payments, low stock, the action queue.

Actions must be things the reader can do today, drawn from the data. Do not recommend anything requiring information you were not given. Attach a page only from the list provided.`

  const links = Object.entries(BRIEF_LINKS).map(([href, what]) => `${href} — ${what}`).join('\n')
  const prompt = `Yesterday (${facts.weekday} ${facts.date}):\n\n${JSON.stringify(facts, null, 1)}\n\nPages you may link to:\n${links}`

  const response = await createMessage({
    model,
    max_tokens: 1200,
    system,
    tools: [briefTool],
    tool_choice: { type: 'tool', name: 'daily_brief' },
    messages: [{ role: 'user', content: prompt }],
  })

  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  await recordUsage(inputTokens, outputTokens)

  const call = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  const raw = (call?.input ?? {}) as { observations?: unknown; actions?: unknown }

  const observations = Array.isArray(raw.observations)
    ? raw.observations.filter(o => typeof o === 'string' && o.trim()).slice(0, 3) as string[]
    : []

  const actions = Array.isArray(raw.actions)
    ? raw.actions
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map(a => ({
        title: String(a.title ?? '').trim().slice(0, 120),
        why: String(a.why ?? '').trim().slice(0, 300),
        // Dropped rather than corrected: a link to the wrong page is worse than none.
        href: typeof a.href === 'string' && a.href in BRIEF_LINKS ? a.href : null,
      }))
      .filter(a => a.title)
      .slice(0, 3)
    : []

  return { observations, actions, model, inputTokens, outputTokens }
}
