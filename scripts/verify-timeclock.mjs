import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for HR 1 — time clock. Seeds a staff member with an open (still-in) punch
// and a completed off-site punch, then asserts:
//  • the manager Attendance board renders both, with on/off-site flags + hours
//    + the 7-day summary + the clock-in security settings
//  • the staff /timeclock screen shows the "clocked in" state
//  • access control: /hr/attendance is manager-only; /timeclock tells a manager
//    it's for staff accounts
// (The clock in/out mutations are server-action-bound → build-typechecked.)
// Cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYCLOCK'

const at = (h, m = 0) => { const x = new Date(); x.setHours(h, m, 0, 0); return x.toISOString() }
const t = v => ({ type: 'text', value: String(v) })
const tn = v => (v == null ? { type: 'null' } : { type: 'text', value: String(v) })
const iv = v => (v == null ? { type: 'null' } : { type: 'integer', value: String(v) })
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
  const now = Date.now()
  const payload = { ...session, iat: now, exp: now + 3600_000, ep: EPOCH }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(`v3:${b64}`).digest('hex')
  return `v3.${b64}.${sig}`
}

const staffId = crypto.randomUUID(), openId = crypto.randomUUID(), doneId = crypto.randomUUID()
async function cleanup() {
  await pipe([
    exec(`DELETE FROM TimeEntry WHERE staffId = ?`, [t(staffId)]),
    exec(`DELETE FROM Staff WHERE id = ?`, [t(staffId)]),
  ])
}
const entry = (id, inAt, outAt, onIn) => exec(
  `INSERT INTO TimeEntry (id,staffId,clockInAt,clockOutAt,onPremiseIn,createdAt) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
  [t(id), t(staffId), t(inAt), tn(outAt), iv(onIn)],
)

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Staff (id,name,role,pinHash,active,createdAt,updatedAt) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(staffId), t(`${MARK} Aina`), t('Groomer'), t('scrypt$placeholder')]),
    entry(openId, at(9, 0), null, 1),        // still clocked in, on-site
    entry(doneId, at(8, 0), at(8, 30), 0),   // 30 min, off-site
  ])
  console.log('seeded a staff member with one open + one off-site punch')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const getHtml = async (u, cookie) => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Manager Attendance board ──
  const att = await getHtml('/hr/attendance', mgr)
  check('attendance lists the staff member', att.includes(`${MARK} Aina`))
  check('shows a still-in punch', att.includes('still in'))
  check('flags on-site and off-site', att.includes('on-site') && att.includes('off-site'))
  check('shows the 7-day summary + clock-in security', att.includes('Last 7 days') && att.includes('Clock-in security'))
  check('security form shows current IP + enforcement toggle', att.includes('current IP') && att.includes('Block clock-in'))

  // ── Staff /timeclock ──
  const staffTok = craft({ kind: 'staff', staffId, name: `${MARK} Aina`, role: 'Groomer' })
  const tc = await getHtml('/timeclock', `auth=${staffTok}`)
  check('staff sees the clocked-in state', tc.includes("You're clocked in"))
  check('staff sees a Clock Out button', tc.includes('Clock Out'))
  check("staff sees today's punches", tc.includes('Today'))

  // ── Access control ──
  const unauth = await fetch(`${BASE}/hr/attendance`, { redirect: 'manual' })
  check('attendance unauth → /login', unauth.status === 307 && (unauth.headers.get('location') ?? '').includes('/login'))
  const staffAtt = await fetch(`${BASE}/hr/attendance`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  check('attendance blocks non-manager staff', staffAtt.status === 307 && !(staffAtt.headers.get('location') ?? '').includes('/hr'))
  const mgrClock = await getHtml('/timeclock', mgr ?? '')
  check('manager on /timeclock sees the staff-only notice', mgrClock.includes('for staff accounts'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
