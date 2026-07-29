'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clockIn, clockOut } from './actions'

// Big one-tap clock in/out. When photo storage is on, a tap opens the camera
// (capture=environment on mobile), downscales the shot, uploads it, then records
// the punch with that photo — the selfie is the anti-buddy-punch proof. When
// storage isn't configured it records the punch without a photo.
const MAX_DIM = 1200
const JPEG_QUALITY = 0.8

async function compress(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY))
  if (!blob) return file
  return new File([blob], 'clock.jpg', { type: 'image/jpeg' })
}

export function ClockButton({ mode, staffId, mediaConfigured }: {
  mode: 'in' | 'out'; staffId: string; mediaConfigured: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clockingIn = mode === 'in'
  const label = clockingIn ? 'Clock In' : 'Clock Out'
  const color = clockingIn ? '#5F7A3F' : '#B14919'

  async function record(photoId: string | null) {
    const res = clockingIn ? await clockIn(photoId) : await clockOut(photoId)
    if (!res.ok) { setError(res.error); setBusy(false); return }
    setBusy(false)
    router.refresh()
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.set('file', await compress(file))
      fd.set('ownerType', 'timeclock')
      fd.set('ownerId', staffId)
      fd.set('tag', mode)
      const up = await fetch('/api/media/upload', { method: 'POST', body: fd })
      if (!up.ok) throw new Error((await up.json().catch(() => ({}))).error || 'Photo upload failed')
      const { asset } = await up.json()
      await record(asset.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  async function onClick() {
    setError(null)
    if (mediaConfigured) { inputRef.current?.click(); return }
    setBusy(true)
    await record(null)
  }

  return (
    <div className="space-y-2">
      <button onClick={onClick} disabled={busy}
        className="w-full rounded-2xl font-bold text-lg transition-opacity disabled:opacity-60"
        style={{ background: color, color: '#F7F0E1', padding: '1.5rem' }}>
        {busy ? 'One moment…' : mediaConfigured ? `📸 ${label}` : label}
      </button>
      {mediaConfigured && (
        <input ref={inputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onPhoto} />
      )}
      {error && <p className="text-sm text-center" style={{ color: '#B14919' }}>{error}</p>}
    </div>
  )
}
