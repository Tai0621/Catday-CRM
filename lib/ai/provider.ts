import Anthropic from '@anthropic-ai/sdk'

// ── The model provider seam ──────────────────────────────────────────────────
//
// Every AI call in the OS goes through `createMessage`. Production runs on
// Anthropic; the demo can run on Groq, which is fast and cheap enough to leave
// switched on for prospects to poke at.
//
// Groq does NOT speak Anthropic's Messages API — it is OpenAI-compatible — so
// this is a translation layer, not a base-URL swap. Pointing the Anthropic SDK
// at Groq would fail on the first request: different request shape, different
// response shape, different names for tool calls and token counts.
//
// The seam presents the ANTHROPIC shape to callers, because that is what the
// eight call sites already speak and Anthropic is what production uses. The
// translation lives here and nowhere else.
//
// No new dependency: Groq is reached with plain fetch against its
// OpenAI-compatible endpoint.

export type AiProvider = 'anthropic' | 'groq'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * Prefix on the error thrown when the provider is rate limited rather than
 * broken. Callers test with `isBusy` and say "try again in a moment".
 */
const BUSY = 'provider-busy'
export const isBusy = (e: unknown): boolean =>
  e instanceof Error && e.message.startsWith(BUSY)

const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
// gpt-oss-120b rather than llama-3.3-70b: the copilot offers thirteen tools at
// once, and llama repeatedly emitted malformed calls under that load — packing
// the arguments into the function NAME, which Groq rejects server-side. It also
// inverted the meaning of empty results ("no customers have visited in 90 days"
// for "no customers are overdue"). gpt-oss answers the same questions with
// figures that match the database exactly.
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'

/**
 * Which provider this deployment uses.
 *
 * `AI_PROVIDER` decides when set. Otherwise Anthropic wins if its key is
 * present — a deployment that has both must never silently drift onto the
 * cheaper one.
 */
export function aiProvider(): AiProvider {
  const declared = (process.env.AI_PROVIDER ?? '').toLowerCase()
  if (declared === 'groq') return 'groq'
  if (declared === 'anthropic') return 'anthropic'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.GROQ_API_KEY) return 'groq'
  return 'anthropic'
}

/** Is there a usable key for the active provider? Every AI feature fails closed on this. */
export function aiConfigured(): boolean {
  return aiProvider() === 'groq' ? !!process.env.GROQ_API_KEY : !!process.env.ANTHROPIC_API_KEY
}

/**
 * The model to call.
 *
 * `AI_ASSISTANT_MODEL` overrides, but only when it plausibly belongs to the
 * active provider: an environment carrying a `claude-…` id from before the
 * switch would otherwise 404 on every request, and the failure would look like
 * a broken feature rather than a stale variable.
 */
export function aiModel(): string {
  const provider = aiProvider()
  return providerModelOverride(process.env.AI_ASSISTANT_MODEL)
    ?? (provider === 'groq' ? GROQ_DEFAULT_MODEL : ANTHROPIC_DEFAULT_MODEL)
}

/**
 * A model id from the environment, or null when it does not belong to the
 * active provider.
 *
 * Every per-feature override goes through this. The rule looks small enough to
 * reimplement at the call site, and doing so is how `WHATSAPP_ANALYSIS_MODEL`
 * came to test the SHAPE of the id instead of the active provider — honouring a
 * `claude-…` id on a Groq deployment, which 404s on every call.
 */
export function providerModelOverride(raw: string | undefined): string | null {
  const override = raw?.trim()
  if (!override) return null
  const looksAnthropic = override.startsWith('claude-')
  return (aiProvider() === 'anthropic') === looksAnthropic ? override : null
}

export interface CreateMessageParams {
  model?: string
  max_tokens: number
  system?: string
  tools?: Anthropic.Tool[]
  tool_choice?: { type: 'tool'; name: string } | { type: 'auto' }
  messages: Anthropic.MessageParam[]
}

/** The Anthropic-shaped subset the callers actually read back. */
export interface AiResponse {
  content: (Anthropic.TextBlock | Anthropic.ToolUseBlock)[]
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number }
}

export async function createMessage(params: CreateMessageParams): Promise<AiResponse> {
  return aiProvider() === 'groq' ? viaGroq(params) : viaAnthropic(params)
}

// ── Anthropic: pass through ──────────────────────────────────────────────────

async function viaAnthropic(params: CreateMessageParams): Promise<AiResponse> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: params.model ?? aiModel(),
    max_tokens: params.max_tokens,
    ...(params.system ? { system: params.system } : {}),
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
    messages: params.messages,
  }).catch((e: unknown) => {
    // Both providers report a rate limit the same way to callers, so the UI
    // says "busy" rather than "failed" whichever one is behind the seam.
    const status = (e as { status?: number })?.status
    if (status === 429 || status === 529) {
      throw new Error(`${BUSY}: ${e instanceof Error ? e.message : String(e)}`)
    }
    throw e
  })
  return {
    content: response.content.filter(
      (b): b is Anthropic.TextBlock | Anthropic.ToolUseBlock => b.type === 'text' || b.type === 'tool_use'),
    stop_reason: response.stop_reason,
    usage: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
    },
  }
}

// ── Groq: translate both ways ────────────────────────────────────────────────

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * Anthropic messages → OpenAI messages.
 *
 * The subtle part is the tool round trip. Anthropic carries a tool result as a
 * `tool_result` block inside a USER message; OpenAI wants a separate message
 * with `role: 'tool'` and a `tool_call_id` matching the call. Getting that
 * pairing wrong does not error — the model simply loses the result and answers
 * as though the tool returned nothing.
 */
function toOpenAiMessages(system: string | undefined, messages: Anthropic.MessageParam[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  if (system) out.push({ role: 'system', content: system })

  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content } as OpenAiMessage)
      continue
    }

    if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text).join('\n')
      const toolCalls: OpenAiToolCall[] = m.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({
          id: b.id, type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }))
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    // A user turn: plain text blocks, plus any tool results promoted to their
    // own `tool` messages.
    const text: string[] = []
    for (const block of m.content) {
      if (block.type === 'text') { text.push(block.text); continue }
      if (block.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content ?? ''),
        })
      }
    }
    if (text.length > 0) out.push({ role: 'user', content: text.join('\n') })
  }
  return out
}

async function viaGroq(params: CreateMessageParams): Promise<AiResponse> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('no-key')

  const tools = params.tools?.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))

  const toolChoice = params.tool_choice?.type === 'tool'
    ? { type: 'function' as const, function: { name: params.tool_choice.name } }
    : tools && tools.length > 0 ? 'auto' as const : undefined

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: params.model ?? aiModel(),
      max_tokens: params.max_tokens,
      messages: toOpenAiMessages(params.system, params.messages),
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    }),
  })

  const json = await res.json().catch(() => null)
  if (!res.ok || json?.error) {
    const detail = json?.error?.message ?? `HTTP ${res.status}`
    // A rate limit is "come back in a moment", not a broken feature, and on a
    // small free tier it is the FIRST thing a visitor hits: one copilot
    // question carries a dozen tool schemas. 403 is here too because the edge
    // blocks a burst before the API ever sees it.
    if (res.status === 429 || res.status === 403) throw new Error(`${BUSY}: ${detail}`)
    // Otherwise verbatim: a wrong model id or a tool-less model is the likely
    // failure, and "Bad Request" alone would send someone hunting in the wrong
    // layer.
    throw new Error(`groq: ${detail}`)
  }

  const choice = json.choices?.[0]
  const message = choice?.message ?? {}
  const content: (Anthropic.TextBlock | Anthropic.ToolUseBlock)[] = []

  if (typeof message.content === 'string' && message.content.trim()) {
    content.push({ type: 'text', text: message.content, citations: null } as Anthropic.TextBlock)
  }
  for (const call of (message.tool_calls ?? []) as OpenAiToolCall[]) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      // Arguments arrive as a JSON STRING. A model that emits malformed JSON
      // becomes an empty input rather than an exception, so the caller's own
      // validation reports it as an unusable answer.
      input: safeJson(call.function.arguments),
    } as Anthropic.ToolUseBlock)
  }

  return {
    content,
    stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : choice?.finish_reason ?? null,
    usage: {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    },
  }
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
