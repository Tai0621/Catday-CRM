import 'dotenv/config'
import { readFileSync } from 'node:fs'

// M7 — the Academy as a funnel.
//
// The claims worth proving:
//
//   • an attendee is matched to the CRM at enrolment, by phone then email
//   • conversion counts only bookings made AFTER the enrolment — otherwise a
//     regular who takes a class inflates the funnel and makes workshops look
//     more effective the more loyal the attendee already was
//   • the follow-up list waits before chasing, and gives up eventually
//   • the follow-up reaches the Action Inbox, where staff actually work
//   • re-matching picks up attendees who became customers later, which is the
//     conversion itself

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYM7'
const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const nul = { type: 'null' }
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
const DAY = 86400000
const ago = n => new Date(Date.now() - n * DAY)

const loyalId = `${MARK}-loyal`      // a customer since before the workshop
const laterId = `${MARK}-later`      // became a customer after the workshop
const catId = `${MARK}-cat`
const PHONE_LOYAL = '60199000001'
const EMAIL_LATER = `${MARK.toLowerCase()}-later@example.com`

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

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "AcademyEnrollment" WHERE studentName LIKE '${MARK}%' OR course LIKE '${MARK}%'`),
    exec(`DELETE FROM "Appointment" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Transaction" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Cat" WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM "Customer" WHERE id IN (?,?)`, [t(loyalId), t(laterId)]),
  ])
}

try {
  await cleanup()

  const now = iso(new Date())
  await pipe([
    exec(`INSERT INTO "Customer" (id,phone,name,email,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?,?, 'WalkIn', 1, ?, ?)`,
      [t(loyalId), t(PHONE_LOYAL), t(`${MARK} Loyal`), nul, t(iso(ago(400))), t(now)]),
    exec(`INSERT INTO "Cat" (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`,
      [t(catId), t(loyalId), t(`${MARK} Cat`), t(now), t(now)]),
  ])

  // ── the enrolments under test ──
  // A: a long-standing customer who took a class 40 days ago. They had a groom
  //    BEFORE the class and one AFTER — only the second may count.
  // B: enrolled 40 days ago, never a customer → the follow-up case.
  // C: enrolled 3 days ago, never a customer → too soon to chase.
  const enrolA = `${MARK}-enrol-a`, enrolB = `${MARK}-enrol-b`, enrolC = `${MARK}-enrol-c`
  await pipe([
    exec(`INSERT INTO "AcademyEnrollment" (id,studentName,email,phone,course,status,enrolledAt,customerId,updatedAt)
          VALUES (?,?,?,?,?, 'Completed', ?, ?, ?)`,
      [t(enrolA), t(`${MARK} Loyal`), t('a@example.com'), t(PHONE_LOYAL), t(`${MARK} Basics`), t(iso(ago(40))), t(loyalId), t(now)]),
    exec(`INSERT INTO "AcademyEnrollment" (id,studentName,email,phone,course,status,enrolledAt,customerId,updatedAt)
          VALUES (?,?,?,?,?, 'Completed', ?, NULL, ?)`,
      [t(enrolB), t(`${MARK} Stranger`), t(EMAIL_LATER), t('60199000002'), t(`${MARK} Basics`), t(iso(ago(40))), t(now)]),
    exec(`INSERT INTO "AcademyEnrollment" (id,studentName,email,phone,course,status,enrolledAt,customerId,updatedAt)
          VALUES (?,?,?,?,?, 'Active', ?, NULL, ?)`,
      [t(enrolC), t(`${MARK} Fresh`), t('c@example.com'), t('60199000003'), t(`${MARK} Basics`), t(iso(ago(3))), t(now)]),
  ])

  // A groom BEFORE the class must not count as conversion; one AFTER must.
  await pipe([
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Completed', ?, 1, ?, ?)`,
      [t(`${MARK}-before`), t(loyalId), t(catId), t(iso(ago(200))), f(100), t(now), t(now)]),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const url = `${BASE}/academy`
  const load = async () => (await fetch(url, { headers: { cookie } })).text()
  let html = await load()
  check('the academy page renders the funnel', html.includes('Attendee → customer'), 'no funnel panel')

  // ══ 1. A pre-existing groom does not count as conversion ══
  const funnelOf = async () => {
    const r = await one(`SELECT COUNT(*) FROM "AcademyEnrollment" WHERE studentName LIKE '${MARK}%'`)
    return Number(r[0][0])
  }
  check('three enrolments are under test', (await funnelOf()) === 3, String(await funnelOf()))
  check('a groom taken BEFORE the class is not a conversion',
    /no groom yet/.test(html), 'the earlier booking was counted')

  // ══ 2. A groom after the class is ══
  await pipe([exec(
    `INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
     VALUES (?,?,?, 'Grooming', ?, 'Completed', ?, 1, ?, ?)`,
    [t(`${MARK}-after`), t(loyalId), t(catId), t(iso(ago(10))), f(150), t(now), t(now)])])
  html = await load()
  check('a groom taken AFTER the class is a conversion', /booked\s/.test(html), 'the later booking was not counted')

  // ══ 3. Revenue after enrolment is attributed ══
  await pipe([exec(
    `INSERT INTO "Transaction" (id,customerId,date,total,category,createdAt) VALUES (?,?,?,?, 'Grooming', ?)`,
    [t(`${MARK}-tx`), t(loyalId), t(iso(ago(9))), f(150), t(now)])])
  html = await load()
  check('spend since enrolling is attributed', /spent by attendees since they enrolled/.test(html),
    'no attributed revenue line')

  // ══ 4. The follow-up list waits, then gives up ══
  check('an attendee from 40 days ago is chased', html.includes(`${MARK} Stranger`), 'not in the follow-up list')
  // Slicing the rendered section out of the HTML is unreliable — the same
  // strings appear again inside the embedded RSC flight payload, so a
  // non-greedy match can start there and swallow the whole page. The Action
  // Inbox is the honest surface to assert against: an attendee who is not being
  // chased appears there not at all.
  const inbox = await (await fetch(`${BASE}/actions`, { headers: { cookie } })).text()
  check('the follow-up appears in the Action Inbox', inbox.includes('Academy follow-up'),
    'no AcademyFollowUp card')
  check('…naming the attendee', inbox.includes(`${MARK} Stranger`), 'the card does not name who')
  check('…and one enrolled 3 days ago is left alone', !inbox.includes(`${MARK} Fresh`),
    'a fresh attendee is already being chased')

  // React splits adjacent text nodes around an interpolated value.
  check('the waiting period is explained on screen', /at least[\s\S]{0,20}14[\s\S]{0,20}days ago/.test(html),
    'no explanation of the delay')

  // ══ 6. Matching ══
  // The stranger becomes a customer AFTER the workshop — the conversion itself.
  await pipe([exec(
    `INSERT INTO "Customer" (id,phone,name,email,source,marketingConsent,createdAt,updatedAt)
     VALUES (?,?,?,?, 'WalkIn', 1, ?, ?)`,
    [t(laterId), t('60199000002'), t(`${MARK} Stranger`), t(EMAIL_LATER), t(now), t(now)])])

  const linkedBefore = Number((await one(
    `SELECT COUNT(*) FROM "AcademyEnrollment" WHERE id = ? AND customerId IS NOT NULL`, [t(enrolB)]))[0][0])
  check('a later signup is not linked on its own', linkedBefore === 0, `${linkedBefore}`)

  html = await load()
  const relink = findForm(html, 'Re-match attendees')
  check('re-matching is offered as a real form', !!relink, 'no re-match form')
  await submit(url, relink, [], cookie)

  const linkedAfter = await one(`SELECT customerId FROM "AcademyEnrollment" WHERE id = ?`, [t(enrolB)])
  check('re-matching links them by phone', linkedAfter[0]?.[0] === laterId, String(linkedAfter[0]?.[0]))

  // ══ 7. Enrolling matches immediately ══
  html = await load()
  const enrolForm = findForm(html, 'name="studentName"')
  check('the enrolment form is a real form', !!enrolForm, 'no enrolment form')
  await submit(url, enrolForm, [
    ['studentName', `${MARK} Walkin`], ['email', 'walkin@example.com'],
    ['phone', '019-900 0001'], ['course', `${MARK} Basics`], ['notes', ''],
  ], cookie)

  const fresh = await one(
    `SELECT customerId, phone FROM "AcademyEnrollment" WHERE studentName = ?`, [t(`${MARK} Walkin`)])
  check('a new enrolment is created', fresh.length === 1, `${fresh.length} rows`)
  check('…matched to the existing customer by phone', fresh[0]?.[0] === loyalId, String(fresh[0]?.[0]))
  check('…with the phone normalised on the way in', fresh[0]?.[1] === PHONE_LOYAL, String(fresh[0]?.[1]))

  // ══ 8. Source guarantees ══
  const src = readFileSync('lib/academy.ts', 'utf8')
  check('conversion is derived, never stored',
    !/convertedAt|conversionFlag/.test(src) && /after\(a\.scheduledAt\)/.test(src),
    'a stored conversion flag has crept in')
  check('erased customers are excluded from matching', /erasedAt: null/.test(src),
    'matching can reach an erased customer')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  check('the enrolment link is nullable, so a non-customer still counts as enrolled',
    /customerId\s+String\?/.test(schema.slice(schema.indexOf('model AcademyEnrollment'))),
    'customerId is required')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
