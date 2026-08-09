'use client'

import { useRef, useState } from 'react'
import { SOCIAL_RATIOS, aspectCrop, type SocialRatio } from '@/lib/image/enhance'

// M3 · Compose the before/after pair into a post-ready image, in the browser.
//
// Same reasoning as C8: the images are already decoded here, and the owner has
// to SEE the framing before publishing anything. A server-side composer would
// need an image dependency to produce something nobody has looked at yet.
//
// The two halves are stacked for a story and placed side by side for a square,
// because that is how each shape is actually read.

const GAP = 8

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  return img
}

export function PairExport({
  beforeId, afterId, catName, ink, accent,
}: {
  beforeId: string; afterId: string; catName: string; ink: string; accent: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shape, setShape] = useState<SocialRatio>('square')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function compose(target: SocialRatio) {
    setShape(target)
    setBusy(true); setError(null)
    try {
      const spec = SOCIAL_RATIOS[target]
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = spec.width
      canvas.height = spec.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#F2EDE0'
      ctx.fillRect(0, 0, spec.width, spec.height)

      const [before, after] = await Promise.all([
        loadImage(`/api/media/${beforeId}/file`),
        loadImage(`/api/media/${afterId}/file`),
      ])

      // Square → side by side; story → stacked.
      const sideBySide = target === 'square'
      const paneW = sideBySide ? (spec.width - GAP) / 2 : spec.width
      const paneH = sideBySide ? spec.height : (spec.height - GAP) / 2

      const draw = (img: HTMLImageElement, dx: number, dy: number) => {
        const crop = aspectCrop(img.naturalWidth, img.naturalHeight, paneW / paneH)
        ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, dx, dy, paneW, paneH)
      }
      draw(before, 0, 0)
      draw(after, sideBySide ? paneW + GAP : 0, sideBySide ? 0 : paneH + GAP)

      // Labels, so the pair reads correctly without a caption.
      ctx.font = `600 ${Math.round(spec.width * 0.032)}px sans-serif`
      ctx.textBaseline = 'top'
      const label = (text: string, x: number, y: number) => {
        const padding = Math.round(spec.width * 0.014)
        const w = ctx.measureText(text).width + padding * 2
        const h = Math.round(spec.width * 0.055)
        ctx.fillStyle = accent
        ctx.fillRect(x, y, w, h)
        ctx.fillStyle = '#F2EDE0'
        ctx.fillText(text, x + padding, y + padding * 0.7)
      }
      label('BEFORE', GAP, GAP)
      label('AFTER', sideBySide ? paneW + GAP * 2 : GAP, sideBySide ? GAP : paneH + GAP * 2)
    } catch {
      setError('Could not load the photos — try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  function download() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${catName.replace(/\W+/g, '-').toLowerCase()}-${shape}.jpg`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/jpeg', 0.9)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(SOCIAL_RATIOS) as SocialRatio[]).map(key => (
          <button key={key} type="button" onClick={() => compose(key)} disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={shape === key && canvasRef.current?.width
              ? { background: accent, color: '#F2EDE0', fontWeight: 600 }
              : { background: 'rgba(45,25,7,0.06)', color: 'rgba(45,25,7,0.6)' }}>
            {SOCIAL_RATIOS[key].label}
          </button>
        ))}
        <button type="button" onClick={download} disabled={busy} className="text-xs cd-btn-sec">
          Download
        </button>
        {busy && <span className="text-xs cd-muted">Composing…</span>}
      </div>

      {error && <p className="text-xs" style={{ color: '#B14919' }}>{error}</p>}

      <canvas ref={canvasRef}
        className="rounded-lg w-full"
        style={{ maxWidth: 360, border: `1px solid ${ink}22`, background: 'rgba(45,25,7,0.04)' }} />
      <p className="text-xs cd-muted">
        Centre-cropped — check the framing before you post. Nothing is published from here.
      </p>
    </div>
  )
}
