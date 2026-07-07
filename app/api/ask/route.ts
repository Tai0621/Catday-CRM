import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { askCatday } from '@/lib/ai/ask'

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: 'empty' }, { status: 400 })

  try {
    const answer = await askCatday(question)
    return NextResponse.json({ answer })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'no-key') return NextResponse.json({ error: 'no-key' }, { status: 503 })
    console.error('ask error:', msg)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
