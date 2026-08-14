import { del } from '@vercel/blob'
import { db } from './db'

// Media (photo/video) plumbing shared by every feature that captures images or
// clips. Files live in Vercel Blob; a MediaAsset row records the URL + metadata.
// Finance-style rule of thumb: keep the DB row small, keep the bytes in Blob.

// Owners a MediaAsset may attach to (validated at the upload boundary).
export const MEDIA_OWNER_TYPES = ['cat', 'assessment', 'appointment', 'belongings', 'condition', 'room', 'timeclock', 'expense'] as const
export type MediaOwnerType = typeof MEDIA_OWNER_TYPES[number]

export const MEDIA_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MEDIA_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
// A supplier invoice arrives as a PDF far more often than as a photograph, so
// leaving it out would have meant staff screenshotting a PDF to file it.
export const MEDIA_DOC_TYPES = ['application/pdf']
// Images are compressed client-side before upload, so this ceiling is generous.
export const MEDIA_MAX_IMAGE_BYTES = 10 * 1024 * 1024   // 10 MB
export const MEDIA_MAX_VIDEO_BYTES = 100 * 1024 * 1024  // 100 MB
export const MEDIA_MAX_DOC_BYTES = 20 * 1024 * 1024     // 20 MB

export type MediaKind = 'image' | 'video' | 'document'

export function kindForType(contentType: string): MediaKind | null {
  if (MEDIA_IMAGE_TYPES.includes(contentType)) return 'image'
  if (MEDIA_VIDEO_TYPES.includes(contentType)) return 'video'
  if (MEDIA_DOC_TYPES.includes(contentType)) return 'document'
  return null
}

export function maxBytesFor(kind: MediaKind): number {
  if (kind === 'image') return MEDIA_MAX_IMAGE_BYTES
  if (kind === 'document') return MEDIA_MAX_DOC_BYTES
  return MEDIA_MAX_VIDEO_BYTES
}

// Whether Blob storage is wired up. When false, the UI shows a friendly notice
// and the upload endpoint refuses cleanly instead of throwing — so the app runs
// (and every other feature keeps working) before the token is added.
export function isMediaConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

export type MediaRow = {
  id: string; url: string; kind: string; contentType: string
  tag: string | null; caption: string | null; createdAt: Date
}

export async function listMediaFor(ownerType: string, ownerId: string, tag?: string): Promise<MediaRow[]> {
  return db.mediaAsset.findMany({
    where: { ownerType, ownerId, ...(tag ? { tag } : {}) },
    select: { id: true, url: true, kind: true, contentType: true, tag: true, caption: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

// Delete a media asset: remove the Blob (best-effort) then the row. Shared by
// the DELETE route and the deleteMediaAsset server action.
export async function removeMedia(id: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({ where: { id }, select: { url: true } })
  if (!asset) return
  try {
    if (isMediaConfigured()) await del(asset.url)
  } catch {
    // Blob already gone / unreachable — still drop the row so the UI clears.
  }
  await db.mediaAsset.delete({ where: { id } })
}

// A stable, collision-free Blob pathname for an owner's file.
//
// `period` ("YYYY-MM") files financial documents under the month they belong to,
// so a raw listing of the blob store is already sorted into accounting periods
// rather than one flat heap. It is a STORAGE layout only: the app groups by the
// expense's own date, so correcting a mis-dated expense re-files the document
// immediately. Putting the period in the path AND trusting it would be two
// sources of truth for which month a receipt belongs to, which is the exact
// mistake this feature exists to prevent.
export function blobPathname(ownerType: string, ownerId: string, filename: string, period?: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-60)
  const rand = Math.random().toString(36).slice(2, 10)
  const folder = period ? `${ownerType}/${period}/${ownerId}` : `${ownerType}/${ownerId}`
  return `${folder}/${Date.now()}-${rand}-${safe}`
}

/** "YYYY-MM" — the accounting period a date falls in, in local time. */
export function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
