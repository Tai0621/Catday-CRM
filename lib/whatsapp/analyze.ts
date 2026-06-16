import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export interface LeadExtraction {
  type: 'BookingRequest' | 'Inquiry' | 'Complaint' | 'Reschedule' | 'Cancellation' | 'Other'
  summary: string
  proposedAction: string | null
  confidence: number
}

export async function analyzeWhatsAppMessage(content: string, senderPhone: string): Promise<LeadExtraction> {
  const model = process.env.WHATSAPP_ANALYSIS_MODEL ?? 'claude-haiku-4-5-20251001'

  const response = await client.messages.create({
    model,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `You are a CRM assistant for Catday, a premium cat grooming and boarding business in Malaysia.

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

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'

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
