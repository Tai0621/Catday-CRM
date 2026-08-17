import 'dotenv/config'
import './_guard.mjs'

// Track A / A4 — consent provenance + public privacy notice. Drives the Google
// Forms webhook (the reachable path through resolveCustomer → consentUpdate) to
// prove consent, its timestamp and source are recorded together, preserved on
// re-submit, and cleared when consent is withheld. Then checks the public
// /privacy notice renders and is linked from /careers. Cleans up.
//
// Requires the server to run with GOOGLE_FORMS_SECRET = VERIFY_GF_SECRET (the
// restart command in the round sets this).

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const GF = process.env.VERIFY_GF_SECRET ?? 'verifysecret'
const MARK = 'VERIFYCON'

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
const rowsOf = res => res.response.result.rows.map(row => row.map(c => (c.type === 'null' ? null : c.value)))

const phoneYes = `01900${Date.now() % 100000}`
const phoneNo = `01911${Date.now() % 100000}`
async function cleanup() {
  await pipe([exec(`DELETE FROM Customer WHERE name LIKE ?`, [t(`${MARK}%`)])])
}

async function gf(body) {
  return fetch(`${BASE}/api/google-forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': GF },
    body: JSON.stringify(body),
  })
}
const consentRow = async id => rowsOf((await pipe([exec(`SELECT marketingConsent, marketingConsentAt, marketingConsentSource FROM Customer WHERE id=?`, [t(id)])]))[0])[0]

try {
  await cleanup()

  // ── Consent given → stamped with time + source ──
  const r1 = await gf({ phone: phoneYes, name: `${MARK} Yes`, marketingConsent: 'Yes' })
  const j1 = await r1.json()
  check('webhook accepted (consent given)', r1.status === 200 && !!j1.customerId, JSON.stringify(j1))
  const idYes = j1.customerId
  const c1 = await consentRow(idYes)
  check('consent recorded true', Number(c1?.[0]) === 1)
  check('consent timestamp captured', !!c1?.[1], `at=${c1?.[1]}`)
  check('consent source captured (GoogleForm)', c1?.[2] === 'GoogleForm', `src=${c1?.[2]}`)

  // ── Re-submit → original timestamp preserved ──
  await new Promise(r => setTimeout(r, 1100))
  const r2 = await gf({ phone: phoneYes, name: `${MARK} Yes`, marketingConsent: 'Yes' })
  await r2.json()
  const c2 = await consentRow(idYes)
  check('re-submit preserves original consent timestamp', c2?.[1] === c1?.[1], `was ${c1?.[1]} now ${c2?.[1]}`)

  // ── Consent withheld → nothing stamped ──
  const r3 = await gf({ phone: phoneNo, name: `${MARK} No`, marketingConsent: 'No' })
  const j3 = await r3.json()
  const c3 = await consentRow(j3.customerId)
  check('consent false leaves timestamp + source null', Number(c3?.[0]) === 0 && c3?.[1] === null && c3?.[2] === null)

  // ── Export bundle carries the provenance ──
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const exp = await (await fetch(`${BASE}/api/customers/${idYes}/export`, { headers: { Cookie: mgr } })).json()
  check('export includes consent provenance', exp.profile?.marketingConsent === true && !!exp.profile?.marketingConsentAt && exp.profile?.marketingConsentSource === 'GoogleForm')

  // ── Public privacy notice ──
  const privRes = await fetch(`${BASE}/privacy`, { redirect: 'manual' })
  const privHtml = privRes.status === 200 ? await privRes.text() : ''
  check('/privacy is public (200, no redirect)', privRes.status === 200, `got ${privRes.status}`)
  check('/privacy shows the business name + rights', /Cat Day/.test(privHtml) && /Your rights/i.test(privHtml) && /erase/i.test(privHtml))
  const careers = await (await fetch(`${BASE}/careers`)).text()
  check('/careers links the privacy notice', careers.includes('/privacy'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
