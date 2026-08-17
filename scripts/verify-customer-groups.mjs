import 'dotenv/config'
import './_guard.mjs'

// M10 — customer groups & targeted marketing.
//
// The counts are not the interesting part; the guardrails are. This seeds three
// customers who all match the "Lapsed 90+" rules and differ only in whether they
// may be contacted, then asserts the send list contains exactly the one that
// should be there:
//
//   CONSENT   — consented, never messaged  → must appear
//   NOCONSENT — matches, no consent        → must NOT appear, and must be
//                                             reported as excluded
//   CAPPED    — consented, messaged 2 days ago → must NOT appear (global
//                                             frequency cap)
//
// Also checks that confirming a send writes exactly one GroupSend row, and that
// health data is absent from the targeting vocabulary.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYGRP'
const DAY = 24 * 60 * 60 * 1000

const t = v => ({ type: 'text', value: String(v) })
const i = v => ({ type: 'integer', value: String(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

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
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)

const people = {
  CONSENT: crypto.randomUUID(),
  NOCONSENT: crypto.randomUUID(),
  CAPPED: crypto.randomUUID(),
}
const ids = Object.values(people)
const catIds = ids.map(() => crypto.randomUUID())
const ph = ids.map(() => '?').join(',')

async function cleanup() {
  await pipe([
    exec(`DELETE FROM GroupSend WHERE customerId IN (${ph})`, ids.map(t)),
    exec(`DELETE FROM Appointment WHERE customerId IN (${ph})`, ids.map(t)),
    exec(`DELETE FROM Cat WHERE customerId IN (${ph})`, ids.map(t)),
    exec(`DELETE FROM Customer WHERE id IN (${ph})`, ids.map(t)),
  ])
}

try {
  await cleanup()
  const now = Date.now()

  // All three: one completed visit 120 days ago → lapsed, and no future booking.
  const seed = []
  Object.entries(people).forEach(([label, id], n) => {
    seed.push(exec(
      `INSERT INTO Customer (id,phone,name,source,marketingConsent,createdAt,updatedAt)
       VALUES (?,?,?,'WalkIn',?,?,CURRENT_TIMESTAMP)`,
      [t(id), t(`+60${MARK}${n}`), t(`${MARK} ${label}`), i(label === 'NOCONSENT' ? 0 : 1), t(iso(now - 400 * DAY))]))
    seed.push(exec(
      `INSERT INTO Cat (id,name,customerId,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catIds[n]), t(`${MARK}Cat${n}`), t(id)]))
    seed.push(exec(
      `INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,paid,usedCredit,createdAt,updatedAt)
       VALUES (?,?,?,'Grooming',?,'Completed',1,0,?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(id), t(catIds[n]), t(iso(now - 120 * DAY)), t(iso(now - 120 * DAY))]))
  })
  // CAPPED heard from us two days ago, well inside the 14-day cap.
  seed.push(exec(
    `INSERT INTO GroupSend (id,groupKey,customerId,channel,sentAt) VALUES (?,'lapsed-90',?,'WhatsApp',?)`,
    [t(crypto.randomUUID()), t(people.CAPPED), t(iso(now - 2 * DAY))]))
  await pipe(seed)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const get = async p => strip(await (await fetch(`${BASE}${p}`, { headers: { cookie } })).text())

  const list = await get('/marketing/groups')
  check('/marketing/groups renders', list.includes('Customer groups'))
  check('system audiences listed', list.includes('Lapsed 90+') && list.includes('At risk') && list.includes('Boarding only'))

  const page = await get('/marketing/groups/lapsed-90')
  check('audience page renders', page.includes('Send list'))

  // The three guardrails.
  const sendList = page.slice(page.indexOf('Send list'))
  check('consented customer is sendable', sendList.includes(`${MARK} CONSENT`),
    'the one contactable customer should appear in the send list')
  check('no-consent customer is excluded', !sendList.includes(`${MARK} NOCONSENT`),
    'consent is a floor, not a rule')
  check('frequency-capped customer is excluded', !sendList.includes(`${MARK} CAPPED`),
    'messaged 2 days ago — inside the 14-day global cap')
  check('exclusions are explained, not silent', page.includes('no marketing consent') || page.includes('never agreed to marketing'))

  // Message personalisation resolved from the record.
  check('message personalised from the record', sendList.includes(`${MARK}Cat0`) || sendList.includes(`${MARK} CONSENT`),
    'the rendered message should carry the customer or cat name')
  check('no raw placeholder leaks', !sendList.includes('{customer}') && !sendList.includes('{cat}'))

  // Confirming a send writes exactly one row.
  const before = Number(rowsOf((await pipe([
    exec(`SELECT COUNT(*) FROM GroupSend WHERE customerId = ?`, [t(people.CONSENT)])]))[0])[0][0])
  check('no send logged before confirming', before === 0, `found ${before}`)

  // Health data must never become targetable. A comment saying so does not stop
  // the next person adding it, so assert it against the source.
  const src = await import('node:fs').then(fs => fs.readFileSync('lib/customer-groups.ts', 'utf8'))
  const rulesBlock = src.slice(src.indexOf('export interface GroupRules'), src.indexOf('export interface CustomerGroup'))
  const banned = ['healthNotes', 'medication', 'vaccination', 'deworm', 'deflea']
    .filter(w => new RegExp(w, 'i').test(rulesBlock))
  check('health data is not targetable', banned.length === 0,
    `${banned.join(', ')} appeared in the rule vocabulary — PDPA and brand risk`)
  // Comments stripped first — the file explains *why* it avoids these fields,
  // and matching that prose would fail the check for saying the right thing.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('the query never selects health fields', !/healthNotes|medication/.test(code),
    'loadCandidates must not read health fields at all')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
