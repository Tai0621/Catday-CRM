import { getConfig } from '../config'
import { createMessage, aiModel } from '../ai/provider'

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
  // The override is only meaningful on Anthropic; on any other provider the
  // active model is used, or every inbound message would fail on a bad id.
  const override = process.env.WHATSAPP_ANALYSIS_MODEL?.trim()
  const model = override?.startsWith('claude-') ? override : aiModel()
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
