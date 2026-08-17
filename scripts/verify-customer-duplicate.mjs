// Proves the New Customer form no longer crashes on a phone already on file.
//
// The bug: app/customers/new/page.tsx called db.customer.create() blind. Phone
// is @unique, so a repeat number threw P2002 across the server-action boundary
// into app/error.tsx — which told staff "the app was updated while this tab was
// open". Nothing had updated, and nothing was saved.
//
// Run:  VERIFY_BASE=<demo url> node --env-file=<demo env> scripts/verify-customer-duplicate.mjs
// NEVER run this against production — it seeds and deletes Customer rows.
import 'dotenv/config'
import './_guard.mjs'

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYDUPE'

// Refuse to touch the live business database.
if (/catday-crm/.test(RAW)) {
  console.error('REFUSING TO RUN: DATABASE_URL resolves to production (catday-crm).')
  console.error('Point DATABASE_URL/VERIFY_BASE at the demo before running this.')
  process.exit(1)
}

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
const rowsOf = res => (res.response?.result?.rows ?? []).map(row => row.map(c => (c.type === 'null' ? null : c.value)))
const one = async (sql, args = []) => rowsOf((await pipe([exec(sql, args)]))[0])[0]

// ── Server-action driver (AGENTS.md technique A) ────────────────────────────
// create() is a closure over the page scope, so Next ships $ACTION_REF_n plus
// bound-value fields rather than a single $ACTION_ID. Replay every hidden input
// the page rendered — a missing value="" means empty string, not "skip".
const decode = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function formsIn(html) {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => {
    const body = m[1]
    const fields = {}
    for (const tag of body.matchAll(/<input\b[^>]*>/g)) {
      const name = tag[0].match(/\bname="([^"]*)"/)?.[1]
      if (!name) continue
      fields[decode(name)] = decode(tag[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '')
    }
    return { isAction: Object.keys(fields).some(k => k.startsWith('$ACTION_')), fields, body }
  })
}
const findActionForm = html => formsIn(html).find(f => f.isAction) ?? null

async function submitForm(pageUrl, form, overrides, cookie) {
  const fd = new FormData()
  for (const [k, v] of Object.entries({ ...form.fields, ...overrides })) fd.append(k, v)
  return fetch(pageUrl, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' })
}

const existingId = crypto.randomUUID()
const erasedId = crypto.randomUUID()
const EXISTING_PHONE = '60199990001'
const ERASED_PHONE = '60199990002'
const FRESH_PHONE = '60199990003'

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Customer WHERE notes = ?`, [t(MARK)]),
    exec(`DELETE FROM Customer WHERE phone IN (?, ?, ?)`, [t(EXISTING_PHONE), t(ERASED_PHONE), t(FRESH_PHONE)]),
  ])
}

try {
  await cleanup()

  const nowIso = new Date().toISOString()
  await pipe([
    exec(`INSERT INTO Customer (id, phone, name, source, marketingConsent, needsDetails, notes, pointsBalance, walletBalance, createdAt, updatedAt)
          VALUES (?, ?, 'Dupe Target', 'WalkIn', 0, 0, ?, 0, 0, ?, ?)`,
      [t(existingId), t(EXISTING_PHONE), t(MARK), t(nowIso), t(nowIso)]),
    exec(`INSERT INTO Customer (id, phone, name, source, marketingConsent, needsDetails, notes, pointsBalance, walletBalance, erasedAt, createdAt, updatedAt)
          VALUES (?, ?, NULL, 'WalkIn', 0, 0, ?, 0, 0, ?, ?, ?)`,
      [t(erasedId), t(ERASED_PHONE), t(MARK), t(nowIso), t(nowIso), t(nowIso)]),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  if (!cookie.startsWith('auth=')) throw new Error(`no auth cookie (status ${login.status})`)

  const pageUrl = `${BASE}/customers/new`
  const html = await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()
  const form = findActionForm(html)
  check('the New Customer form renders a server action', !!form, 'no $ACTION_ field found')

  // ══ 1. The reported bug: a phone already on file ══
  const dupe = await submitForm(pageUrl, form, { phone: EXISTING_PHONE, name: 'Should Not Save' }, cookie)
  check('a duplicate phone does not 500', dupe.status !== 500, `status ${dupe.status}`)
  check('…it redirects instead of throwing', dupe.status === 303 || dupe.status === 302, `status ${dupe.status}`)
  const loc = dupe.headers.get('location') ?? ''
  check('…to the form with the existing customer flagged', loc.includes(`exists=${existingId}`), `location "${loc}"`)

  const dupeCount = await one(`SELECT COUNT(*) FROM Customer WHERE phone = ?`, [t(EXISTING_PHONE)])
  check('…and no second row was written', dupeCount[0] === '1', `found ${dupeCount[0]} rows`)

  // ══ 2. The banner the staff member actually sees ══
  const banner = await (await fetch(`${pageUrl}?exists=${existingId}`, { headers: { Cookie: cookie } })).text()
  check('the page names the existing customer', banner.includes('already on file'), 'banner copy missing')
  check('…identifies who it is', banner.includes('Dupe Target'), 'customer name missing')
  check('…and links to their profile', banner.includes(`/customers/${existingId}`), 'profile link missing')
  check('…without showing the error boundary', !banner.includes('Something went wrong'), 'error boundary rendered')

  // ══ 3. An erased record keeps its number reserved ══
  const erased = await submitForm(pageUrl, form, { phone: ERASED_PHONE, name: 'Should Not Save' }, cookie)
  check('an erased number does not 500', erased.status !== 500, `status ${erased.status}`)
  check('…and is reported as erased, not as a duplicate',
    (erased.headers.get('location') ?? '').includes('erased=1'), `location "${erased.headers.get('location')}"`)

  // ══ 4. The happy path still works ══
  const fresh = await submitForm(pageUrl, form, { phone: FRESH_PHONE, name: 'Brand New' }, cookie)
  check('a new phone still redirects to the list',
    (fresh.headers.get('location') ?? '').includes('/customers'), `location "${fresh.headers.get('location')}"`)
  const created = await one(`SELECT name FROM Customer WHERE phone = ?`, [t(FRESH_PHONE)])
  check('…and the customer was created', created?.[0] === 'Brand New', `got ${JSON.stringify(created)}`)

  console.log(`\n${pass}/${total} passed`)
  process.exitCode = pass === total ? 0 : 1
} catch (err) {
  console.error('\nFAILED:', err.message)
  process.exitCode = 1
} finally {
  await cleanup()
}
