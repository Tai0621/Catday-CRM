'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { squareCrop, luminanceHistogram, levelBounds, applyLevels, worthStretching } from '@/lib/image/enhance'

// Reusable capture/upload control. On phones/tablets `capture` opens the camera;
// on desktop it's a file picker. Images are downscaled + re-encoded in the
// browser before upload so Blob storage stays small and uploads are fast.
const MAX_DIM = 1600
const JPEG_QUALITY = 0.82

/**
 * Decode honouring EXIF orientation.
 *
 * Without `from-image`, a photo taken in portrait on a phone decodes at its
 * sensor orientation and uploads sideways — the camera's rotation lives in
 * metadata, not in the pixels. Browsers have not agreed on the default here, so
 * it is stated.
 */
const decode = (file: File) =>
  createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)

/**
 * C8 · Downscale, optionally square-crop and level, then re-encode.
 *
 * `square` and `levels` are opt-in per call site: cropping is right for a
 * before/after pair, which has to be the same shape to compare, and wrong for a
 * clock-in selfie or a photo of a customer's belongings, where cropping throws
 * away the thing being recorded.
 */
async function prepareImage(
  file: File,
  opts: { square?: boolean; levels?: boolean } = {},
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await decode(file)
  if (!bitmap) return file

  const crop = opts.square
    ? squareCrop(bitmap.width, bitmap.height)
    : { sx: 0, sy: 0, size: 0 }
  const srcW = opts.square ? crop.size : bitmap.width
  const srcH = opts.square ? crop.size : bitmap.height

  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH))
  const w = Math.round(srcW * scale), h = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: opts.levels })
  if (!ctx) return file
  ctx.drawImage(bitmap, crop.sx, crop.sy, srcW, srcH, 0, 0, w, h)

  if (opts.levels) {
    const image = ctx.getImageData(0, 0, w, h)
    const bounds = levelBounds(luminanceHistogram(image.data))
    // Left alone when the picture already uses most of the range — stretching
    // it further only amplifies sensor noise.
    if (worthStretching(bounds)) {
      applyLevels(image.data, bounds)
      ctx.putImageData(image, 0, 0)
    }
  }

  const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
  // A cropped or levelled image is the point even when it is not smaller; a
  // plain compress that did not shrink anything is not worth the re-encode.
  const changed = opts.square || opts.levels
  if (!blob || (!changed && blob.size >= file.size)) return file
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export function MediaUpload({
  ownerType, ownerId, tag, accept = 'image', label = 'photo', disabled, enhance = false,
}: {
  ownerType: string; ownerId: string; tag?: string
  accept?: 'image' | 'video' | 'both'; label?: string; disabled?: boolean
  /** C8 · square-crop and level the shot. For before/after pairs only. */
  enhance?: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Off by default even where offered: the owner decides per photo, and a
  // silent auto-edit of the business's best marketing asset is not something to
  // discover after the fact.
  const [tidy, setTidy] = useState(false)

  const acceptAttr = accept === 'video' ? 'video/*' : accept === 'both' ? 'image/*,video/*' : 'image/*'

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null)
    try {
      const prepared = await prepareImage(file, enhance && tidy ? { square: true, levels: true } : {})
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
      {enhance && (
        <label className="text-xs flex items-center gap-1.5 cd-muted">
          <input type="checkbox" checked={tidy} onChange={e => setTidy(e.target.checked)} disabled={busy} />
          Tidy up — square crop and even out the lighting
        </label>
      )}
      {error && <span className="text-xs" style={{ color: '#B14919' }}>{error}</span>}
    </div>
  )
}
