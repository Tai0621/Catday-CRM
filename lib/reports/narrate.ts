import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, aiModel, aiConfigured } from '../ai/provider'
import { getConfig } from '../config'
import { voicePrompt } from '../brand-voice'
import { recordUsage } from '../ai/budget'
import { departmentByKey, type DepartmentKey } from './facts'
import { monthLabel } from './period'

// C9 · One Haiku call per department. The model receives computed facts and
// writes prose about them. It has no database access and no calculator, and
// whatever it produces is put through the grounding check before anyone sees it.

export interface ReportNarration {
  headline: string
  observations: string[]
  actions: { title: string; why: string; href: string | null }[]
  model: string
  inputTokens: number
  outputTokens: number
}

const reportTool: Anthropic.Tool = {
  name: 'department_report',
  description: 'Record the finished report.',
  input_schema: {
    type: 'object' as const,
    properties: {
      headline: { type: 'string', description: 'One sentence summing the month up. Under 100 characters.' },
      observations: {
        type: 'array', description: 'Exactly three findings, most important first. One or two sentences each.',
        items: { type: 'string' },
      },
      actions: {
        type: 'array', description: 'Exactly three things to do about it, most important first.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The action, as an instruction. Under 70 characters.' },
            why: { type: 'string', description: 'One sentence: which finding makes this worth doing.' },
            href: { type: 'string', description: 'A page from the provided list, or omit if none fits.' },
          },
          required: ['title', 'why'],
        },
      },
    },
    required: ['headline', 'observations', 'actions'],
  },
}

export async function narrateReport(
  department: DepartmentKey,
  month: string,
  facts: unknown,
): Promise<ReportNarration> {
  const dept = departmentByKey(department)
  if (!dept) throw new Error(`Unknown department ${department}`)

  const model = aiModel()
  const config = await getConfig()
  const { business, currency } = config

  // M8's voice profile applies, but subordinated twice over: this is an
  // internal record that may end up in front of an accountant, so accuracy
  // beats tone and plainness beats personality. Without that ordering a
  // never-say list intended for marketing copy starts editing a variance
  // explanation.
  const voice = voicePrompt(config)

  const system = `You write the monthly ${dept.label} report for ${business.name}, a premium cat grooming and boarding business. The reader is the owner. Currency is ${currency.symbol}.

You are given the month's figures, already computed. Your job is to say what they mean.

The rules, in order of precedence:
1. NEVER state a number that is not in the data. Do not add, subtract, average, or convert anything into a percentage. Every figure you might reasonably want has already been computed for you — if a number is not in the data, you may not use it. Prose containing an unsupported figure is rejected outright, so quote sparingly and exactly.
2. Be plain. This is a record, not a pitch. Short sentences, no throat-clearing, no restating the department's name back at the reader.
3. Say what is unusual or worth acting on. A figure in line with the previous month is not a finding. If the month was genuinely uneventful, say so in one observation and spend the rest on what is accumulating.
4. Actions must follow from the findings and be doable this month.
${voice ? `\nThe business's written voice, for tone only — it never overrides rules 1 to 3, and never applies to a figure:\n${voice}` : ''}`

  const links = dept.links.map(l => `${l}`).join('\n')
  const prompt = `${dept.label} — ${monthLabel(month)}
This department covers ${dept.brief}.

FIGURES (the only numbers you may use):
${JSON.stringify(facts, null, 1)}

Pages you may link an action to:
${links}`

  const response = await createMessage({
    model,
    max_tokens: 1500,
    system,
    tools: [reportTool],
    tool_choice: { type: 'tool', name: 'department_report' },
    messages: [{ role: 'user', content: prompt }],
  })

  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  await recordUsage(inputTokens, outputTokens)

  const call = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  const raw = (call?.input ?? {}) as Record<string, unknown>
  const allowedLinks = new Set<string>(dept.links)

  return {
    headline: String(raw.headline ?? '').trim().slice(0, 200),
    observations: Array.isArray(raw.observations)
      ? raw.observations.filter(o => typeof o === 'string' && o.trim()).slice(0, 3) as string[]
      : [],
    actions: Array.isArray(raw.actions)
      ? raw.actions
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map(a => ({
          title: String(a.title ?? '').trim().slice(0, 150),
          why: String(a.why ?? '').trim().slice(0, 400),
          href: typeof a.href === 'string' && allowedLinks.has(a.href) ? a.href : null,
        }))
        .filter(a => a.title)
        .slice(0, 3)
      : [],
    model, inputTokens, outputTokens,
  }
}

/** Everything the grounding check reads — the prose, and only the prose. */
export function narrationText(n: Pick<ReportNarration, 'headline' | 'observations' | 'actions'>): string {
  return [n.headline, ...n.observations, ...n.actions.flatMap(a => [a.title, a.why])].join('\n')
}
