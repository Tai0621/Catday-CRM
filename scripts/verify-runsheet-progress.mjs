import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for the run sheet progress bars: header bar shows done/total for the day,
// per-room bar tracks each stay's checklist, and both move when a task is ticked.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYRUN'

const t = v => ({ type: 'text', value: String(v) })
const mark = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const roomId = crypto.randomUUID(), stayId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM CareTask WHERE appointmentId = ?`, [t(stayId)]),
    exec(`DELETE FROM Appointment WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Room WHERE id = ?`, [t(roomId)]),
  ])
}

const now = new Date()
const day = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12, 0, 0)

let pass = 0, total = 0
const check = (label, ok) => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}`) }
const clean = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60117776666')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(custId), t(`${MARK}Kitty`)]),
    exec(`INSERT INTO Room (id,name,type,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,'Occupied',985,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomId), t(`${MARK} Room`), t('Standard')]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,'CheckedIn',?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(stayId), t(custId), t(catId), t('Boarding'), t(day(-1).toISOString()), t(day(2).toISOString()), t(roomId)]),
  ])
  console.log('seeded')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // First load generates today's CareTasks; second load renders the fresh state
  await fetch(`${BASE}/runsheet`, { headers: { Cookie: cookie } })
  const h1 = clean(await (await fetch(`${BASE}/runsheet`, { headers: { Cookie: cookie } })).text())

  check('header progress bar renders', h1.includes('care progress'))
  // Placement, not just presence: the bar summarises the checklists below it, so
  // it must sit INSIDE the In house section rather than floating above it.
  check('progress bar sits under the In house heading',
    h1.indexOf('In house (') > -1 && h1.indexOf('In house (') < h1.indexOf('care progress'))
  const m1 = h1.match(/(\d+)\/(\d+) · (\d+)%/)
  check('shows done/total · pct', !!m1)
  check('per-room bar present (width:0%)', /width:0%/.test(h1))

  // Tick one of this stay's tasks directly, then the bars must move
  const res = await pipe([exec(
    `UPDATE CareTask SET done = 1, doneAt = CURRENT_TIMESTAMP WHERE id =
       (SELECT id FROM CareTask WHERE appointmentId = ? LIMIT 1)`, [t(stayId)])])
  const h2 = clean(await (await fetch(`${BASE}/runsheet`, { headers: { Cookie: cookie } })).text())
  const m2 = h2.match(/(\d+)\/(\d+) · (\d+)%/)
  check('bar moves after ticking a task', !!m2 && Number(m2[1]) > Number(m1?.[1] ?? 0))
  check('per-room bar width now > 0', !/width:0%/.test(h2) || (h2.match(/width:(\d+)%/g) ?? []).some(w => w !== 'width:0%'))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
