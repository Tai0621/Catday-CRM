import { requireAuth } from '@/lib/auth'
import { AskClient } from './AskClient'

export default async function AskPage() {
  await requireAuth()
  const hasKey = !!process.env.ANTHROPIC_API_KEY

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#2D1907' }}>Ask Cat Day</h1>
        <p className="text-sm cd-muted">Plain-English questions, answered from live CRM data. No report pages needed.</p>
      </div>
      <AskClient hasKey={hasKey} />
    </div>
  )
}
