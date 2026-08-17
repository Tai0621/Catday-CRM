import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 5 commit 1: multi-cat rooms. Seeds a Standard room (cap 2) with
// two overlapping stays + a Suite (cap 6), and asserts:
//  • the room calendar shows BOTH cats under the same room (multi-cat rows)
//  • room capacity labels render ("holds 2" / "holds 6")
//  • the overlap count the booking guard uses = capacity for the full room
//    (so a 3rd concurrent booking would be rejected)
// Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYROOM'
const DAY = 24 * 60 * 60 * 1000
const iso = d => new Date(Date.now() + d * DAY).toISOString()

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
const mk = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
async function count(sql, args) {
  const res = await pipe([exec(sql, args)])
  return Number(res[0]?.response?.result?.rows?.[0]?.[0]?.value ?? 0)
}

const custId = crypto.randomUUID()
const stdRoom = crypto.randomUUID(), suiteRoom = crypto.randomUUID()
const catA = crypto.randomUUID(), catB = crypto.randomUUID()
const stayA = crypto.randomUUID(), stayB = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Appointment WHERE id IN (?,?)`, [t(stayA), t(stayB)]),
    exec(`DELETE FROM Cat WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Room WHERE id IN (?,?)`, [t(stdRoom), t(suiteRoom)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(stdRoom), t(`${MARK} Std`), t('Standard'), i(2), t('Available'), i(900)]),
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(suiteRoom), t(`${MARK} Suite`), t('Suite'), i(6), t('Available'), i(901)]),
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60124440001')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catA), t(custId), t(`${MARK}Milo`)]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catB), t(custId), t(`${MARK}Luna`)]),
    // two overlapping stays in the SAME Standard room (today → +3)
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?, 'CheckedIn', ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(stayA), t(custId), t(catA), t(iso(0)), t(iso(3)), t(stdRoom), f(240)]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?, 'Scheduled', ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(stayB), t(custId), t(catB), t(iso(0)), t(iso(3)), t(stdRoom), f(240)]),
  ])
  console.log('seeded a Standard room (cap 2) with 2 overlapping cats + a Suite (cap 6)')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Room calendar shows both cats + capacity labels ──
  const cal = await getHtml('/rooms/calendar')
  check('calendar shows the Standard room', cal.includes(`${MARK} Std`))
  check('calendar shows cat A in the room', cal.includes(`${MARK}Milo`))
  check('calendar shows cat B in the same room (multi-cat)', cal.includes(`${MARK}Luna`))
  check('Standard room labelled "holds 2"', /holds 2/.test(cal))
  check('Suite room labelled "holds 6"', /holds 6/.test(cal))

  // ── Capacity-count logic the booking guard relies on ──
  const overlapSql = `SELECT COUNT(*) FROM Appointment WHERE roomId = ?
    AND status NOT IN ('Cancelled','NoShow','Completed')
    AND scheduledAt < ? AND (endsAt > ? OR endsAt IS NULL)`
  const stdOverlap = await count(overlapSql, [t(stdRoom), t(iso(3)), t(iso(0))])
  check('Standard room is full for the window (2/2 → 3rd rejected)', stdOverlap === 2, String(stdOverlap))
  const suiteOverlap = await count(overlapSql, [t(suiteRoom), t(iso(3)), t(iso(0))])
  check('Suite room still has space (0/6)', suiteOverlap === 0, String(suiteOverlap))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
