'use client'

import { useState } from 'react'

const EXAMPLES = [
  'Which customers haven’t returned in six months?',
  'Show me cats with allergies',
  'Who are our top 10 customers by spending?',
  'What’s our revenue this month by category?',
  'What’s today’s room occupancy?',
]

export function AskClient({ hasKey }: { hasKey: boolean }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask(q: string) {
    if (!q.trim() || loading) return
    setLoading(true)
    setError(null)
    setAnswer(null)
    setAsked(q)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error === 'no-key'
          ? 'AI assistant is not configured yet — add ANTHROPIC_API_KEY to the environment.'
          : 'Something went wrong answering that. Try rephrasing.')
      } else {
        setAnswer(json.answer)
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!hasKey) {
    return (
      <div className="cd-card p-8 text-center space-y-2">
        <div className="text-3xl">🤖</div>
        <h2 className="font-semibold" style={{ color: '#2D1907' }}>Almost ready</h2>
        <p className="text-sm cd-muted max-w-md mx-auto">
          The AI assistant needs an Anthropic API key. Add <code style={{ background: 'rgba(45,25,7,0.08)', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>ANTHROPIC_API_KEY</code> to
          the local <code>.env</code> and the Vercel environment variables, then redeploy.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={e => { e.preventDefault(); ask(question) }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask anything about customers, cats, revenue, occupancy…"
          className="cd-input flex-1"
          autoFocus
        />
        <button type="submit" disabled={loading} className="cd-btn" style={loading ? { opacity: 0.6 } : undefined}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      <div className="flex gap-2 flex-wrap">
        {EXAMPLES.map(ex => (
          <button key={ex} onClick={() => { setQuestion(ex); ask(ex) }} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-full transition-colors"
            style={{ background: 'rgba(45,25,7,0.06)', color: '#2D1907', border: '1px solid rgba(45,25,7,0.12)' }}>
            {ex}
          </button>
        ))}
      </div>

      {(loading || answer || error) && (
        <div className="cd-card p-5 space-y-3">
          {asked && <p className="text-xs cd-muted">“{asked}”</p>}
          {loading && <p className="text-sm cd-muted animate-pulse">Checking the CRM data…</p>}
          {error && <p className="text-sm" style={{ color: '#B14919' }}>{error}</p>}
          {answer && (
            <div className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: '#2D1907' }}>{answer}</div>
          )}
        </div>
      )}
    </div>
  )
}
