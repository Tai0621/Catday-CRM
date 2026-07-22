import { NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

// Serves a (private) media blob to signed-in staff only. The blob store is
// private, so images/videos are streamed through this authenticated proxy
// rather than exposed on public URLs. Referenced as the <img>/<video> src by
// <MediaSection>. Cached briefly per-user.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const { id } = await params
  const asset = await db.mediaAsset.findUnique({ where: { id }, select: { url: true, contentType: true } })
  if (!asset) return new NextResponse('Not found', { status: 404 })

  const blob = await get(asset.url, { access: 'private' })
  if (!blob) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(blob.stream, {
    headers: {
      'Content-Type': blob.blob.contentType || asset.contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
