import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for HR 3 — commission. Seeds a global default rate, groomers/services with
// and without overrides, and completed grooming appointments this month, then
// asserts the /hr/commission report computes each groomer's cut with the right
// rate precedence (groomer > service > default). Restores the default-rate
// Setting and cleans up. (The rate-config save is a server action →
// build-typechecked.)

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYCOMM'
const KEY = 'hr.commissionDefaultPct'

const now = new Date()
const monthDay = new Date(now.getFullYear(), now.getMonth(), Math.min(15, now.getDate()), 12).toISOString()

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
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
const one = res => res.response?.result?.rows?.[0]?.[0]?.value ?? null

function craft(session) {
  const n = Date.now()
  const payload = { ...session, iat: n, exp: n + 3600_000, ep: EPOCH }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(`v3:${b64}`).digest('hex')
  return `v3.${b64}.${sig}`
}

const cust = crypto.randomUUID(), cat = crypto.randomUUID()
const staffA = crypto.randomUUID(), staffB = crypto.randomUUID(), staffC = crypto.randomUUID()
const svcX = crypto.randomUUID(), svcY = crypto.randomUUID()
const a1 = crypto.randomUUID(), a2 = crypto.randomUUID(), a3 = crypto.randomUUID()
let priorDefault = null

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Appointment WHERE id IN (?,?,?)`, [t(a1), t(a2), t(a3)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(cat)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(cust)]),
    exec(`DELETE FROM Service WHERE id IN (?,?)`, [t(svcX), t(svcY)]),
    exec(`DELETE FROM Staff WHERE id IN (?,?,?)`, [t(staffA), t(staffB), t(staffC)]),
  ])
  // restore the global default-rate setting to its prior state
  if (priorDefault == null) await pipe([exec(`DELETE FROM Setting WHERE key = ?`, [t(KEY)])])
  else await pipe([exec(`INSERT INTO Setting (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [t(KEY), t(priorDefault)])])
}

const staffRow = (id, name, rate) => exec(
  `INSERT INTO Staff (id,name,role,pinHash,active,commissionRatePct,createdAt,updatedAt) VALUES (?,?,?,?,1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  // A REAL-shaped hash of an unguessable value. These staff never log in, so the
  // old `scrypt$ph$<id>` placeholder looked harmless — but it is a shape
  // `verifyPassword` cannot parse, and login verifies every active staff row in
  // turn, so while these rows exist NO staff member can sign in. A crash before
  // cleanup left them behind once and broke five later suites.
  [t(id), t(name), t('Groomer'),
   t(crypto.createHash('sha256').update(`catday:unusable-${id}`).digest('hex')),
   rate == null ? { type: 'null' } : f(rate)])
const svcRow = (id, name, price, rate) => exec(
  `INSERT INTO Service (id,name,category,durationMin,price,active,sortOrder,commissionRatePct,createdAt,updatedAt) VALUES (?,?,?,60,?,1,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  [t(id), t(name), t('Grooming'), f(price), rate == null ? { type: 'null' } : f(rate)])
const apptRow = (id, staffId, svcId, price) => exec(
  `INSERT INTO Appointment (id,customerId,catId,type,serviceId,staffId,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt)
   VALUES (?,?,?,'Grooming',?,?,?, 'Completed', ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  [t(id), t(cust), t(cat), t(svcId), t(staffId), t(monthDay), f(price)])

try {
  priorDefault = one((await pipe([exec(`SELECT value FROM Setting WHERE key = ?`, [t(KEY)])]))[0])
  await cleanup()
  await pipe([
    exec(`INSERT INTO Setting (key,value,updatedAt) VALUES (?, '10', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value='10'`, [t(KEY)]),
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt) VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(cust), t(`${MARK} Cust`), t('+60127770001')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(cat), t(cust), t(`${MARK}Cat`)]),
    staffRow(staffA, `${MARK} Ayu`, 15),   // groomer override 15%
    staffRow(staffB, `${MARK} Bala`, null), // no override
    staffRow(staffC, `${MARK} Chin`, null), // no override
    svcRow(svcX, `${MARK} Full Groom`, 100, 8), // service override 8%
    svcRow(svcY, `${MARK} Bath Only`, 50, null), // no override
    apptRow(a1, staffA, svcX, 100), // staff 15% wins → 15.00
    apptRow(a2, staffB, svcX, 200), // service 8% → 16.00
    apptRow(a3, staffC, svcY, 50),  // default 10% → 5.00
  ])
  console.log('seeded default 10% + 3 groomers/2 services + 3 completed grooms')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const html = strip(await (await fetch(`${BASE}/hr/commission`, { headers: { Cookie: mgr ?? '' } })).text())

  check('groomer override wins (Ayu 15% → RM 15.00)', html.includes(`${MARK} Ayu`) && html.includes('RM 15.00') && html.includes('15%'))
  check('service override applies (Bala via 8% → RM 16.00)', html.includes(`${MARK} Bala`) && html.includes('RM 16.00') && html.includes('8%'))
  check('default applies (Chin 10% → RM 5.00)', html.includes(`${MARK} Chin`) && html.includes('RM 5.00') && html.includes('10%'))
  // Global totals also fold in any real demo grooms this month, so assert the
  // summary renders rather than an exact figure (per-row math is proven above).
  check('summary cards render', html.includes('Commissionable revenue') && html.includes('Commission earned') && html.includes('Services'))
  check('detail table lists the services', html.includes(`${MARK} Full Groom`) && html.includes(`${MARK} Bath Only`))
  check('rate config section renders', html.includes('Commission rates') && html.includes('Default rate') && html.includes('Per-groomer overrides'))

  // ── Access control ──
  const unauth = await fetch(`${BASE}/hr/commission`, { redirect: 'manual' })
  check('unauth → /login', unauth.status === 307 && (unauth.headers.get('location') ?? '').includes('/login'))
  const staffTok = craft({ kind: 'staff', staffId: staffA, name: `${MARK} Ayu`, role: 'Groomer' })
  const staffRes = await fetch(`${BASE}/hr/commission`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  check('non-manager staff bounced', staffRes.status === 307 && !(staffRes.headers.get('location') ?? '').includes('/hr/commission'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
