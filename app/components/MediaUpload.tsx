'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'

// Reusable capture/upload control. On phones/tablets `capture` opens the camera;
// on desktop it's a file picker. Images are downscaled + re-encoded in the
// browser before upload so Blob storage stays small and uploads are fast.
const MAX_DIM = 1600
const JPEG_QUALITY = 0.82

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
  if (!blob || blob.size >= file.size) return file // keep original if compression didn't help
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export function MediaUpload({
  ownerType, ownerId, tag, accept = 'image', label = 'photo', disabled,
}: {
  ownerType: string; ownerId: string; tag?: string
  accept?: 'image' | 'video' | 'both'; label?: string; disabled?: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const acceptAttr = accept === 'video' ? 'video/*' : accept === 'both' ? 'image/*,video/*' : 'image/*'

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null)
    try {
      const prepared = await compressImage(file)
      const fd = new FormData()
      fd.set('file', prepared)
      fd.set('ownerType', ownerType)
      fd.set('ownerId', ownerId)
      if (tag) fd.set('tag', tag)
      const res = await fetch('/api/media/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Upload failed (${res.status})`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <label className={`cd-btn-sec text-sm cursor-pointer inline-flex items-center gap-2 ${disabled || busy ? 'opacity-60 pointer-events-none' : ''}`}>
        {busy ? 'Uploading…' : `+ Add ${label}`}
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          capture="environment"
          className="hidden"
          onChange={onChange}
          disabled={disabled || busy}
        />
      </label>
      {error && <span className="text-xs" style={{ color: '#B14919' }}>{error}</span>}
    </div>
  )
}
