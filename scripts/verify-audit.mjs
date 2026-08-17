import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Phase 2: the audit trail view + access control. Seeds AuditLog rows
// directly (the recordAudit write wiring is server-action-bound, so it's
// build-typechecked; this proves the manager-only view renders them correctly
// and that non-managers can't reach it). Cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYAUDIT'

const t = v => ({ type: 'text', value: String(v) })
const tn = v => (v == null ? { type: 'null' } : { type: 'text', value: String(v) })
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

const row = (id, at, actorKind, actorName, action, summary, ip) => exec(
  `INSERT INTO AuditLog (id,at,actorKind,actorId,actorName,action,entityType,entityId,summary,detail,ip)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  [t(id), t(at), t(actorKind), tn(null), t(actorName), t(action), t('Transaction'), tn('x1'), t(summary), tn(null), tn(ip)],
)
const ids = { del: crypto.randomUUID(), staff: crypto.randomUUID(), wallet: crypto.randomUUID() }
async function cleanup() { await pipe([exec(`DELETE FROM AuditLog WHERE actorName LIKE ?`, [t(`${MARK}%`)])]) }

try {
  await cleanup()
  await pipe([
    row(ids.del, '2026-07-27 12:00:00', 'manager', `${MARK} Owner`, 'transaction.delete', `${MARK} deleted sale CD-XYZ (RM 240.00)`, '203.0.113.9'),
    row(ids.wallet, '2026-07-27 11:00:00', 'staff', `${MARK} Aina`, 'wallet.topup', `${MARK} wallet top-up RM 100.00`, '203.0.113.8'),
    row(ids.staff, '2026-07-27 10:00:00', 'manager', `${MARK} Owner`, 'staff.create', `${MARK} added staff Lee (Groomer)`, null),
  ])
  console.log('seeded 3 audit rows')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const html = strip(await (await fetch(`${BASE}/admin/audit`, { headers: { Cookie: cookie } })).text())

  check('audit page renders the delete entry', html.includes(`${MARK} deleted sale CD-XYZ`))
  check('audit page renders the wallet entry', html.includes(`${MARK} wallet top-up RM 100.00`))
  check('audit page renders the staff entry', html.includes(`${MARK} added staff Lee`))
  check('shows action verbs', html.includes('transaction.delete') && html.includes('wallet.topup') && html.includes('staff.create'))
  check('shows actor + kind', html.includes(`${MARK} Aina`) && html.includes('staff') && html.includes(`${MARK} Owner`))
  check('shows the captured IP', html.includes('203.0.113.9'))
  check('newest entry appears first (ordered by time desc)',
    html.indexOf('deleted sale CD-XYZ') < html.indexOf('added staff Lee'))

  // ── Access control ──
  const unauth = await fetch(`${BASE}/admin/audit`, { redirect: 'manual' })
  check('unauthenticated → redirected to /login', unauth.status === 307 && (unauth.headers.get('location') ?? '').includes('/login'), `${unauth.status}`)

  const staffTok = craft({ kind: 'staff', staffId: 'x', name: `${MARK} Groomer`, role: 'Groomer' })
  const staffRes = await fetch(`${BASE}/admin/audit`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  check('non-manager staff → bounced off /admin/audit', staffRes.status === 307 && !(staffRes.headers.get('location') ?? '').includes('/admin/audit'), `${staffRes.status} ${staffRes.headers.get('location')}`)

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
