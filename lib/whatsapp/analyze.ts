import { getConfig } from '../config'
import { createMessage, aiModel, providerModelOverride } from '../ai/provider'

// The client used to be constructed at module scope, which made merely
// importing this file throw on a deployment with no key. It is created per call
// inside the provider now.

export interface LeadExtraction {
  type: 'BookingRequest' | 'Inquiry' | 'Complaint' | 'Reschedule' | 'Cancellation' | 'Other'
  summary: string
  proposedAction: string | null
  confidence: number
}

export async function analyzeWhatsAppMessage(content: string, senderPhone: string): Promise<LeadExtraction> {
  // The override is only meaningful on the provider it names. The test is which
  // provider is ACTIVE, not what the id looks like: a `claude-…` id left over
  // from before a switch used to be honoured on Groq, which 404s on every
  // inbound message — and the caller swallows that, so the endpoint reported
  // success while creating no leads at all.
  const model = providerModelOverride(process.env.WHATSAPP_ANALYSIS_MODEL) ?? aiModel()
  const { business } = await getConfig()

  const response = await createMessage({
    model,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `You are a CRM assistant for ${business.name}, a premium cat grooming and boarding business.

Analyse this WhatsApp message and extract the lead information.

Phone: ${senderPhone}
Message: ${content}

Respond with ONLY valid JSON in this exact format:
{
  "type": "BookingRequest" | "Inquiry" | "Complaint" | "Reschedule" | "Cancellation" | "Other",
  "summary": "one sentence summary of what the customer wants",
  "proposedAction": "what staff should do, or null if unclear",
  "confidence": 0.0 to 1.0
}`,
      },
    ],
  })

  const first = response.content[0]
  const text = first && first.type === 'text' ? first.text : '{}'

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')
    return JSON.parse(jsonMatch[0]) as LeadExtraction
  } catch {
    return {
      type: 'Other',
      summary: content.slice(0, 100),
      proposedAction: null,
      confidence: 0.3,
    }
  }
}
