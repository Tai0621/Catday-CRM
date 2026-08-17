import 'dotenv/config'
import './_guard.mjs'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// C7 — brand autopilot.
//
// Extraction happens in the browser, so what is testable here is the part that
// decides whether a palette is usable at all:
//
//   • the contrast maths, against WCAG's own anchors
//   • the pairings — that it checks where the colours ACTUALLY land in this
//     design system, not a generic foreground/background score
//   • nearestAccessible — that the correction stays the same colour
//   • the server re-checking everything the client proposed, and refusing a
//     failing palette unless a human explicitly overrode it
//
// contrast.ts imports nothing, so it compiles standalone and is exercised
// directly.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYC7'
const t = v => ({ type: 'text', value: String(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DBTOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const rows = res => (res.response?.result?.rows ?? []).map(r => r.map(c => c.value))
const one = async (sql, args = []) => rows((await pipe([exec(sql, args)]))[0])

let before = []
const BRAND_KEYS = ['brand.primary', 'brand.ink']

async function cleanup() {
  await pipe([exec(`DELETE FROM "AuditLog" WHERE action = 'brand.colours' AND at > datetime('now','-1 hour')`)])
  const snapshot = new Map(before)
  for (const key of BRAND_KEYS) {
    const value = snapshot.get(key)
    await pipe([value == null
      ? exec(`DELETE FROM "Setting" WHERE key = ?`, [t(key)])
      : exec(`INSERT INTO "Setting" (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [t(key), t(value)])])
  }
}

// ── form driver (AGENTS.md technique A) ──
const formsIn = html => [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => ({
  actionId: (m[1].match(/name="(\$ACTION_ID_[0-9a-f]+)"/) ?? [])[1] ?? null, body: m[1],
}))
const findForm = (html, marker) => formsIn(html).find(f => f.actionId && f.body.includes(marker)) ?? null

async function submit(url, form, fields, cookie) {
  const fd = new FormData()
  fd.append(form.actionId, '')
  for (const [k, v] of fields) fd.append(k, v)
  const r = await fetch(url, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' })
  await r.text()
  return r.status
}

try {
  before = await one(`SELECT key, value FROM "Setting" WHERE key IN ('brand.primary','brand.ink')`)
  await cleanup()

  // ══ 1. The maths ══
  const outDir = mkdtempSync(join(tmpdir(), 'c7-'))
  execSync(`npx tsc lib/brand/contrast.ts --outDir "${outDir}" --module es2022 --target es2022 --moduleResolution bundler`,
    { stdio: 'pipe' })
  const C = await import(pathToFileURL(join(outDir, 'contrast.js')).href)

  const ratio = (a, b) => C.contrastRatio(C.parseHex(a), C.parseHex(b))

  check('black on white is WCAG\'s maximum 21:1', ratio('#000000', '#FFFFFF') === 21, String(ratio('#000000', '#FFFFFF')))
  check('a colour against itself is 1:1', ratio('#B14919', '#B14919') === 1, String(ratio('#B14919', '#B14919')))
  check('the ratio is symmetric', ratio('#123456', '#F2EDE0') === ratio('#F2EDE0', '#123456'))
  check('mid grey on white matches the published value',
    Math.abs(ratio('#767676', '#FFFFFF') - 4.54) < 0.05, String(ratio('#767676', '#FFFFFF')))
  check('a malformed hex is rejected rather than guessed', C.parseHex('not-a-colour') === null)
  check('a hex without the hash still parses', C.parseHex('B14919') !== null)

  // ══ 2. The pairings are this design system's, not a generic pair ══
  const checks = C.evaluateBrand('#B14919', '#2D1907')
  check('five real pairings are evaluated', checks.length === 5, `${checks.length}`)
  const labels = checks.map(c => c.label).join(' | ')
  for (const needle of ['Body text on the page', 'Text on a card', 'Links on the page', 'Button label on the accent']) {
    check(`it checks: ${needle.toLowerCase()}`, labels.includes(needle), labels)
  }
  check('a non-text accent is held to 3:1, not 4.5:1',
    checks.find(c => c.kind === 'accent')?.required === 3,
    JSON.stringify(checks.find(c => c.kind === 'accent')))
  check('every failing check names which colour to change',
    checks.every(c => c.fix === 'primary' || c.fix === 'ink'), JSON.stringify(checks.map(c => c.fix)))

  // The shipped palette must at least keep body text readable.
  const bodyText = checks.find(c => c.label === 'Body text on the page')
  check('the shipped ink passes on the page', bodyText?.passes === true, JSON.stringify(bodyText))

  // ══ 3. A bad palette is caught ══
  const yellow = C.evaluateBrand('#FFD700', '#2D1907')
  check('a bright yellow accent fails as a link colour',
    yellow.find(c => c.label === 'Links on the page')?.passes === false,
    JSON.stringify(yellow.find(c => c.label === 'Links on the page')))
  check('…and brandPasses agrees', C.brandPasses('#FFD700', '#2D1907') === false)
  const paleInk = C.evaluateBrand('#B14919', '#CCCCCC')
  check('pale text on cream fails', paleInk.find(c => c.fix === 'ink')?.passes === false)

  // ══ 4. The correction stays the same colour ══
  const fixed = C.nearestAccessible('#FFD700', 'primary')
  check('a failing accent is corrected to something that passes',
    !!fixed && C.evaluateBrand(fixed, '#2D1907').filter(c => c.fix === 'primary').every(c => c.passes),
    String(fixed))
  const hueOf = hex => Math.round(C.rgbToHsl(C.parseHex(hex)).h * 360)
  check('…keeping the hue, so it is still the brand',
    Math.abs(hueOf(fixed) - hueOf('#FFD700')) <= 2, `${hueOf('#FFD700')}° → ${hueOf(fixed)}°`)
  check('…and it is darker, not a different colour',
    C.rgbToHsl(C.parseHex(fixed)).l < C.rgbToHsl(C.parseHex('#FFD700')).l,
    `${C.rgbToHsl(C.parseHex(fixed)).l} vs ${C.rgbToHsl(C.parseHex('#FFD700')).l}`)
  check('a palette that already works is returned unchanged',
    C.nearestAccessible('#2D1907', 'ink') === '#2D1907', String(C.nearestAccessible('#2D1907', 'ink')))
  check('hsl survives a round trip', C.toHex(C.hslToRgb(C.rgbToHsl(C.parseHex('#B14919')))) === '#B14919',
    C.toHex(C.hslToRgb(C.rgbToHsl(C.parseHex('#B14919')))))

  // ══ 5. Auth ══
  const anon = await fetch(`${BASE}/admin/branding`, { redirect: 'manual' })
  check('the studio is behind the manager gate',
    anon.status >= 300 && anon.status < 400 && (anon.headers.get('location') ?? '').includes('/login'),
    `status ${anon.status}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const url = `${BASE}/admin/branding`
  const page = await fetch(url, { headers: { cookie } })
  const html = await page.text()
  check('the studio renders', page.status === 200, `status ${page.status}`)
  check('…with the live preview', /Primary button/.test(html), 'no preview')
  check('…and the readability report', /needs/.test(html) && /Links on the page/.test(html), 'no contrast report')

  const form = findForm(html, 'name="primary"')
  check('the save form is a real no-JS form', !!form, 'no $ACTION_ID form carrying the colour fields')

  // ══ 6. The server does not trust the client ══
  const readBrand = async () => Object.fromEntries(
    await one(`SELECT key, value FROM "Setting" WHERE key IN ('brand.primary','brand.ink')`))

  await submit(url, form, [['primary', 'chartreuse'], ['ink', '#2D1907']], cookie)
  check('a non-hex colour is refused', !(await readBrand())['brand.primary'],
    JSON.stringify(await readBrand()))

  // Bright yellow fails the link pairing; without the tick it must not save.
  await submit(url, form, [['primary', '#FFD700'], ['ink', '#2D1907']], cookie)
  check('a palette below the readable threshold is refused', !(await readBrand())['brand.primary'],
    JSON.stringify(await readBrand()))

  // A good palette saves without any override.
  await submit(url, form, [['primary', '#8A3B14'], ['ink', '#241405']], cookie)
  const good = await readBrand()
  check('a readable palette saves', good['brand.primary'] === '#8A3B14' && good['brand.ink'] === '#241405',
    JSON.stringify(good))

  const audit = await one(
    `SELECT summary FROM "AuditLog" WHERE action = 'brand.colours' ORDER BY at DESC LIMIT 1`)
  check('the change is audited', /8A3B14/i.test(String(audit[0]?.[0] ?? '')), String(audit[0]?.[0]))

  // With the override, a failing palette is allowed — and the audit says so.
  await submit(url, form, [['primary', '#FFD700'], ['ink', '#2D1907'], ['override', 'yes']], cookie)
  const overridden = await readBrand()
  check('an explicit override lets a failing palette through',
    overridden['brand.primary'] === '#FFD700', JSON.stringify(overridden))
  const auditOverride = await one(
    `SELECT summary FROM "AuditLog" WHERE action = 'brand.colours' ORDER BY at DESC LIMIT 1`)
  check('…and the audit records that it was below threshold',
    /below the readable threshold/i.test(String(auditOverride[0]?.[0] ?? '')), String(auditOverride[0]?.[0]))

  // ══ 7. It actually re-skins the app ══
  const dash = await (await fetch(`${BASE}/admin/branding`, { headers: { cookie } })).text()
  check('the saved accent reaches the injected theme variables',
    dash.includes('--brand-primary:#FFD700') || dash.includes('--brand-primary: #FFD700'),
    (dash.match(/--brand-primary:[^;]*/) ?? ['not found'])[0])

  // ══ 8. Source guarantees ══
  const actionSrc = readFileSync('app/admin/branding/actions.ts', 'utf8')
  check('the server re-runs the contrast check itself',
    /evaluateBrand/.test(actionSrc), 'the server trusts the client\'s assessment')
  check('…and re-parses the hex rather than storing what was posted',
    /parseHex/.test(actionSrc) && /toHex/.test(actionSrc))
  const studioSrc = readFileSync('app/admin/branding/BrandStudio.tsx', 'utf8')
  check('extraction is client-side, with no image decoding shipped to the server',
    /'use client'/.test(studioSrc) && /getImageData/.test(studioSrc))
  check('a cross-origin logo degrades to a message instead of throwing',
    /catch\s*\{[\s\S]{0,120}return \[\]/.test(studioSrc), 'a tainted canvas is unhandled')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
