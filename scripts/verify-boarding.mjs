import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 5 commit 2: the 3-section run sheet + guided check-in/out.
// Seeds an arrival (needing treatment), an ongoing stay, and a departure (with
// a logged belonging), then asserts the run sheet's three sections and the
// check-in / check-out pages render the SOP-driven elements. (The mutations are
// server actions — dev-only to drive — so this covers the wiring & rendering;
// the action logic is build-verified.) Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYBOARD'
const DAY = 24 * 60 * 60 * 1000
const at = (dayOffset, hour = 12) => { const d = new Date(); d.setHours(0,0,0,0); return new Date(d.getTime() + dayOffset * DAY + hour * 3600000).toISOString() }

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

const custId = crypto.randomUUID(), roomId = crypto.randomUUID()
const arriveCat = crypto.randomUUID(), ongoingCat = crypto.randomUUID(), departCat = crypto.randomUUID()
const arriveAppt = crypto.randomUUID(), ongoingAppt = crypto.randomUUID(), departAppt = crypto.randomUUID()
const itemId = crypto.randomUUID()

async function cleanup() {
  const appts = [arriveAppt, ongoingAppt, departAppt]
  await pipe([
    exec(`DELETE FROM CareTask WHERE appointmentId IN (?,?,?)`, appts.map(t)),
    exec(`DELETE FROM BoardingItem WHERE appointmentId IN (?,?,?)`, appts.map(t)),
    exec(`DELETE FROM BoardingCheck WHERE appointmentId IN (?,?,?)`, appts.map(t)),
    exec(`DELETE FROM Appointment WHERE id IN (?,?,?)`, appts.map(t)),
    exec(`DELETE FROM Cat WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Room WHERE id = ?`, [t(roomId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

const cat = (id, name, vaxDays, dewormDays) => exec(
  `INSERT INTO Cat (id,customerId,name,vaccinationExpiry,lastDewormAt,lastDefleaAt,createdAt,updatedAt)
   VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  [t(id), t(custId), t(name), t(at(vaxDays)), t(at(dewormDays)), t(at(dewormDays))])

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomId), t(`${MARK} Rm`), t('Standard'), i(2), t('Available'), i(950)]),
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60123330001')]),
    cat(arriveCat, `${MARK}Arrive`, 200, -40),   // vax valid, deworm overdue → treatment RM50
    cat(ongoingCat, `${MARK}Ongoing`, 200, -5),
    cat(departCat, `${MARK}Depart`, 200, -5),
    // arrival: Scheduled today
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?, 'Scheduled', ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(arriveAppt), t(custId), t(arriveCat), t(at(0, 10)), t(at(3, 12)), t(roomId), f(240)]),
    // ongoing: CheckedIn, ends in future
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?, 'CheckedIn', ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(ongoingAppt), t(custId), t(ongoingCat), t(at(-2, 12)), t(at(3, 12)), t(roomId), f(240)]),
    // departure: CheckedIn, ends today
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?, 'CheckedIn', ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(departAppt), t(custId), t(departCat), t(at(-3, 12)), t(at(0, 18)), t(roomId), f(240)]),
    exec(`INSERT INTO BoardingItem (id,appointmentId,label,returned,createdAt) VALUES (?,?,?,0,CURRENT_TIMESTAMP)`, [t(itemId), t(departAppt), t(`${MARK} Blue carrier`)]),
  ])
  console.log('seeded arrival / ongoing / departure stays')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Run sheet: three sections ──
  const rs = await getHtml('/runsheet')
  check('run sheet has "Checking in today"', rs.includes('Checking in today'))
  check('arrival appears with treatment hint (RM 100, deworm+deflea)', rs.includes(`${MARK}Arrive`) && rs.includes('RM 100'))
  check('arrival links to its check-in flow', rs.includes(`/runsheet/${arriveAppt}/checkin`))
  check('run sheet has "In house"', rs.includes('In house') && rs.includes(`${MARK}Ongoing`))
  check('run sheet has "Checking out today"', rs.includes('Checking out today') && rs.includes(`${MARK}Depart`))
  check('departure links to its check-out flow', rs.includes(`/runsheet/${departAppt}/checkout`))

  // ── Check-in page ──
  const ci = await getHtml(`/runsheet/${arriveAppt}/checkin`)
  check('check-in shows the health gate', /Health check/i.test(ci))
  check('check-in offers the treatment charge', ci.includes('Administer') && ci.includes('RM 100'))
  check('check-in has room condition chips', ci.includes('Clean &amp; ready') || ci.includes('Clean & ready'))
  check('check-in has cat condition chips', ci.includes('Calm') && ci.includes('Stressed'))
  check('check-in has a belongings field + submit', ci.includes('Belongings brought in') && ci.includes('Complete check-in'))

  // ── Check-out page ──
  const co = await getHtml(`/runsheet/${departAppt}/checkout`)
  check('check-out lists the logged belonging', co.includes(`${MARK} Blue carrier`))
  check('check-out has an all-collected confirm', /all belongings collected/i.test(co))
  check('check-out has condition chips + submit', co.includes('Room condition on exit') && co.includes('Complete check-out'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
