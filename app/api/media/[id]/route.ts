import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { removeMedia } from '@/lib/media'

// Delete one media asset (blob + row). REST equivalent of the deleteMediaAsset
// server action, for programmatic callers. Manager or staff may delete.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const { id } = await params
  await removeMedia(id)
  return NextResponse.json({ ok: true })
}
