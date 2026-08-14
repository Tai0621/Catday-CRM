import { NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  MEDIA_OWNER_TYPES, kindForType, maxBytesFor, isMediaConfigured, blobPathname, periodOf,
} from '@/lib/media'

// Receives one file + its owner, stores it in Vercel Blob, records a MediaAsset.
// Used by the shared <MediaUpload> client component. Manager or staff may upload.
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

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

  // A financial document is filed under the period it belongs to. The period
  // comes from the EXPENSE's own date, never from the upload date — an invoice
  // is routinely filed days after the expense, and often in the following month.
  let period: string | undefined
  if (ownerType === 'expense') {
    const expense = await db.expense.findUnique({ where: { id: ownerId }, select: { date: true } })
    if (!expense) return NextResponse.json({ error: 'That expense no longer exists' }, { status: 404 })
    period = periodOf(expense.date)
  }

  // The storage check comes AFTER validation, not before it. A wrong file type
  // or an owner that does not exist is a bad request whether or not Blob is
  // wired up, and answering 503 first made those rejections untestable on any
  // deployment without a token: a verification script passes on the 503 and
  // never exercises the check it was written for.
  if (!isMediaConfigured()) {
    return NextResponse.json({ error: 'File storage isn’t set up yet.' }, { status: 503 })
  }

  // Private store: blobs aren't world-readable. They're served to signed-in
  // staff only, through GET /api/media/[id]/file (keeps customer photos off
  // public URLs).
  const pathname = blobPathname(ownerType, ownerId, file.name || `${kind}.bin`, period)
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
