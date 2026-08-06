'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// ── C1 · The copilot dock ────────────────────────────────────────────────────
// The assistant used to be a destination you navigated to, which meant leaving
// whatever you were doing to ask about it. This sits on every page instead, and
// knows where you are: the suggestions on the run sheet are about tonight's
// stays, the ones in Finance are about the month's numbers.
//
// Collapsed to a single button until used — a permanently open panel on a screen
// people work in all day is a tax, not a feature.
//
// It hides itself completely when the tenant has no API key or a zero budget.
// Offering an input that always errors is worse than not offering one.

interface Availability {
  available: boolean
  reason: string | null
  scope: { label: string; suggestions: string[] }
}

// C2 — a write the assistant wants to make, waiting on a human.
interface Proposal {
  id: string
  kind: string
  summary: string
  detail: string[]
}
type Settled = { id: string; ok: boolean; message: string; link?: string }

const KIND_LABEL: Record<string, string> = {
  whatsapp: 'Message', appointment: 'Booking', careNote: 'Care log',
  reorder: 'Stock alert', expense: 'Expense',
}

export function Copilot() {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Availability | null>(null)
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [settled, setSettled] = useState<Settled[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Re-checked per route so the suggestions follow the page, and so a budget
  // exhausted mid-session removes the dock on the next navigation.
  useEffect(() => {
    let live = true
    fetch(`/api/ask?path=${encodeURIComponent(path)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setInfo(d) })
      .catch(() => { if (live) setInfo(null) })
    return () => { live = false }
  }, [path])

  // A new page means a new question; keeping the last answer around invites
  // reading it as though it were about what is now on screen.
  useEffect(() => {
    setAnswer(null); setAsked(null); setError(null); setQuestion('')
    setProposals([]); setSettled([])
  }, [path])

  if (!info?.available) return null

  async function decide(p: Proposal, decision: 'confirm' | 'decline') {
    if (busyId) return
    setBusyId(p.id)
    try {
      const res = await fetch('/api/ask/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, decision }),
      })
      const json = await res.json()
      setProposals(list => list.filter(x => x.id !== p.id))
      if (decision === 'decline') return
      setSettled(list => [...list, res.ok
        ? { id: p.id, ok: true, message: `${p.summary} — ${json.message}`, link: json.link }
        : { id: p.id, ok: false, message: json.error ?? 'That could not be done.' }])
    } catch {
      setSettled(list => [...list, { id: p.id, ok: false, message: 'Could not reach the server.' }])
      setProposals(list => list.filter(x => x.id !== p.id))
    } finally {
      setBusyId(null)
    }
  }

  async function ask(q: string) {
    const text = q.trim()
    if (!text || loading) return
    setLoading(true); setError(null); setAnswer(null); setAsked(text); setQuestion('')
    setProposals([]); setSettled([])
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, path }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(
          json.error === 'budget' ? 'Today’s AI budget is used up. It resets tomorrow.'
            : json.error === 'disabled' || json.error === 'no-key' ? 'The assistant is switched off.'
              : 'Something went wrong answering that. Try rephrasing.',
        )
      } else {
        setAnswer(json.answer)
        setProposals(json.proposals ?? [])
      }
    } catch {
      setError('Could not reach the assistant.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg flex items-center gap-2 px-4 py-3 text-sm font-medium no-print"
        style={{ background: 'var(--brand-primary)', color: '#F2EDE0' }}
        aria-label="Ask the assistant">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        Ask
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[min(24rem,calc(100vw-2.5rem))] cd-card shadow-xl no-print"
      style={{ maxHeight: 'min(32rem, calc(100vh - 6rem))', display: 'flex', flexDirection: 'column' }}
      role="dialog" aria-label="Assistant">
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(45,25,7,0.12)' }}>
        <span className="text-sm font-semibold" style={{ color: '#2D1907' }}>Ask</span>
        <span className="cd-pill" style={{ background: 'rgba(45,25,7,0.07)', color: 'rgba(45,25,7,0.55)' }}>
          {info.scope.label}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => setOpen(false)}
          className="text-xs cd-muted hover:underline" aria-label="Close assistant">Close</button>
      </div>

      <div className="px-4 py-3 space-y-3 overflow-y-auto" style={{ flex: 1, minHeight: 0 }}>
        {asked && <p className="text-xs cd-muted">{asked}</p>}

        {loading && (
          <div className="space-y-2" aria-busy="true">
            <div className="cd-skeleton" style={{ height: 11, width: '90%' }} />
            <div className="cd-skeleton" style={{ height: 11, width: '75%' }} />
            <div className="cd-skeleton" style={{ height: 11, width: '55%' }} />
          </div>
        )}

        {error && <p className="text-sm" style={{ color: '#B14919' }}>{error}</p>}

        {answer && (
          <p className="text-sm whitespace-pre-wrap" style={{ color: '#2D1907' }}>{answer}</p>
        )}

        {/* C2 — nothing here has happened yet. The card shows the real content
            so the decision is made on the write itself, not on the model's
            description of it. */}
        {proposals.map(p => (
          <div key={p.id} className="rounded-xl p-3 space-y-2"
            style={{ background: 'rgba(177,73,25,0.06)', border: '1px solid rgba(177,73,25,0.25)' }}>
            <div className="flex items-center gap-2">
              <span className="cd-pill" style={{ background: 'rgba(177,73,25,0.15)', color: '#B14919' }}>
                {KIND_LABEL[p.kind] ?? p.kind}
              </span>
              <span className="text-xs cd-muted">needs your OK</span>
            </div>
            <p className="text-sm font-medium" style={{ color: '#2D1907' }}>{p.summary}</p>
            {p.detail.map((line, i) => (
              <p key={i} className="text-xs whitespace-pre-wrap p-2 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.6)', color: 'rgba(45,25,7,0.8)' }}>{line}</p>
            ))}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => decide(p, 'confirm')} disabled={busyId === p.id}
                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: '#B14919', color: '#F2EDE0', opacity: busyId === p.id ? 0.6 : 1 }}>
                {busyId === p.id ? 'Working…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => decide(p, 'decline')} disabled={busyId === p.id}
                className="text-xs cd-muted hover:underline">Discard</button>
            </div>
          </div>
        ))}

        {settled.map(s => (
          <p key={s.id} className="text-xs" style={{ color: s.ok ? '#5c6b3c' : '#B14919' }}>
            {s.ok ? '✓ ' : ''}{s.message}
            {s.link && (
              <>
                {' '}
                <a href={s.link} target="_blank" rel="noopener noreferrer" className="cd-link">Open WhatsApp</a>
              </>
            )}
          </p>
        ))}

        {!asked && !loading && (
          <div className="space-y-1.5">
            <p className="text-xs cd-muted">Try:</p>
            {info.scope.suggestions.map(s => (
              <button key={s} type="button" onClick={() => ask(s)}
                className="block w-full text-left text-xs px-2.5 py-2 rounded-lg"
                style={{ background: 'rgba(45,25,7,0.05)', color: 'rgba(45,25,7,0.75)' }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); ask(question) }}
        className="flex gap-2 px-4 py-3 shrink-0"
        style={{ borderTop: '1px solid rgba(45,25,7,0.12)' }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask about your data…"
          className="cd-input flex-1 text-sm"
          maxLength={500}
          disabled={loading}
        />
        <button type="submit" className="cd-btn text-sm" disabled={loading || !question.trim()}>
          {loading ? '…' : 'Ask'}
        </button>
      </form>
    </div>
  )
}
