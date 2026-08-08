import Anthropic from '@anthropic-ai/sdk'
import { recordUsage, budgetState } from '../ai/budget'
import { SERVICE_CATEGORIES, ROOM_TYPES, TIER_QUALIFICATIONS } from '../constants'
import { normalisePlan, type OnboardingPlan } from './plan'

// C6 · Generative cold start.
//
// ONE call producing every group, not one call per group. The roadmap sketched
// parallel agents; a single structured call is both six times cheaper and, more
// importantly, internally consistent — a service menu and the membership tiers
// that discount it have to agree with each other, and two agents writing them
// independently would not know they disagreed.

/** Types a customer actually reads a message for; the only ones worth templating on day one. */
export const TEMPLATE_TYPES = [
  'WinBack', 'RebookCheckout', 'GroomingDue', 'MembershipExpiry', 'Birthday', 'VaccinationExpiry',
] as const

export interface GeneratedPlan {
  plan: OnboardingPlan
  model: string
  inputTokens: number
  outputTokens: number
}

const planTool: Anthropic.Tool = {
  name: 'starting_configuration',
  description: 'Propose the complete starting configuration for this business.',
  input_schema: {
    type: 'object' as const,
    properties: {
      business: {
        type: 'object',
        properties: {
          name: { type: 'string' }, tagline: { type: 'string', description: 'Six words at most.' },
          phone: { type: 'string' }, address: { type: 'string' }, email: { type: 'string' },
          currencyCode: { type: 'string', description: 'ISO 4217, e.g. MYR' },
          currencySymbol: { type: 'string', description: 'e.g. RM' },
          locale: { type: 'string', description: 'e.g. en-MY' },
          timezone: { type: 'string', description: 'IANA, e.g. Asia/Kuala_Lumpur' },
          openHour: { type: 'number', description: '24h' }, closeHour: { type: 'number', description: '24h' },
        },
        required: ['name'],
      },
      services: {
        type: 'array',
        description: 'The service menu, priced. Cover what was described and nothing more.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: [...SERVICE_CATEGORIES] },
            durationMin: { type: 'number' },
            price: { type: 'number', description: 'In the local currency.' },
          },
          required: ['name', 'category', 'price'],
        },
      },
      rooms: {
        type: 'array',
        description: 'Boarding inventory. One entry per physical room, named as staff would say it.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: [...ROOM_TYPES] },
            capacity: { type: 'number', description: 'Cats it holds at once.' },
          },
          required: ['name'],
        },
      },
      tiers: {
        type: 'array',
        description: 'Membership tiers, cheapest first. Three is usually right.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }, tagline: { type: 'string' },
            qualification: { type: 'string', enum: [...TIER_QUALIFICATIONS] },
            annualSpendThreshold: { type: 'number', description: 'Only for a Spending tier.' },
            pointsMultiplier: { type: 'number' },
            benefits: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'qualification'],
        },
      },
      brand: {
        type: 'object',
        description: 'Two colours that suit the business described. Ink must be dark enough to read on cream.',
        properties: { primary: { type: 'string', description: '#RRGGBB' }, ink: { type: 'string', description: '#RRGGBB' } },
      },
      voice: {
        type: 'object',
        description: 'How this business should sound in writing.',
        properties: {
          tone: { type: 'string' }, languages: { type: 'string' }, emoji: { type: 'string' },
          signature: { type: 'string' }, avoid: { type: 'string' },
        },
      },
      templates: {
        type: 'array',
        description: 'Outbound message templates. Use {customer} {cat} {brand} {days} placeholders.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...TEMPLATE_TYPES] },
            label: { type: 'string', description: 'Short name for this wording.' },
            body: { type: 'string' },
          },
          required: ['type', 'label', 'body'],
        },
      },
      expenseGuidance: {
        type: 'array',
        description: 'Map this business\'s likely costs onto the fixed expense categories listed. Do not invent categories.',
        items: {
          type: 'object',
          properties: { category: { type: 'string' }, examples: { type: 'string' } },
          required: ['category'],
        },
      },
      notes: {
        type: 'array',
        description: 'Anything you had to guess and the owner must check.',
        items: { type: 'string' },
      },
    },
    required: ['business', 'services', 'rooms', 'tiers'],
  },
}

export async function generatePlan(description: string, expenseCategories: readonly string[]): Promise<GeneratedPlan> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('no-key')
  const budget = await budgetState()
  if (budget.limit === 0) throw new Error('ai-disabled')

  const client = new Anthropic()
  const model = process.env.AI_ASSISTANT_MODEL ?? 'claude-haiku-4-5-20251001'

  const system = `You configure a business operating system for a new client from a short description of their business.

You produce a STARTING POINT, which the owner reviews line by line and edits before anything is saved. That changes what good looks like:

- Prefer what they described over what is typical. If they named six rooms, propose six. If they gave a price range, use it — bottom of the range for the simplest service, top for the most involved.
- Guess concretely. A named, priced service the owner corrects in five seconds is more useful than a vague placeholder they have to invent from scratch.
- Do not pad. Extra services nobody offers are work to delete, and an owner who deletes six rows stops trusting the other forty.
- Where you had to guess something consequential — prices, opening hours, capacity — say so in notes. That is what notes are for.
- Expense guidance must map their costs onto these fixed categories, which cannot be changed: ${expenseCategories.join(', ')}.
- Message templates are read by their customers. Write them in the language the description implies, in the voice you propose, using the {customer} {cat} {brand} {days} placeholders.`

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system,
    tools: [planTool],
    tool_choice: { type: 'tool', name: 'starting_configuration' },
    messages: [{ role: 'user', content: description.slice(0, 2000) }],
  })

  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  await recordUsage(inputTokens, outputTokens)

  const call = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  const plan = normalisePlan(call?.input ?? {}, TEMPLATE_TYPES)
  if (plan.services.length === 0 && !plan.business.name) throw new Error('empty-plan')

  return { plan, model, inputTokens, outputTokens }
}
