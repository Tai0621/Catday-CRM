import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { askCatday } from '@/lib/ai/ask'
import { budgetState } from '@/lib/ai/budget'
import { scopeForPath } from '@/lib/ai/scope'
import { loadProposals } from '@/lib/ai/proposals'

/**
 * GET — what the copilot needs to render itself: whether it is usable at all,
 * and what to suggest from where the user is standing. Called once per page so
 * the dock can hide itself entirely on a tenant that has AI switched off,
 * rather than offering a box that errors when used.
 */
export async function GET(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const path = new URL(req.url).searchParams.get('path') ?? undefined
  const budget = await budgetState()
  const scope = scopeForPath(path)
  return NextResponse.json({
    available: budget.enabled,
    reason: !budget.configured ? 'no-key' : budget.limit === 0 ? 'disabled' : budget.remaining === 0 ? 'budget' : null,
    scope: { label: scope.label, suggestions: scope.suggestions },
  })
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: 'empty' }, { status: 400 })
  const path = typeof body?.path === 'string' ? body.path : undefined

  try {
    const { answer, proposalIds } = await askCatday(question, { path })
    // Read back from the database rather than echoing what was built: the card
    // a human approves must show what was actually stored (C2).
    const proposals = await loadProposals(proposalIds)
    return NextResponse.json({ answer, proposals })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // These are expected states rather than failures, so each gets its own code
    // and the client explains it instead of showing a generic error.
    if (msg === 'no-key') return NextResponse.json({ error: 'no-key' }, { status: 503 })
    if (msg === 'ai-disabled') return NextResponse.json({ error: 'disabled' }, { status: 503 })
    if (msg === 'budget-exhausted') return NextResponse.json({ error: 'budget' }, { status: 429 })
    console.error('ask error:', msg)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
