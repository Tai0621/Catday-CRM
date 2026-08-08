// ── C7 · Brand contrast ──────────────────────────────────────────────────────
//
// A white-label accent colour is not a decoration: `--brand-primary` is the
// link colour on cream and the background of every primary button, and
// `--brand-ink` is the body text. A client whose logo is a cheerful mid-yellow
// gets an app whose links are invisible — and nobody notices during the sales
// demo, because the person clicking already knows where the links are.
//
// So this module knows the ACTUAL pairings the design system creates, not a
// generic "is this readable" score, and it can walk a colour to the nearest
// shade of itself that works.
//
// Import-free on purpose: this is the maths the whole feature rests on, so it
// compiles standalone and is exercised directly by the verification script.

export interface Rgb { r: number; g: number; b: number }

const HEX = /^#?([0-9a-f]{6})$/i

export function parseHex(hex: string): Rgb | null {
  const m = HEX.exec(String(hex ?? '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1–21. Order of arguments does not matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

// The fixed surfaces the brand colours land on (app/globals.css).
export const SURFACE = {
  page: '#F2EDE0',      // body background — linen
  card: '#ECDBB6',      // .cd-card
  buttonText: '#ECDBB6', // .cd-btn label, sitting ON --brand-primary
} as const

export const AA_TEXT = 4.5
export const AA_LARGE = 3

export interface ContrastCheck {
  label: string
  /** What it is: readable text, or a non-text accent. */
  kind: 'text' | 'accent'
  ratio: number
  required: number
  passes: boolean
  /** Which config value to change if it fails. */
  fix: 'primary' | 'ink'
}

/**
 * Every pairing the design system actually creates, checked.
 *
 * `accent` pairings use the 3:1 non-text threshold because a card's left border
 * is a visual cue, not something anyone reads — holding it to 4.5:1 would
 * reject perfectly good brands for no benefit.
 */
export function evaluateBrand(primaryHex: string, inkHex: string): ContrastCheck[] {
  const primary = parseHex(primaryHex)
  const ink = parseHex(inkHex)
  const page = parseHex(SURFACE.page)!
  const card = parseHex(SURFACE.card)!
  const buttonText = parseHex(SURFACE.buttonText)!
  if (!primary || !ink) return []

  const check = (label: string, kind: ContrastCheck['kind'], a: Rgb, b: Rgb, fix: ContrastCheck['fix']): ContrastCheck => {
    const ratio = contrastRatio(a, b)
    const required = kind === 'text' ? AA_TEXT : AA_LARGE
    return { label, kind, ratio, required, passes: ratio >= required, fix }
  }

  return [
    check('Body text on the page', 'text', ink, page, 'ink'),
    check('Text on a card', 'text', ink, card, 'ink'),
    check('Links on the page', 'text', primary, page, 'primary'),
    check('Button label on the accent', 'text', buttonText, primary, 'primary'),
    check('Accent borders and dots', 'accent', primary, page, 'primary'),
  ]
}

export const brandPasses = (primary: string, ink: string): boolean =>
  evaluateBrand(primary, ink).every(c => c.passes)

// ── HSL, for walking a colour without leaving it ─────────────────────────────

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0))
    : max === G ? (B - R) / d + 2
      : (R - G) / d + 4
  return { h: h / 6, s, l }
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let v = t
    if (v < 0) v += 1
    if (v > 1) v -= 1
    if (v < 1 / 6) return p + (q - p) * 6 * v
    if (v < 1 / 2) return q
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6
    return p
  }
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 }
}

/**
 * The nearest shade of the same colour that clears every pairing it is used in.
 *
 * Hue and saturation are held fixed and only lightness moves, so the result is
 * recognisably the brand rather than a different colour that happens to pass.
 * Returns the input unchanged when it already works, and null when no shade of
 * that hue can satisfy both a light background and a light label on top — which
 * is a real answer, not a failure: some colours cannot be both.
 */
export function nearestAccessible(hex: string, role: 'primary' | 'ink'): string | null {
  const rgb = parseHex(hex)
  if (!rgb) return null

  const ok = (candidate: string) =>
    evaluateBrand(role === 'primary' ? candidate : '#B14919', role === 'ink' ? candidate : '#2D1907')
      .filter(c => c.fix === role)
      .every(c => c.passes)

  if (ok(hex)) return toHex(rgb)

  const { h, s } = rgbToHsl(rgb)
  const start = rgbToHsl(rgb).l
  // Search outward from the original lightness so the closest match wins,
  // darker first — on a cream palette that is nearly always the direction.
  for (let step = 1; step <= 100; step++) {
    for (const l of [start - step / 100, start + step / 100]) {
      if (l < 0 || l > 1) continue
      const candidate = toHex(hslToRgb({ h, s, l }))
      if (ok(candidate)) return candidate
    }
  }
  return null
}
