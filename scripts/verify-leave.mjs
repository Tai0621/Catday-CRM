import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for HR 2 — leave & calendar. Seeds two staff: one with a PENDING request,
// one with an APPROVED request covering today. Asserts:
//  • manager /hr/leave shows the pending queue (approve/reject) + the who's-off
//    calendar (approved person) + recent list
//  • the pending request surfaces in the Action Inbox
//  • staff /leave shows their own request + the request form
//  • access control: /hr/leave manager-only; /leave tells a manager it's staff-only
// (approve/reject + request are server-action-bound → build-typechecked.) Cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYLEAVE'

const now = new Date()
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = isoDay(now)

const t = v => ({ type: 'text', value: String(v) })
const tn = v => (v == null ? { type: 'null' } : { type: 'text', value: String(v) })
const iv = v => ({ type: 'integer', value: String(v) })
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
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

function craft(session) {
  const n = Date.now()
  const payload = { ...session, iat: n, exp: n + 3600_000, ep: EPOCH }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(`v3:${b64}`).digest('hex')
  return `v3.${b64}.${sig}`
}

const staffP = crypto.randomUUID(), staffA = crypto.randomUUID()
const reqP = crypto.randomUUID(), reqA = crypto.randomUUID()
async function cleanup() {
  await pipe([
    exec(`DELETE FROM LeaveRequest WHERE staffId IN (?,?)`, [t(staffP), t(staffA)]),
    exec(`DELETE FROM Staff WHERE id IN (?,?)`, [t(staffP), t(staffA)]),
  ])
}
const staffRow = (id, name, role) => exec(
  `INSERT INTO Staff (id,name,role,pinHash,active,createdAt,updatedAt) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  [t(id), t(name), t(role), t(`scrypt$placeholder$${id}`)]) // unique pinHash per row
const leaveRow = (id, staffId, type, start, end, days, status) => exec(
  `INSERT INTO LeaveRequest (id,staffId,type,startDate,endDate,days,status,createdAt) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
  [t(id), t(staffId), t(type), t(start), t(end), iv(days), t(status)])

try {
  await cleanup()
  await pipe([
    staffRow(staffP, `${MARK}Pending Sarah`, 'Groomer'),
    staffRow(staffA, `${MARK}Approved Lee`, 'Boarding'),
    leaveRow(reqP, staffP, 'Annual', today, today, 1, 'Pending'),
    leaveRow(reqA, staffA, 'Medical', today, today, 1, 'Approved'),
  ])
  console.log('seeded a pending + an approved (today) leave request')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const getHtml = async (u, cookie) => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Manager leave admin ──
  const admin = await getHtml('/hr/leave', mgr)
  check('pending queue shows the request', admin.includes(`${MARK}Pending Sarah`) && admin.includes('Approve') && admin.includes('Reject'))
  check("who's-off calendar shows the approved person", admin.includes("Who's off this month") && admin.includes(`${MARK}Approved`.split(' ')[0]))
  check('approved leave first name appears on the calendar', admin.includes(`${MARK}Approved`))

  // ── Action Inbox ──
  const inbox = await getHtml('/actions', mgr)
  check('pending leave surfaces in the Action Inbox', inbox.includes(`Leave request — ${MARK}Pending Sarah`))

  // ── Staff /leave ──
  const staffTok = craft({ kind: 'staff', staffId: staffP, name: `${MARK}Pending Sarah`, role: 'Groomer' })
  const mine = await getHtml('/leave', `auth=${staffTok}`)
  check('staff sees their own request + status', mine.includes('My Leave') && mine.includes('Pending'))
  check('staff sees the request form (leave types)', mine.includes('Request leave') && mine.includes('Annual'))
  check('staff can cancel a pending request', mine.includes('Cancel'))

  // ── Access control ──
  const unauth = await fetch(`${BASE}/hr/leave`, { redirect: 'manual' })
  check('leave admin unauth → /login', unauth.status === 307 && (unauth.headers.get('location') ?? '').includes('/login'))
  const staffAdmin = await fetch(`${BASE}/hr/leave`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  check('leave admin blocks non-manager staff', staffAdmin.status === 307 && !(staffAdmin.headers.get('location') ?? '').includes('/hr'))
  const mgrLeave = await getHtml('/leave', mgr ?? '')
  check('manager on /leave sees the staff-only notice', mgrLeave.includes('for staff accounts'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
