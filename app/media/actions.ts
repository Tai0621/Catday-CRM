'use server'

import { getSession } from '@/lib/auth'
import { removeMedia } from '@/lib/media'

// Delete a media asset — used by the shared <DeleteMediaButton>. Returns a typed
// result so the client can surface errors. (REST equivalent: DELETE /api/media/[id].)
export async function deleteMediaAsset(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Sign in required' }
  await removeMedia(id)
  return { ok: true }
}
