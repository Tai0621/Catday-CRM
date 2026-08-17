import 'dotenv/config'
import './_guard.mjs'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// C6 — generative onboarding.
//
// No model call. The generation is one call; what has to be right is on either
// side of it:
//
//   • normalisation — a negative price or an invented service category must
//     never reach a form with a Commit button under it, because at that point
//     it reads as the system's own suggestion rather than a model's guess
//   • additive commits — running this on a live business must not rewrite its
//     price list. Existing names are skipped, never updated.
//   • the destructive gate — identity, colours and voice DO replace, so on an
//     instance with real customers they need an explicit tick
//   • templates land switched off — a variant row is copy a customer reads,
//     and C4's rotation would start showing it the moment it exists
//
// plan.ts imports only constants.ts, which imports nothing, so the validator
// compiles standalone and is exercised directly.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYC6'
const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const iv = v => ({ type: 'integer', value: String(v) })
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

const iso = d => d.toISOString().replace('Z', '+00:00')
const planId = `${MARK}-plan`
const EXISTING_SERVICE = `${MARK} Existing Groom`
const NEW_SERVICE = `${MARK} New Groom`
const EXISTING_PRICE = 111

// Brand settings are the one destructive group this touches; snapshot to restore.
let brandBefore = []

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "OnboardingPlan" WHERE id = ?`, [t(planId)]),
    exec(`DELETE FROM "Service" WHERE name LIKE '${MARK}%'`),
    exec(`DELETE FROM "Room" WHERE name LIKE '${MARK}%'`),
    exec(`DELETE FROM "MembershipTier" WHERE name LIKE '${MARK}%'`),
    exec(`DELETE FROM "ActionVariant" WHERE label LIKE '${MARK}%'`),
    exec(`DELETE FROM "AuditLog" WHERE entityId = ?`, [t(planId)]),
  ])
  // Restore, or DELETE where there was no row to begin with. These keys fall
  // back to DEFAULT_CONFIG when absent, so leaving a row behind is a real change
  // to the demo's branding — and would make the next run's "writes nothing"
  // assertion pass against a value this script wrote.
  const snapshot = new Map(brandBefore)
  for (const key of ['brand.primary', 'brand.ink']) {
    const value = snapshot.get(key)
    await pipe([value == null
      ? exec(`DELETE FROM "Setting" WHERE key = ?`, [t(key)])
      : exec(`INSERT INTO "Setting" (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [t(key), t(value)])])
  }
}

// ── form driver (AGENTS.md technique A) ──
function formsIn(html) {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => {
    const body = m[1]
    return { actionId: (body.match(/name="(\$ACTION_ID_[0-9a-f]+)"/) ?? [])[1] ?? null, body }
  })
}
const findForm = (html, marker) => formsIn(html).find(f => f.actionId && f.body.includes(marker)) ?? null

async function submit(url, form, fields, cookie) {
  const fd = new FormData()
  fd.append(form.actionId, '')
  for (const [k, v] of fields) fd.append(k, v)
  const r = await fetch(url, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' })
  return r.status
}

try {
  brandBefore = await one(`SELECT key, value FROM "Setting" WHERE key IN ('brand.primary','brand.ink')`)
  await cleanup()

  // ══ 1. Normalisation, exercised directly ══
  const outDir = mkdtempSync(join(tmpdir(), 'c6-'))
  execSync(`npx tsc lib/onboarding/plan.ts --outDir "${outDir}" --module es2022 --target es2022 --moduleResolution bundler`,
    { stdio: 'pipe' })
  // tsc emits the specifier verbatim ('../constants'); Node's ESM loader needs
  // the extension, so add it before importing.
  const planJs = join(outDir, 'onboarding/plan.js')
  writeFileSync(planJs, readFileSync(planJs, 'utf8').replace(/from '(\.\.?\/[^']+)'/g, "from '$1.js'"))
  const { normalisePlan } = await import(pathToFileURL(planJs).href)
  const TYPES = ['WinBack', 'RebookCheckout', 'GroomingDue']

  const hostile = normalisePlan({
    business: { name: 'X'.repeat(500), openHour: 20, closeHour: 3, currencyCode: 'myr' },
    services: [
      { name: 'Free Groom', category: 'Grooming', price: -50, durationMin: 5000 },
      { name: 'Gold Plated', category: 'Teleportation', price: 99999999, durationMin: 60 },
      { name: 'Free Groom', category: 'Bath', price: 10 },
      { name: '', category: 'Bath', price: 10 },
    ],
    rooms: [{ name: 'Vault', type: 'Bunker', capacity: 900 }],
    tiers: [{ name: 'Auto Tier', qualification: 'Auto', annualSpendThreshold: 5000, pointsMultiplier: 99 }],
    brand: { primary: 'red', ink: '#2D1907' },
    templates: [{ type: 'Nonsense', label: 'a', body: 'b' }],
  }, TYPES)

  check('a negative price is clamped to zero', hostile.services[0].price === 0, String(hostile.services[0].price))
  check('an absurd duration is capped', hostile.services[0].durationMin === 600, String(hostile.services[0].durationMin))
  check('an invented service category falls back to a real one',
    hostile.services[1].category === 'Grooming', hostile.services[1].category)
  check('an absurd price is capped, not passed through',
    hostile.services[1].price === 5000, String(hostile.services[1].price))
  check('duplicate service names are dropped',
    hostile.services.filter(s => s.name === 'Free Groom').length === 1, JSON.stringify(hostile.services.map(s => s.name)))
  check('nameless rows are dropped', hostile.services.every(s => s.name), 'a blank name survived')
  check('an invented room type falls back', hostile.rooms[0].type === 'Standard', hostile.rooms[0].type)
  check('room capacity is bounded', hostile.rooms[0].capacity === 20, String(hostile.rooms[0].capacity))
  check('closing before opening is corrected',
    hostile.business.closeHour > hostile.business.openHour,
    `${hostile.business.openHour} → ${hostile.business.closeHour}`)
  check('long strings are truncated', hostile.business.name.length <= 80, String(hostile.business.name.length))
  check('a currency code is upper-cased', hostile.business.currencyCode === 'MYR', hostile.business.currencyCode)
  check('a non-hex colour falls back rather than reaching the page',
    /^#[0-9A-F]{6}$/.test(hostile.brand.primary), hostile.brand.primary)
  check('a spend threshold on a non-spending tier is discarded',
    hostile.tiers[0].annualSpendThreshold === null, String(hostile.tiers[0].annualSpendThreshold))
  check('a points multiplier is bounded', hostile.tiers[0].pointsMultiplier === 10, String(hostile.tiers[0].pointsMultiplier))
  check('a template for an unknown action type falls back',
    TYPES.includes(hostile.templates[0].type), hostile.templates[0].type)
  check('missing groups become empty, not undefined',
    Array.isArray(hostile.notes) && Array.isArray(hostile.expenseGuidance), 'a group came back undefined')

  // ══ 2. Seed an existing service and a stored plan ══
  const now = iso(new Date())
  await pipe([
    exec(`INSERT INTO "Service" (id,name,category,durationMin,price,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?, 'Grooming', 60, ?, 1, 900, ?, ?)`,
      [t(`${MARK}-svc`), t(EXISTING_SERVICE), f(EXISTING_PRICE), t(now), t(now)]),
  ])

  const plan = {
    business: { name: `${MARK} Business`, tagline: 'x', phone: '', address: '', email: '', currencyCode: 'MYR', currencySymbol: 'RM', locale: 'en-MY', timezone: 'Asia/Kuala_Lumpur', openHour: 10, closeHour: 19 },
    services: [
      { name: EXISTING_SERVICE, category: 'Grooming', durationMin: 30, price: 999 },
      { name: NEW_SERVICE, category: 'Bath', durationMin: 45, price: 88 },
    ],
    rooms: [{ name: `${MARK} Room A`, type: 'Suite', capacity: 4 }],
    tiers: [{ name: `${MARK} Tier`, tagline: 'x', qualification: 'Spending', annualSpendThreshold: 2000, pointsMultiplier: 1.5, benefits: ['a'] }],
    brand: { primary: '#123456', ink: '#654321' },
    voice: { tone: 'x', languages: 'x', emoji: 'x', signature: 'x', avoid: 'x' },
    templates: [{ type: 'WinBack', label: `${MARK} Warm`, body: 'Hello {customer}, {cat} misses us.' }],
    expenseGuidance: [], notes: [],
  }
  await pipe([exec(
    `INSERT INTO "OnboardingPlan" (id,createdAt,description,plan,committed,model) VALUES (?,?,?,?,'[]','seeded')`,
    [t(planId), t(now), t(`${MARK} a cat grooming business used for verification purposes only`), t(JSON.stringify(plan))])])

  // ══ 3. Auth ══
  const anon = await fetch(`${BASE}/admin/onboarding`, { redirect: 'manual' })
  check('onboarding is behind the manager gate',
    anon.status >= 300 && anon.status < 400 && (anon.headers.get('location') ?? '').includes('/login'),
    `status ${anon.status}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const url = `${BASE}/admin/onboarding`
  const page = await fetch(url, { headers: { cookie } })
  const html = await page.text()
  check('the plan renders for editing', page.status === 200 && html.includes(NEW_SERVICE), `status ${page.status}`)
  check('a live instance is warned about', html.includes('already has live customer data'),
    'no warning on an instance with customers')

  // ══ 4. Catalogue commits are additive ══
  const servicesForm = findForm(html, 'value="services"')
  check('the services section is a real form', !!servicesForm, 'no $ACTION_ID form for services')

  await submit(url, servicesForm, [
    ['planId', planId], ['group', 'services'],
    ['sName', EXISTING_SERVICE], ['sCategory', 'Grooming'], ['sDuration', '30'], ['sPrice', '999'],
    ['sName', NEW_SERVICE], ['sCategory', 'Bath'], ['sDuration', '45'], ['sPrice', '88'],
  ], cookie)

  const existing = await one(`SELECT price, durationMin FROM "Service" WHERE name = ?`, [t(EXISTING_SERVICE)])
  check('an existing service is left exactly as it was',
    Number(existing[0]?.[0]) === EXISTING_PRICE && Number(existing[0]?.[1]) === 60,
    `price ${existing[0]?.[0]}, duration ${existing[0]?.[1]} — the plan proposed 999 / 30`)

  const created = await one(`SELECT price, category FROM "Service" WHERE name = ?`, [t(NEW_SERVICE)])
  check('a new service is created', created.length === 1, `${created.length} rows`)
  check('…with the edited values', Number(created[0]?.[0]) === 88 && created[0]?.[1] === 'Bath',
    JSON.stringify(created[0]))

  const audit = await one(
    `SELECT action, summary FROM "AuditLog" WHERE entityId = ? AND action = 'onboarding.services'`, [t(planId)])
  check('the commit is audited', audit.length === 1, `${audit.length} rows`)
  check('…and names what was skipped', /skipped/i.test(String(audit[0]?.[1] ?? '')), String(audit[0]?.[1]))

  // Committing again must not duplicate.
  const page2 = await fetch(url, { headers: { cookie } })
  const html2 = await page2.text()
  await submit(url, findForm(html2, 'value="services"'), [
    ['planId', planId], ['group', 'services'],
    ['sName', NEW_SERVICE], ['sCategory', 'Bath'], ['sDuration', '45'], ['sPrice', '88'],
  ], cookie)
  const dupes = await one(`SELECT COUNT(*) FROM "Service" WHERE name = ?`, [t(NEW_SERVICE)])
  check('committing twice does not duplicate', Number(dupes[0][0]) === 1, `${dupes[0][0]} rows`)
  check('the section is marked committed', html2.includes('committed'), 'no committed marker')

  // ══ 5. Rooms, tiers, templates ══
  await submit(url, findForm(html2, 'value="rooms"'), [
    ['planId', planId], ['group', 'rooms'],
    ['rName', `${MARK} Room A`], ['rType', 'Suite'], ['rCapacity', '4'],
  ], cookie)
  const room = await one(`SELECT type, capacity FROM "Room" WHERE name = ?`, [t(`${MARK} Room A`)])
  check('a room commits with its type and capacity',
    room[0]?.[0] === 'Suite' && Number(room[0]?.[1]) === 4, JSON.stringify(room[0]))

  await submit(url, findForm(html2, 'value="tiers"'), [
    ['planId', planId], ['group', 'tiers'],
    ['tName', `${MARK} Tier`], ['tTagline', 'x'], ['tQualification', 'Spending'],
    ['tThreshold', '2000'], ['tMultiplier', '1.5'],
  ], cookie)
  const tier = await one(
    `SELECT qualification, annualSpendThreshold, pointsMultiplier FROM "MembershipTier" WHERE name = ?`,
    [t(`${MARK} Tier`)])
  check('a spending tier keeps its threshold',
    tier[0]?.[0] === 'Spending' && Number(tier[0]?.[1]) === 2000, JSON.stringify(tier[0]))

  await submit(url, findForm(html2, 'value="templates"'), [
    ['planId', planId], ['group', 'templates'],
    ['mType', 'WinBack'], ['mLabel', `${MARK} Warm`], ['mBody', 'Hello {customer}, {cat} misses us.'],
  ], cookie)
  const variant = await one(`SELECT isActive, type FROM "ActionVariant" WHERE label = ?`, [t(`${MARK} Warm`)])
  check('a message template commits', variant.length === 1, `${variant.length} rows`)
  check('…switched OFF, so nothing is sent before it is read',
    Number(variant[0]?.[0]) === 0, `isActive ${variant[0]?.[0]}`)

  // ══ 6. The destructive gate ══
  const brandForm = findForm(html2, 'value="brand"')
  check('destructive sections carry a confirmation', html2.includes('Replace the current values'),
    'no confirmation offered on a live instance')

  await submit(url, brandForm, [['planId', planId], ['group', 'brand'], ['primary', '#123456'], ['ink', '#654321']], cookie)
  const unconfirmed = await one(`SELECT value FROM "Setting" WHERE key = 'brand.primary'`)
  check('without the tick, a destructive commit writes nothing',
    (unconfirmed[0]?.[0] ?? '') !== '#123456', `brand.primary is now ${unconfirmed[0]?.[0]}`)

  await submit(url, brandForm, [
    ['planId', planId], ['group', 'brand'], ['primary', '#123456'], ['ink', '#654321'], ['confirm', 'yes'],
  ], cookie)
  const confirmed = await one(`SELECT value FROM "Setting" WHERE key = 'brand.primary'`)
  check('with the tick, it commits', confirmed[0]?.[0] === '#123456', String(confirmed[0]?.[0]))

  // ══ 7. Source guarantees ══
  const commitSrc = readFileSync('lib/onboarding/commit.ts', 'utf8')
  check('no catalogue commit ever updates or deletes',
    !/db\.(service|room|membershipTier|actionVariant)\.(update|delete|updateMany|deleteMany|upsert)/.test(commitSrc),
    'a catalogue commit can overwrite existing rows')
  check('the destructive groups are named explicitly',
    /DESTRUCTIVE_GROUPS[^=]*=\s*\[[^\]]*'business'[^\]]*'brand'[^\]]*'voice'/.test(commitSrc),
    'the destructive list does not cover identity, colours and voice')
  const genSrc = readFileSync('lib/onboarding/generate.ts', 'utf8')
  check('generation fails closed without a key', /no-key/.test(genSrc) && /aiConfigured()/.test(genSrc))
  check('generation respects the AI kill switch', /budget\.limit === 0/.test(genSrc))
  check('usage is recorded against the budget', /recordUsage/.test(genSrc))
  const planSrc = readFileSync('lib/onboarding/plan.ts', 'utf8')
  check('the plan is re-normalised on read, not trusted from storage',
    /normalisePlan\(JSON\.parse/.test(readFileSync('lib/onboarding/index.ts', 'utf8')),
    'a stored plan bypasses validation')
  check('expense categories are advisory, never created',
    /advisory/i.test(planSrc) && !/db\.\w+\.create/.test(planSrc), 'the plan module writes to the database')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
