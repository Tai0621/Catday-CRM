import 'dotenv/config'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// C8 — photo tidy-up.
//
// The pixel work runs in the browser, so what is testable here is the maths and
// the boundaries:
//
//   • the levels stretch does what it claims, and DOESN'T fire on a photo that
//     is already well exposed — the failure mode of naive auto-levels is
//     amplifying noise on a picture that was fine
//   • a stray highlight cannot defeat the stretch (the percentile clip)
//   • the square crop is centred and loses nothing on an already-square image
//   • enhancement is opt-in, and offered ONLY on before/after pairs — cropping
//     a photo of a customer's belongings destroys the record it exists to be
//   • EXIF orientation is honoured, or portrait photos upload sideways
//
// enhance.ts imports nothing, so it compiles standalone and is exercised
// directly on real pixel buffers.

const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

// ── build a fake image: n pixels, luminance drawn from `fill(i)` ──
const image = (n, fill) => {
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const v = fill(i)
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255
  }
  return data
}
const range = data => {
  let lo = 255, hi = 0
  for (let i = 0; i < data.length; i += 4) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]) }
  return { lo, hi }
}

const outDir = mkdtempSync(join(tmpdir(), 'c8-'))
execSync(`npx tsc lib/image/enhance.ts --outDir "${outDir}" --module es2022 --target es2022 --moduleResolution bundler`,
  { stdio: 'pipe' })
const E = await import(pathToFileURL(join(outDir, 'enhance.js')).href)

// ══ 1. Levels ══
// A flat, murky photo: everything between 90 and 140, as a shop light gives.
const murky = image(10000, i => 90 + (i % 51))
const murkyBounds = E.levelBounds(E.luminanceHistogram(murky))
check('a murky photo is recognised as worth stretching', E.worthStretching(murkyBounds),
  JSON.stringify(murkyBounds))
E.applyLevels(murky, murkyBounds)
const after = range(murky)
check('…and afterwards uses nearly the whole range', after.lo <= 3 && after.hi >= 250,
  `${after.lo}–${after.hi}`)

// Already well exposed: nothing to gain.
const good = image(10000, i => i % 256)
const goodBounds = E.levelBounds(E.luminanceHistogram(good))
check('a well-exposed photo is left alone', !E.worthStretching(goodBounds),
  `gain ${E.stretchGain(goodBounds).toFixed(3)}`)

// One blown highlight and one black pixel must not defeat the stretch — this is
// why the bounds are a percentile rather than min/max.
const withOutliers = image(10000, i => (i === 0 ? 0 : i === 1 ? 255 : 100 + (i % 41)))
const outlierBounds = E.levelBounds(E.luminanceHistogram(withOutliers))
check('a stray highlight does not peg the range open', E.worthStretching(outlierBounds),
  `bounds ${JSON.stringify(outlierBounds)} gain ${E.stretchGain(outlierBounds).toFixed(2)}`)

// Degenerate inputs must not produce a divide-by-zero or a black image.
const flat = image(100, () => 128)
const flatBounds = E.levelBounds(E.luminanceHistogram(flat))
E.applyLevels(flat, flatBounds)
check('a single-tone image survives untouched', range(flat).lo === range(flat).hi,
  JSON.stringify(range(flat)))
check('an empty histogram yields the full range',
  JSON.stringify(E.levelBounds(new Uint32Array(256))) === JSON.stringify({ low: 0, high: 255 }))

// Fully transparent padding is not picture.
const padded = new Uint8ClampedArray(400)
check('transparent pixels are excluded from the histogram',
  E.luminanceHistogram(padded).reduce((s, n) => s + n, 0) === 0)

// Colour balance: the same map on all three channels means a grey stays grey.
const colour = new Uint8ClampedArray([100, 120, 140, 255, 110, 130, 150, 255])
const before = [colour[0] - colour[1], colour[1] - colour[2]]
E.applyLevels(colour, { low: 90, high: 160 })
const afterDeltas = [colour[0] - colour[1], colour[1] - colour[2]]
check('all three channels share one map, so hue is not shifted',
  Math.sign(before[0]) === Math.sign(afterDeltas[0]) && Math.sign(before[1]) === Math.sign(afterDeltas[1]),
  `${before} → ${afterDeltas}`)

// ══ 2. Framing ══
const landscape = E.squareCrop(1600, 900)
check('a landscape crop takes the full height', landscape.size === 900, JSON.stringify(landscape))
check('…and is centred', landscape.sx === 350 && landscape.sy === 0, JSON.stringify(landscape))
const portrait = E.squareCrop(900, 1600)
check('a portrait crop is centred the other way', portrait.sx === 0 && portrait.sy === 350,
  JSON.stringify(portrait))
const square = E.squareCrop(1000, 1000)
check('an already-square photo loses nothing',
  square.sx === 0 && square.sy === 0 && square.size === 1000, JSON.stringify(square))

// ══ 3. Where it is applied ══
const upload = readFileSync('app/components/MediaUpload.tsx', 'utf8')
check('EXIF orientation is honoured, so portraits do not upload sideways',
  /imageOrientation: 'from-image'/.test(upload), 'createImageBitmap ignores EXIF rotation')
check('enhancement is opt-in per photo', /useState\(false\)/.test(upload) && /enhance && tidy/.test(upload),
  'the toggle defaults on, or is not consulted')
check('the levels pass is skipped when it would not help',
  /worthStretching\(bounds\)/.test(upload), 'levels are applied unconditionally')

const assess = readFileSync('app/cats/[id]/assess/page.tsx', 'utf8')
check('before/after capture offers it', (assess.match(/enhance /g) ?? []).length === 2,
  `${(assess.match(/enhance /g) ?? []).length} sections`)

for (const [what, file] of [
  ['belongings and condition shots', 'app/runsheet/[id]/checkin/page.tsx'],
  ['checkout condition shots', 'app/runsheet/[id]/checkout/page.tsx'],
  ['the cat profile gallery', 'app/cats/[id]/page.tsx'],
]) {
  const src = readFileSync(file, 'utf8')
  const uploaders = [...src.matchAll(/<MediaSection[^>]*\/>/g)].map(m => m[0])
  const enhanced = uploaders.filter(u => /\benhance\b/.test(u))
  check(`${what} are never cropped`, enhanced.length === 0, enhanced.join(' | '))
}

// ══ 4. What is NOT claimed ══
const src = readFileSync('lib/image/enhance.ts', 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('no straightening is attempted or implied',
  !/straighten|rotate|deskew|angle/i.test(code), 'the module claims to straighten')
check('…and the omission is stated rather than silent',
  /NOT straightening/.test(src), 'the limit is undocumented')

console.log(`\n${pass}/${total} passed`)
if (pass !== total) process.exitCode = 1
