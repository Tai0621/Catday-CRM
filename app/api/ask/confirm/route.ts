import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { confirmProposal, declineProposal } from '@/lib/ai/proposals'

/**
 * C2 — the gate itself. A proposal only becomes a write here, and only because
 * a human pressed a button.
 *
 * The request carries an id, never a payload: the arguments executed are the
 * ones stored when the model proposed them. That is not distrust of the manager
 * on the other end — they could make the same write by hand in ten seconds —
 * it is so the AuditLog row records what was actually suggested, and so a
 * double-click cannot become two appointments.
 *
 * Sits under /api/ask, which proxy.ts already restricts to managers.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'missing-id' }, { status: 400 })

  if (body?.decision === 'decline') {
    await declineProposal(id)
    return NextResponse.json({ ok: true, declined: true })
  }

  const result = await confirmProposal(id)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 409 })
  return NextResponse.json(result)
}
