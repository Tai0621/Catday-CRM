import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, aiModel, aiConfigured } from '../ai/provider'
import { db } from '../db'
import { getConfig } from '../config'
import { customerVoicePrompt } from '../brand-voice'
import { budgetState, recordUsage } from '../ai/budget'
import { candidateFor } from './studio'

// M3 · One Haiku call per draft.
//
// The caption is written in the BUSINESS's brand voice and its own language —
// deliberately not the customer's (M9). A post is addressed to the followers,
// not to the household in the photograph, so translating it into their language
// would be writing the shop's Instagram in whatever language its most recent
// client happens to speak.
//
// Facts come from the record. The accuracy rule in customerVoicePrompt already
// forbids inventing a detail about a cat, which matters more here than usual:
// the owner of that cat will read this post.

export interface CaptionDraft {
  caption: string
  hashtags: string[]
  model: string
  inputTokens: number
  outputTokens: number
}

const captionTool: Anthropic.Tool = {
  name: 'social_post',
  description: 'Record the drafted post.',
  input_schema: {
    type: 'object' as const,
    properties: {
      caption: {
        type: 'string',
        description: 'The post text. Two or three short sentences at most — this sits under a photograph, not instead of one.',
      },
      hashtags: {
        type: 'array',
        description: 'Four to eight hashtags, lowercase, no punctuation beyond the hash.',
        items: { type: 'string' },
      },
    },
    required: ['caption', 'hashtags'],
  },
}

export type CaptionResult =
  | { ok: true; draft: CaptionDraft }
  | { ok: false; reason: 'no-key' | 'ai-disabled' | 'not-eligible' | 'failed'; detail?: string }

export async function draftCaption(appointmentId: string): Promise<CaptionResult> {
  // Re-checked here, not just at render: consent may have been withdrawn since
  // the page was drawn, and this is the call that spends money on it.
  const candidate = await candidateFor(appointmentId)
  if (!candidate) return { ok: false, reason: 'not-eligible' }

  if (!aiConfigured()) return { ok: false, reason: 'no-key' }
  const budget = await budgetState()
  if (budget.limit === 0) return { ok: false, reason: 'ai-disabled' }

  const config = await getConfig()
  const model = aiModel()

  const system = `You write the caption for a before/after grooming photograph posted by ${config.business.name}.

${customerVoicePrompt(config)}

This sits under a picture, so it does not need to describe what is visible. Say something worth reading: what the groom involved, what changed, or a small true detail about the cat. Never claim anything about the cat's health, temperament or history that is not in the data you were given, and never imply the cat was neglected before — the owner is reading this.`

  const facts = {
    cat: candidate.catName,
    breed: candidate.breed ?? 'unrecorded',
    coat: candidate.coatType ?? 'unrecorded',
    service: candidate.serviceName,
    date: candidate.date.toLocaleDateString(config.currency.locale, { day: 'numeric', month: 'long' }),
  }

  try {
    const response = await createMessage({
      model,
      max_tokens: 600,
      system,
      tools: [captionTool],
      tool_choice: { type: 'tool', name: 'social_post' },
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 1) }],
    })

    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    await recordUsage(inputTokens, outputTokens)

    const call = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
    const raw = (call?.input ?? {}) as { caption?: unknown; hashtags?: unknown }
    const caption = String(raw.caption ?? '').trim().slice(0, 600)
    if (!caption) return { ok: false, reason: 'failed', detail: 'the model returned no caption' }

    const hashtags = Array.isArray(raw.hashtags)
      ? raw.hashtags
        .map(h => `#${String(h).trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`)
        .filter(h => h.length > 1)
        .slice(0, 8)
      : []

    await db.contentDraft.upsert({
      where: { appointmentId },
      create: { appointmentId, caption, hashtags: JSON.stringify(hashtags), model, inputTokens, outputTokens },
      update: { caption, hashtags: JSON.stringify(hashtags), status: 'Draft', model, inputTokens, outputTokens },
    })

    return { ok: true, draft: { caption, hashtags, model, inputTokens, outputTokens } }
  } catch (e) {
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) }
  }
}
