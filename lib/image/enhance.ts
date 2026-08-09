// ── C8 · Photo tidy-up ───────────────────────────────────────────────────────
//
// Cat Day's before/after grooming shots are its best marketing asset and they
// are phone snaps in bad lighting. This does the three things that actually
// help a pair sit side by side, and refuses to pretend to do more:
//
//   • consistent framing — a centre square, so before and after are the same
//     shape and size instead of one portrait and one landscape
//   • exposure — a histogram stretch, which is what "taken under a shop light"
//     mostly needs
//   • orientation — honouring EXIF, so a portrait photo does not upload sideways
//
// NOT straightening, and not background removal. Straightening needs to know
// which way is up in the picture, which is a real vision problem; guessing at it
// would tilt photos that were fine. The roadmap's "studio packshot" analogue is
// out of reach without a model, and a half-done version is worse than none.
//
// Pure and dependency-free so it can be exercised directly: these functions take
// and return pixel buffers, with no canvas or DOM involved.

/** Rec. 709 luminance, the same weighting the contrast checker uses. */
export const luminance = (r: number, g: number, b: number): number =>
  Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)

export function luminanceHistogram(data: Uint8ClampedArray): Uint32Array {
  const hist = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    // Fully transparent pixels are padding, not picture.
    if (data[i + 3] < 8) continue
    hist[luminance(data[i], data[i + 1], data[i + 2])]++
  }
  return hist
}

export interface Levels { low: number; high: number }

/**
 * Where to clip the histogram.
 *
 * A small percentile is discarded at each end rather than taking the absolute
 * min and max: one stray specular highlight or one black pixel would otherwise
 * peg the range at 0–255 and the stretch would do nothing at all, which is the
 * usual reason naive auto-levels appears not to work.
 */
export function levelBounds(hist: Uint32Array, clipPct = 0.5): Levels {
  const total = hist.reduce((s, n) => s + n, 0)
  if (total === 0) return { low: 0, high: 255 }
  const cut = Math.floor((total * clipPct) / 100)

  let acc = 0, low = 0, high = 255
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > cut) { low = i; break } }
  acc = 0
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > cut) { high = i; break } }
  return low < high ? { low, high } : { low: 0, high: 255 }
}

/** Below this the image is already using most of the range and stretching adds only noise. */
export const MIN_STRETCH_GAIN = 1.06

export const stretchGain = ({ low, high }: Levels): number =>
  (high > low ? 255 / (high - low) : 1)

export const worthStretching = (levels: Levels): boolean =>
  stretchGain(levels) >= MIN_STRETCH_GAIN

/**
 * Stretch the tonal range in place.
 *
 * Mutates the buffer rather than returning a copy: this runs on a full-size
 * image in the browser and a second several-megabyte array per photo is a real
 * cost for no benefit. The caller owns the buffer and has already copied it out
 * of the canvas.
 *
 * The SAME bounds are applied to all three channels. Per-channel levels would
 * grade harder but shift colour, and a cat's coat coming out a different shade
 * than it is in the room is exactly the complaint this feature must not cause.
 */
export function applyLevels(data: Uint8ClampedArray, levels: Levels): void {
  const { low, high } = levels
  if (high <= low) return
  const scale = 255 / (high - low)

  // 256-entry lookup, so the per-pixel work is three array reads.
  const map = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) map[v] = Math.round((v - low) * scale)

  for (let i = 0; i < data.length; i += 4) {
    data[i] = map[data[i]]
    data[i + 1] = map[data[i + 1]]
    data[i + 2] = map[data[i + 2]]
  }
}

export interface CropRect { sx: number; sy: number; sw: number; sh: number }

/**
 * The largest centred rectangle of a given aspect ratio inside a w×h image.
 *
 * Centred rather than smart-cropped: finding the cat would need a model, and a
 * subject-detection guess that clips an ear is worse than a plain centre crop
 * the owner can see is a centre crop. M3 shows the result before anything is
 * published, so a bad framing is caught by eye rather than by algorithm.
 */
export function aspectCrop(width: number, height: number, ratio: number): CropRect {
  const current = width / height
  const sw = current > ratio ? Math.round(height * ratio) : width
  const sh = current > ratio ? height : Math.round(width / ratio)
  return { sx: Math.round((width - sw) / 2), sy: Math.round((height - sh) / 2), sw, sh }
}

/** The largest centred square inside a w×h image. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height)
  return { sx: Math.round((width - size) / 2), sy: Math.round((height - size) / 2), size }
}

/** Social aspect ratios M3 exports a pair at. */
export const SOCIAL_RATIOS = {
  square: { label: '1:1 · feed', ratio: 1, width: 1080, height: 1080 },
  story: { label: '9:16 · story', ratio: 9 / 16, width: 1080, height: 1920 },
} as const
export type SocialRatio = keyof typeof SOCIAL_RATIOS
