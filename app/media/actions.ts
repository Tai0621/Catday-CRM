'use server'

import { del } from '@vercel/blob'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { isMediaConfigured } from '@/lib/media'

// Delete a media asset — removes the Blob then the row. Called by the shared
// <DeleteMediaButton>. Returns a typed result so the client can surface errors.
export async function deleteMediaAsset(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Sign in required' }

  const asset = await db.mediaAsset.findUnique({ where: { id }, select: { url: true } })
  if (!asset) return { ok: true } // already gone

  try {
    if (isMediaConfigured()) await del(asset.url)
  } catch {
    // Blob already deleted or unreachable — still drop the row so the UI clears.
  }
  await db.mediaAsset.delete({ where: { id } })
  return { ok: true }
}
