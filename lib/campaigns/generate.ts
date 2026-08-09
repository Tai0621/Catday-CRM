import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, aiModel, aiConfigured } from '../ai/provider'
import { getConfig } from '../config'
import { customerVoicePrompt } from '../brand-voice'
import { budgetState, recordUsage } from '../ai/budget'
import { SYSTEM_GROUPS } from '../customer-groups'
import { campaignFacts, offerEconomics, type CampaignFacts, type ServiceMargin } from './facts'

// M1 · Two or three offer structures from one sentence of intent.
//
// The model chooses SHAPE — which service, which days, which audience, how deep
// a discount, and the words. It computes nothing: the capacity and margin it
// reasons over are handed to it, and every offer it returns is re-costed here
// against the same facts before anyone sees a number.

export const OFFER_TYPES = ['Discount', 'FreeAddOn', 'Bundle', 'Credit'] as const
export type OfferType = (typeof OFFER_TYPES)[number]

/** A discount deeper than this is a decision to take to the owner in person, not a suggestion. */
export const MAX_PROPOSED_DISCOUNT_PCT = 40

export interface ProposedOffer {
  name: string
  offerType: OfferType
  serviceId: string | null
  serviceName: string | null
  discountPct: number
  targetGroupKey: string | null
  targetWeekdays: string[]
  message: string
  rationale: string
  economics: ReturnType<typeof offerEconomics> | null
}

export interface GeneratedCampaigns {
  offers: ProposedOffer[]
  facts: CampaignFacts
  model: string
  inputTokens: number
  outputTokens: number
}

const offersTool: Anthropic.Tool = {
  name: 'offer_structures',
  description: 'Propose two or three distinct offer structures.',
  input_schema: {
    type: 'object' as const,
    properties: {
      offers: {
        type: 'array',
        description: 'Two or three offers that differ in SHAPE, not just in discount depth.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short internal name, e.g. "Midweek boarding fill".' },
            offerType: { type: 'string', enum: [...OFFER_TYPES] },
            serviceName: { type: 'string', description: 'Exactly one of the service names given.' },
            discountPct: { type: 'number', description: 'Percent off. Use 0 for a free add-on or a bundle.' },
            targetGroupKey: { type: 'string', description: 'One of the audience keys given, or omit.' },
            targetWeekdays: {
              type: 'array', items: { type: 'string' },
              description: 'The weekdays this offer is meant to fill.',
            },
            message: { type: 'string', description: 'The WhatsApp message, ready to send. {customer} and {cat} are filled in per recipient.' },
            rationale: { type: 'string', description: 'One sentence: which figure in the data makes this the right shape.' },
          },
          required: ['name', 'offerType', 'serviceName', 'message', 'rationale'],
        },
      },
    },
    required: ['offers'],
  },
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}
const str = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)

export type GenerateResult =
  | { ok: true; result: GeneratedCampaigns }
  | { ok: false; reason: 'no-key' | 'ai-disabled' | 'empty' | 'failed'; detail?: string }

export async function generateOffers(
  intent: string,
  fromISO: string,
  toISO: string,
  audiences: { key: string; name: string; size: number; sendable: number }[],
): Promise<GenerateResult> {
  const trimmed = intent.trim()
  if (trimmed.length < 10) return { ok: false, reason: 'empty' }
  if (!aiConfigured()) return { ok: false, reason: 'no-key' }
  const budget = await budgetState()
  if (budget.limit === 0) return { ok: false, reason: 'ai-disabled' }

  const facts = await campaignFacts(fromISO, toISO, audiences)
  const config = await getConfig()
  const model = aiModel()

  const system = `You design promotions for ${config.business.name}, a premium cat grooming and boarding business.

You are given real capacity and real margin. Use them:

- Target the days that are actually slack. Discounting a day that is already busy displaces a booking that would have arrived at full price — never propose it, and say so if the intent asks for it.
- Respect margin. A service whose contribution is thin cannot carry a deep discount; prefer a free add-on or a bundle there.
- Propose offers that differ in SHAPE — a discount, a free add-on and a bundle are three different bets. Three variations on "10% off" are one offer written three times.
- Never invent a figure. You have prices, contributions and utilisation; you do not have a conversion rate, so do not predict uptake or revenue.
- Discounts above ${MAX_PROPOSED_DISCOUNT_PCT}% are out of range.

${customerVoicePrompt(config)}`

  const prompt = `INTENT: ${trimmed}

FACTS (the only numbers you may use):
${JSON.stringify(facts, null, 1)}`

  try {
    const response = await createMessage({
      model, max_tokens: 2000, system,
      tools: [offersTool],
      tool_choice: { type: 'tool', name: 'offer_structures' },
      messages: [{ role: 'user', content: prompt }],
    })

    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    await recordUsage(inputTokens, outputTokens)

    const call = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
    const raw = ((call?.input ?? {}) as { offers?: unknown }).offers
    const offers = normaliseOffers(Array.isArray(raw) ? raw : [], facts)
    if (offers.length === 0) return { ok: false, reason: 'empty' }

    return { ok: true, result: { offers, facts, model, inputTokens, outputTokens } }
  } catch (e) {
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Validate and RE-COST every offer.
 *
 * The model's own arithmetic is never displayed: the economics shown on screen
 * are recomputed here from the same facts, so a number the owner reads is one
 * the OS stands behind. An offer naming a service that does not exist, or an
 * audience key that is not real, is dropped rather than shown with a blank.
 */
function normaliseOffers(raw: unknown[], facts: CampaignFacts): ProposedOffer[] {
  const byName = new Map(facts.services.map(s => [s.name.toLowerCase(), s]))
  const groupKeys = new Set(SYSTEM_GROUPS.map(g => g.key))
  const audienceSize = new Map(facts.audiences.map(a => [a.key, a.sendable]))
  const weekdays = new Map(facts.byWeekday.map(d => [d.weekday.toLowerCase(), d]))

  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map(o => {
      const service: ServiceMargin | undefined = byName.get(str(o.serviceName, 60).toLowerCase())
      const offerType = (OFFER_TYPES as readonly string[]).includes(String(o.offerType))
        ? String(o.offerType) as OfferType
        : 'Discount'
      // A free add-on or bundle is not a percentage off the named service.
      const discountPct = offerType === 'Discount'
        ? Math.round(clamp(o.discountPct, 0, MAX_PROPOSED_DISCOUNT_PCT, 0))
        : 0

      const groupKey = groupKeys.has(String(o.targetGroupKey)) ? String(o.targetGroupKey) : null
      const targetWeekdays = (Array.isArray(o.targetWeekdays) ? o.targetWeekdays : [])
        .map(d => str(d, 12))
        .filter(d => weekdays.has(d.toLowerCase()))
        .slice(0, 7)

      const days = targetWeekdays.map(d => weekdays.get(d.toLowerCase())!).filter(Boolean)
      const size = groupKey ? audienceSize.get(groupKey) ?? 0 : 0

      return {
        name: str(o.name, 80),
        offerType,
        serviceId: service?.id ?? null,
        serviceName: service?.name ?? null,
        discountPct,
        targetGroupKey: groupKey,
        targetWeekdays,
        message: str(o.message, 700),
        rationale: str(o.rationale, 300),
        economics: service ? offerEconomics(service, discountPct, size, facts.messageCostRM, days) : null,
      }
    })
    .filter(o => o.name && o.message && o.serviceName)
    .slice(0, 3)
}
