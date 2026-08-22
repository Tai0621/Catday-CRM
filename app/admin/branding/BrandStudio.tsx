'use client'

import { useEffect, useRef, useState } from 'react'
import {
  evaluateBrand, nearestAccessible, parseHex, toHex, rgbToHsl,
  type ContrastCheck,
} from '@/lib/brand/contrast'
import { SubmitButton } from '@/app/components/Pending'

// ── C7 · Brand autopilot ─────────────────────────────────────────────────────
//
// Extraction runs in the BROWSER, on purpose. The logo is already decoded there
// — by a renderer that handles PNG, JPEG, WebP and SVG — so a canvas gives the
// pixels for free. Doing it server-side would mean shipping an image-decoding
// dependency to solve a problem the client does not have, and the live preview
// this screen exists for has to be client-side anyway.
//
// Nothing here is trusted: the server re-parses the hex and re-runs the same
// contrast check before saving.

interface Props {
  logoUrl: string
  currentPrimary: string
  currentInk: string
  action: (data: FormData) => void
}

interface Swatch { hex: string; share: number }

/** Bucket to 4 bits per channel: enough to group a gradient, not enough to merge brand colours. */
const bucket = (v: number) => Math.min(15, v >> 4)

function extract(image: HTMLImageElement): Swatch[] {
  const size = 160 // downsampled — a logo's palette does not need every pixel
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(image, 0, 0, size, size)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, size, size).data
  } catch {
    // Tainted canvas — the logo is on another origin without CORS headers.
    return []
  }

  const counts = new Map<number, { r: number; g: number; b: number; n: number }>()
  let considered = 0
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
    if (a < 128) continue // transparent padding around a logo is most of it
    const { s, l } = rgbToHsl({ r, g, b })
    // Paper and shadow are not the brand.
    if (l > 0.95 || l < 0.04) continue
    if (s < 0.08 && l > 0.85) continue
    considered++
    const key = (bucket(r) << 8) | (bucket(g) << 4) | bucket(b)
    const e = counts.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    e.r += r; e.g += g; e.b += b; e.n++
    counts.set(key, e)
  }
  if (considered === 0) return []

  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map(e => ({ hex: toHex({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }), share: e.n / considered }))
}

/** The most colourful of the frequent swatches — a logo's accent, not its outline. */
function pickAccent(swatches: Swatch[]): string | null {
  const scored = swatches
    .map(s => {
      const rgb = parseHex(s.hex)!
      const { s: sat, l } = rgbToHsl(rgb)
      // Weight by how much of the logo it is, but require actual colour.
      return { hex: s.hex, score: sat * (1 - Math.abs(l - 0.45)) * Math.sqrt(s.share) }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.hex ?? null
}

/** The darkest substantial swatch, which is nearly always the wordmark. */
function pickInk(swatches: Swatch[]): string | null {
  const dark = swatches
    .filter(s => s.share > 0.02)
    .map(s => ({ hex: s.hex, l: rgbToHsl(parseHex(s.hex)!).l }))
    .sort((a, b) => a.l - b.l)
  return dark[0]?.hex ?? null
}

export function BrandStudio({ logoUrl, currentPrimary, currentInk, action }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [swatches, setSwatches] = useState<Swatch[]>([])
  const [primary, setPrimary] = useState(currentPrimary)
  const [ink, setInk] = useState(currentInk)
  const [state, setState] = useState<'idle' | 'ready' | 'blocked' | 'empty'>('idle')

  function readLogo() {
    const image = imgRef.current
    if (!image || !image.complete || image.naturalWidth === 0) return
    const found = extract(image)
    setSwatches(found)
    if (found.length === 0) { setState('blocked'); return }
    setState('ready')
    const accent = pickAccent(found)
    const darkest = pickInk(found)
    // Proposed at their accessible shade, not raw: the first thing shown should
    // be something usable, with the original one click away in the swatches.
    if (accent) setPrimary(nearestAccessible(accent, 'primary') ?? accent)
    if (darkest) setInk(nearestAccessible(darkest, 'ink') ?? darkest)
  }

  useEffect(() => { setState('idle'); setSwatches([]) }, [logoUrl])

  const checks: ContrastCheck[] = evaluateBrand(primary, ink)
  const failing = checks.filter(c => !c.passes)
  const suggestedPrimary = nearestAccessible(primary, 'primary')
  const suggestedInk = nearestAccessible(ink, 'ink')

  return (
    <div className="space-y-4">
      <div className="cd-card p-5 space-y-3">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={logoUrl} alt="" crossOrigin="anonymous" onLoad={readLogo}
            width={64} height={64} style={{ objectFit: 'contain' }} />
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: '#2D1907' }}>{logoUrl}</p>
            <p className="text-xs cd-muted">
              {state === 'blocked'
                ? 'The colours could not be read — the logo is hosted somewhere that does not allow it. Upload it to this system, or set the colours by hand below.'
                : state === 'ready'
                  ? `${swatches.length} colours found. The two proposed below are the nearest readable shades.`
                  : 'Reading the logo…'}
            </p>
          </div>
          <button type="button" onClick={readLogo} className="cd-btn-sec text-sm">Re-read</button>
        </div>

        {swatches.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {swatches.map(s => (
              <button key={s.hex} type="button" onClick={() => setPrimary(s.hex)}
                title={`${s.hex} · ${Math.round(s.share * 100)}% of the logo`}
                className="rounded-lg" style={{
                  width: 40, height: 40, background: s.hex,
                  border: s.hex.toUpperCase() === primary.toUpperCase()
                    ? '3px solid #2D1907' : '1px solid rgba(45,25,7,0.15)',
                }} />
            ))}
          </div>
        )}
      </div>

      <form action={action} className="cd-card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <ColourField label="Accent" name="primary" value={primary} onChange={setPrimary}
            suggestion={suggestedPrimary} />
          <ColourField label="Text" name="ink" value={ink} onChange={setInk}
            suggestion={suggestedInk} />
        </div>

        <div className="space-y-1.5">
          <p className="cd-label">Readability</p>
          {checks.map(c => (
            <div key={c.label} className="flex items-center gap-2 text-xs">
              <span style={{ color: c.passes ? '#5c6b3c' : '#B14919' }}>{c.passes ? '✓' : '✗'}</span>
              <span style={{ color: '#2D1907' }}>{c.label}</span>
              <span className="cd-muted">
                {c.ratio}:1 · needs {c.required}:1{c.kind === 'accent' ? ' (not text)' : ''}
              </span>
            </div>
          ))}
        </div>

        <Preview primary={primary} ink={ink} />

        {failing.length > 0 && (
          <label className="text-xs flex items-start gap-2" style={{ color: '#B14919' }}>
            <input type="checkbox" name="override" value="yes" className="mt-0.5" />
            <span>
              {failing.length === 1 ? 'One pairing is' : `${failing.length} pairings are`} below the
              readable threshold. Save anyway — I understand parts of the app will be hard to read.
            </span>
          </label>
        )}

        <SubmitButton className="cd-btn text-sm" busyLabel="Working…">Save colours</SubmitButton>
      </form>
    </div>
  )
}

function ColourField({ label, name, value, onChange, suggestion }: {
  label: string; name: string; value: string
  onChange: (v: string) => void; suggestion: string | null
}) {
  const differs = suggestion && suggestion.toUpperCase() !== value.toUpperCase()
  return (
    <div>
      <label className="cd-label">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={e => onChange(e.target.value.toUpperCase())}
          style={{ width: 38, height: 34, padding: 0, border: '1px solid rgba(45,25,7,0.15)', borderRadius: 6 }} />
        <input name={name} value={value} onChange={e => onChange(e.target.value.toUpperCase())}
          className="cd-input text-sm flex-1" maxLength={7} />
      </div>
      {differs && (
        <button type="button" onClick={() => onChange(suggestion!)} className="text-xs cd-link mt-1">
          Use {suggestion} — the nearest readable shade
        </button>
      )}
    </div>
  )
}

/** The real utility classes, re-skinned inline, so the preview cannot drift from the app. */
function Preview({ primary, ink }: { primary: string; ink: string }) {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: '#F2EDE0' }}>
      <p className="text-sm font-semibold" style={{ color: ink }}>A heading in the text colour</p>
      <p className="text-xs" style={{ color: ink, opacity: 0.7 }}>
        Body copy as it appears on the page, with <span style={{ color: primary }}>a link in the accent</span>.
      </p>
      <div className="rounded-xl p-3" style={{ background: '#ECDBB6' }}>
        <p className="text-xs" style={{ color: ink }}>Card text sits on a warmer surface.</p>
      </div>
      <span className="inline-block rounded-lg px-3 py-1.5 text-xs font-medium"
        style={{ background: primary, color: '#ECDBB6' }}>Primary button</span>
    </div>
  )
}
