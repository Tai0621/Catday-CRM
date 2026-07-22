import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  MEDIA_OWNER_TYPES, kindForType, maxBytesFor, isMediaConfigured, blobPathname,
} from '@/lib/media'

// Receives one file + its owner, stores it in Vercel Blob, records a MediaAsset.
// Used by the shared <MediaUpload> client component. Manager or staff may upload.
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  if (!isMediaConfigured()) {
    return NextResponse.json({ error: 'Photo/video storage isn’t set up yet.' }, { status: 503 })
  }

  const form = await req.formData()
  const file = form.get('file')
  const ownerType = ((form.get('ownerType') as string) ?? '').trim()
  const ownerId = ((form.get('ownerId') as string) ?? '').trim()
  const tag = ((form.get('tag') as string) ?? '').trim() || null
  const caption = ((form.get('caption') as string) ?? '').trim() || null

  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (!(MEDIA_OWNER_TYPES as readonly string[]).includes(ownerType) || !ownerId) {
    return NextResponse.json({ error: 'Invalid owner' }, { status: 400 })
  }
  const kind = kindForType(file.type)
  if (!kind) return NextResponse.json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, { status: 415 })
  if (file.size > maxBytesFor(kind)) {
    return NextResponse.json({ error: `File too large (max ${Math.round(maxBytesFor(kind) / 1024 / 1024)} MB)` }, { status: 413 })
  }

  // Private store: blobs aren't world-readable. They're served to signed-in
  // staff only, through GET /api/media/[id]/file (keeps customer photos off
  // public URLs).
  const pathname = blobPathname(ownerType, ownerId, file.name || `${kind}.bin`)
  const blob = await put(pathname, file, { access: 'private', contentType: file.type })

  const asset = await db.mediaAsset.create({
    data: {
      url: blob.url, pathname: blob.pathname, kind, contentType: file.type, size: file.size,
      ownerType, ownerId, tag, caption,
      uploadedBy: session.kind === 'staff' ? session.staffId : null,
    },
    select: { id: true, url: true, kind: true, tag: true, caption: true },
  })

  return NextResponse.json({ ok: true, asset })
}
