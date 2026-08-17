import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Phase 1 commit 1: salted scrypt PINs + HMAC sessions with expiry &
// epoch revocation. Asserts (against a PRODUCTION build on :3100):
//  • a legacy sha256 PIN still logs in AND is transparently upgraded to scrypt
//  • the upgraded (scrypt) PIN logs in on the next attempt; a wrong PIN fails
//  • a real session cookie carries exp + ep and opens a protected page
//  • tampered / expired / wrong-epoch tokens are rejected at the edge
// Cleans up the seeded staff row.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYAUTH'

const t = v => ({ type: 'text', value: String(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

async function pipe(sql, args = []) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DBTOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args } }, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results?.[0]?.response?.result?.rows?.[0]?.[0]?.value ?? null
}

const staffId = crypto.randomUUID()
const PIN = '618324'
const legacyHash = crypto.createHash('sha256').update(`catday:${PIN}`).digest('hex')

async function cleanup() { await pipe(`DELETE FROM Staff WHERE id = ?`, [t(staffId)]) }

// Mirror of makeSessionToken for crafting test tokens.
function craft(session, { exp, ep } = {}) {
  const now = Date.now()
  const payload = { ...session, iat: now, exp: exp ?? now + 3600_000, ep: ep ?? EPOCH }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(`v3:${b64}`).digest('hex')
  return `v3.${b64}.${sig}`
}
const login = async body => fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(), redirect: 'manual',
})
const loc = res => res.headers.get('location') ?? ''
const homeStatus = async cookie => (await fetch(`${BASE}/`, { headers: { Cookie: `auth=${cookie}` }, redirect: 'manual' })).status

try {
  await cleanup()
  await pipe(
    `INSERT INTO Staff (id,name,role,pinHash,active,createdAt,updatedAt) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(staffId), t(`${MARK} Groomer`), t('Groomer'), t(legacyHash)],
  )
  console.log('seeded a staff member with a legacy sha256 PIN')

  // ── Legacy PIN logs in + gets upgraded ──
  const r1 = await login({ password: PIN })
  check('legacy PIN logs in (→ /board)', r1.status === 307 && loc(r1).endsWith('/board'), `${r1.status} ${loc(r1)}`)
  const stored = String(await pipe(`SELECT pinHash FROM Staff WHERE id = ?`, [t(staffId)]) ?? '')
  check('PIN transparently upgraded to scrypt', stored.startsWith('scrypt$'), stored.slice(0, 12))

  // ── Upgraded (scrypt) PIN logs in; wrong PIN fails ──
  const r2 = await login({ password: PIN })
  check('scrypt PIN logs in on next attempt', r2.status === 307 && loc(r2).endsWith('/board'))
  const r3 = await login({ password: '000000' })
  check('wrong PIN is rejected (→ /login?error)', loc(r3).includes('/login?error'))

  // ── Real manager session cookie ──
  const mgr = await login({ password: process.env.APP_PASSWORD ?? '' })
  const cookie = (mgr.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]?.slice(5)
  check('manager login issues a v3 cookie', !!cookie && cookie.startsWith('v3.'))
  const payload = cookie ? JSON.parse(Buffer.from(cookie.split('.')[1], 'base64url').toString()) : {}
  check('token carries a future exp', typeof payload.exp === 'number' && payload.exp > Date.now())
  check('token carries the current epoch', payload.ep === EPOCH)
  check('valid session opens the dashboard (200)', (await homeStatus(cookie)) === 200)

  // ── Edge rejects bad tokens ──
  const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a')
  check('tampered signature rejected (→ 307)', (await homeStatus(tampered)) === 307)
  check('expired token rejected (→ 307)', (await homeStatus(craft({ kind: 'manager', name: 'Owner' }, { exp: Date.now() - 1000 }))) === 307)
  check('wrong-epoch token rejected (→ 307)', (await homeStatus(craft({ kind: 'manager', name: 'Owner' }, { ep: '999999' }))) === 307)
  check('freshly crafted valid token accepted (200)', (await homeStatus(craft({ kind: 'manager', name: 'Owner' }))) === 200)

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
