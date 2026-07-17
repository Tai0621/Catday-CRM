import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for the two-lane booking form: price & end time must be derived on the
// server (service price, boarding nights), free-room filtering must exclude
// clashing stays, and deposits must land as transactions. Seeds, tests, cleans.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYBOOK'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(v) })
const nul = { type: 'null' }
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
const q = async sql => (await pipe([exec(sql)]))[0].response.result

// ── ids ──
const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const svcGroom = crypto.randomUUID(), svcBoard = crypto.randomUUID()
const roomA = crypto.randomUUID(), roomB = crypto.randomUUID()
const clashAppt = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "Transaction" WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Appointment WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Service WHERE id IN (?, ?)`, [t(svcGroom), t(svcBoard)]),
    exec(`DELETE FROM Room WHERE id IN (?, ?)`, [t(roomA), t(roomB)]),
  ])
}

const now = new Date()
const day = n => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12, 0, 0)
  return d
}

let pass = 0, total = 0
const check = (label, ok) => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}`) }

try {
  await cleanup()

  // ── seed ──
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60111222333')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(custId), t(`${MARK}Cat`)]),
    exec(`INSERT INTO Service (id,name,category,durationMin,price,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?,?,?,?,1,950,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(svcGroom), t(`${MARK} Groom`), t('Grooming'), i(90), f(120)]),
    exec(`INSERT INTO Service (id,name,category,durationMin,price,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?,?,?,?,1,951,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(svcBoard), t(`${MARK} Night`), t('Boarding'), i(1440), f(80)]),
    exec(`INSERT INTO Room (id,name,type,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,'Available',990,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomA), t(`${MARK} Room A`), t('Standard')]),
    exec(`INSERT INTO Room (id,name,type,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,'Available',991,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomB), t(`${MARK} Room B`), t('Suite')]),
    // Room B is occupied for the test window → must be filtered out
    exec(`INSERT INTO Appointment (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,roomId,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,'CheckedIn',?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(clashAppt), t(custId), t(catId), t('Boarding'), t(svcBoard),
       t(day(0).toISOString()), t(day(5).toISOString()), t(roomB)]),
  ])
  console.log('seeded')

  // ── login ──
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── find the server-action ids in the page's client chunks ──
  const pageRes = await fetch(`${BASE}/appointments/new`, { headers: { Cookie: cookie } })
  const pageHtml = await pageRes.text()
  console.log(`GET /appointments/new -> ${pageRes.status}`)
  check('page renders both lanes', pageHtml.includes('Grooming') && pageHtml.includes('Boarding'))

  // Turbopack dev chunks: exports map names to $$RSC_SERVER_ACTION_n vars, each
  // defined via createServerReference("<40-hex>", …) a few hundred chars later.
  const scriptSrcs = [...pageHtml.matchAll(/src="(\/_next\/[^"]+\.js[^"]*)"/g)].map(m => m[1])
  const actionIds = {}
  for (const src of scriptSrcs) {
    const js = await (await fetch(`${BASE}${src.replace(/&amp;/g, '&')}`)).text()
    if (!js.includes('$$RSC_SERVER_ACTION')) continue
    const nameToVar = {}
    for (const m of js.matchAll(/"(fetchSlots|fetchFreeRooms|createAppointment)",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/g)) {
      nameToVar[m[1]] = m[2]
    }
    const varToHex = {}
    for (const m of js.matchAll(/const (\$\$RSC_SERVER_ACTION_\d+)[\s\S]{0,1500}?"([0-9a-f]{40,})"/g)) {
      varToHex[m[1]] ??= m[2]
    }
    for (const [name, v] of Object.entries(nameToVar)) {
      if (varToHex[v]) actionIds[name] = varToHex[v]
    }
  }
  check('found all 3 action ids', !!(actionIds.fetchSlots && actionIds.fetchFreeRooms && actionIds.createAppointment))

  const callAction = async (name, args) => {
    const r = await fetch(`${BASE}/appointments/new`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Next-Action': actionIds[name], 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(args),
    })
    return { status: r.status, text: await r.text() }
  }

  // ── fetchSlots: open times for tomorrow with the 90-min groom ──
  const tomorrow = day(1).toISOString().slice(0, 10)
  const slotsRes = await callAction('fetchSlots', [tomorrow, svcGroom])
  check('fetchSlots returns open times', slotsRes.status === 200 && /"slots":\[\{/.test(slotsRes.text.replace(/\\/g, '')))

  // ── fetchFreeRooms: window overlapping Room B's stay → only Room A offered ──
  const frRes = await callAction('fetchFreeRooms', [day(1).toISOString(), day(3).toISOString()])
  const frText = frRes.text.replace(/\\/g, '')
  check('free rooms includes Room A', frText.includes(`${MARK} Room A`))
  check('free rooms excludes occupied Room B', !frText.includes(`${MARK} Room B`))

  // ── createAppointment: grooming — price + end time derived server-side ──
  const groomStart = new Date(`${tomorrow}T10:00:00`)
  const g = await callAction('createAppointment', [JSON.stringify({
    lane: 'grooming', customerId: custId, catId, serviceId: svcGroom,
    startISO: groomStart.toISOString(),
  })])
  check('grooming booking accepted', g.status === 200 && g.text.includes('"ok":true'))
  let row = await q(`SELECT price, scheduledAt, endsAt, type, status FROM Appointment
                     WHERE customerId='${custId}' AND serviceId='${svcGroom}' AND status='Scheduled'`)
  const gr = row.rows[0]
  check('grooming price auto-set RM120', gr && Number(gr[0].value) === 120)
  const endDelta = gr ? (new Date(gr[2].value).getTime() - new Date(gr[1].value).getTime()) / 60000 : 0
  check('grooming end = start + 90min', endDelta === 90)

  // ── createAppointment: boarding — 3 nights × RM80 + RM50 deposit ──
  const b = await callAction('createAppointment', [JSON.stringify({
    lane: 'boarding', customerId: custId, catId, serviceId: svcBoard,
    startISO: day(1).toISOString(), endISO: day(4).toISOString(),
    roomId: roomA, depositRM: 50, depositMethod: 'QR',
  })])
  check('boarding booking accepted', b.status === 200 && b.text.includes('"ok":true'))
  row = await q(`SELECT price, roomId FROM Appointment
                 WHERE customerId='${custId}' AND serviceId='${svcBoard}' AND status='Scheduled'`)
  const br = row.rows[0]
  check('boarding price auto-set 3×80 = RM240', br && Number(br[0].value) === 240)
  check('room assigned', br && br[1].value === roomA)
  row = await q(`SELECT total, method, reference FROM "Transaction" WHERE customerId='${custId}' AND reference LIKE 'DEP-%'`)
  const dep = row.rows[0]
  check('deposit recorded as RM50 QR transaction', dep && Number(dep[0].value) === 50 && dep[1].value === 'QR')

  // ── guardrails ──
  const bad = await callAction('createAppointment', [JSON.stringify({
    lane: 'boarding', customerId: custId, catId, serviceId: svcBoard,
    startISO: day(4).toISOString(), endISO: day(1).toISOString(),
  })])
  check('rejects check-out before check-in', bad.text.includes('after check-in'))
  const noSvc = await callAction('createAppointment', [JSON.stringify({
    lane: 'grooming', customerId: custId, catId, serviceId: '',
    startISO: day(1).toISOString(),
  })])
  check('rejects booking without a service', noSvc.text.includes('Pick a service'))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
