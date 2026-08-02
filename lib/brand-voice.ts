import type { AppConfig } from './config'

// ── M8 · Brand voice ─────────────────────────────────────────────────────────
// One profile, rendered into every prompt that produces text a human will read.
// Kept as a separate module rather than inlined into each caller so that adding
// a new generator (campaign copy, photo captions, message variants) is a one-line
// import instead of another hand-written personality that drifts from the others.
//
// Deliberately a prompt fragment, not a template engine: the voice is guidance
// for a model, and the owner edits it as prose in Business Settings.

/** The voice profile as prompt text. Empty fields are dropped rather than sent blank. */
export function voicePrompt(config: AppConfig): string {
  const { voice, business } = config
  const lines: [string, string][] = [
    ['Tone', voice.tone],
    ['Language', voice.languages],
    ['Emoji', voice.emoji],
    ['Signature moves', voice.signature],
    ['Never', voice.avoid],
  ]
  const body = lines
    .filter(([, v]) => v && v.trim() !== '')
    .map(([k, v]) => `- ${k}: ${v.trim()}`)
    .join('\n')

  if (body === '') return ''
  return `Write in ${business.name}'s brand voice:\n${body}`
}

/**
 * Voice guidance for customer-facing copy — a message the customer themselves
 * will read. Adds the one rule that matters more than any stylistic preference:
 * never invent a fact about someone's cat.
 */
export function customerVoicePrompt(config: AppConfig): string {
  const base = voicePrompt(config)
  const rule = 'Every detail about a cat, a booking or an amount must come from the record you were given — if you do not have it, leave it out rather than guessing.'
  return base ? `${base}\n- Accuracy: ${rule}` : `Accuracy: ${rule}`
}
