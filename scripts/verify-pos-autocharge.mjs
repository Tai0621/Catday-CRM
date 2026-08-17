import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E: a finished grooming/boarding visit must surface at the POS with the right
// amount, so the cashier never re-types it. Seeds four cases, checks /pos, cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYPOS'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const nul = { type: 'null' }

async function pipe(requests) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const mark = ok => (ok ? '✓' : '✗')

const now = new Date()
const iso = d => d.toISOString()
const todayAt = h => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0)
const DAY = 86400000

// ── ids ──
const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const svcGroom = crypto.randomUUID(), svcBoard = crypto.randomUUID()
const aPriced = crypto.randomUUID(), aBoarding = crypto.randomUUID()
const aNoPrice = crypto.randomUUID(), aInProgress = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Appointment WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Service WHERE id IN (?, ?)`, [t(svcGroom), t(svcBoard)]),
  ])
}

try {
  await cleanup() // in case a previous run died midway

  // ── 1) seed ──
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(custId), t(`${MARK} Customer`), t('+60123456789')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt)
          VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(custId), t(`${MARK}Cat`)]),
    exec(`INSERT INTO Service (id,name,category,durationMin,price,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?,?,?,?,1,900,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(svcGroom), t(`${MARK} Full Groom`), t('Grooming'), { type: 'integer', value: '90' }, f(120)]),
    exec(`INSERT INTO Service (id,name,category,durationMin,price,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?,?,?,?,1,901,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(svcBoard), t(`${MARK} Suite Night`), t('Boarding'), { type: 'integer', value: '1440' }, f(80)]),
  ])

  // Case A: grooming FINISHED on the board, priced, RM120 with RM20 deposit -> auto-load net RM100
  // Case B: boarding CheckedIn, checks out today, 3 nights, NO stored price -> derive 80 x 3 = RM240
  // Case C: grooming Ready, NO service and NO price -> surfaces flagged "needs price"
  // Case D: grooming Scheduled earlier today (in progress) -> offered as chip, NOT auto-added
  await pipe([
    exec(`INSERT INTO Appointment (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,depositRM,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(aPriced), t(custId), t(catId), t('Grooming'), t(svcGroom), t(iso(todayAt(10))), t(iso(todayAt(11))), t('Ready'), f(120), f(20)]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,depositRM,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(aBoarding), t(custId), t(catId), t('Boarding'), t(svcBoard),
       t(iso(new Date(todayAt(12).getTime() - 3 * DAY))), t(iso(todayAt(12))), t('CheckedIn'), nul, nul]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,depositRM,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(aNoPrice), t(custId), t(catId), t('Grooming'), nul, t(iso(todayAt(9))), t(iso(todayAt(10))), t('Ready'), nul, nul]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,depositRM,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(aInProgress), t(custId), t(catId), t('Grooming'), t(svcGroom), t(iso(todayAt(8))), t(iso(todayAt(9))), t('Scheduled'), f(120), nul]),
  ])
  console.log('seeded 4 appointments for', `${MARK} Customer`)

  // ── 2) login ──
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie — check APP_PASSWORD')

  // ── 3) load the POS and inspect the payload it hands the cashier ──
  const res = await fetch(`${BASE}/pos`, { headers: { Cookie: cookie } })
  const html = await res.text()
  console.log(`GET /pos -> ${res.status}`)

  const has = s => html.includes(s)
  // The client props are serialized into the RSC payload; escaped quotes included.
  const findAppt = id => {
    const i = html.indexOf(id)
    if (i < 0) return null
    return html.slice(Math.max(0, i - 80), i + 460)
  }
  const blob = s => (s ?? '').replace(/\\"/g, '"')

  const A = blob(findAppt(aPriced)), B = blob(findAppt(aBoarding))
  const C = blob(findAppt(aNoPrice)), D = blob(findAppt(aInProgress))

  const checks = [
    ['A grooming finished surfaces at all', !!A],
    ['A priced RM120 gross', !!A && /"gross":120/.test(A)],
    ['A nets RM100 after RM20 deposit', !!A && /"net":100/.test(A)],
    ['A auto-loads (billable)', !!A && /"billable":true/.test(A)],
    ['B boarding surfaces', !!B],
    ['B derives 3 nights x RM80 = RM240 with no stored price', !!B && /"gross":240/.test(B)],
    ['B labelled "3 nights"', !!B && /3 nights/.test(B)],
    ['B auto-loads on checkout day', !!B && /"billable":true/.test(B)],
    ['C un-priced visit still surfaces (not silently dropped)', !!C],
    ['C flagged needsPrice for the cashier', !!C && /"needsPrice":true/.test(C)],
    ['D in-progress visit is offered but NOT auto-added', !!D && /"billable":false/.test(D)],
  ]
  let pass = 0
  for (const [label, ok] of checks) { console.log(`  ${mark(ok)} ${label}`); if (ok) pass++ }
  console.log(`\n${pass}/${checks.length} checks passed`)
  if (pass < checks.length) {
    console.log('\n--- A ---\n', A?.slice(0, 400))
    console.log('\n--- B ---\n', B?.slice(0, 400))
    console.log('\n--- C ---\n', C?.slice(0, 400))
    console.log('\n--- D ---\n', D?.slice(0, 400))
  }
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
