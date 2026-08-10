import { requireAuth } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { aiConfigured } from '@/lib/ai/provider'
import { AskClient } from './AskClient'

export default async function AskPage() {
  await requireAuth()
  const { business } = await getConfig()
  // Asks the provider seam, not one provider's env var: the demo runs on Groq
  // and would otherwise render the "not configured" state over a working
  // assistant.
  const hasKey = aiConfigured()

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Ask {business.name}</h1>
        <p className="text-sm cd-muted">Plain-English questions, answered from live CRM data. No report pages needed.</p>
      </div>
      <AskClient hasKey={hasKey} />
    </div>
  )
}
