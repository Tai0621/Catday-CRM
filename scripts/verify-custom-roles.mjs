import 'dotenv/config'

// Owner-defined roles.
//
// The claim that matters is not "the tab disappears from the sidebar" — hiding
// a link is decoration. It is that the PAGE stops opening, immediately, for
// someone already signed in. So this signs a staff member in, edits their role
// underneath them, and re-requests the page on the SAME session.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYROLE'
const t = v => ({ type: 'text', value: String(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

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
const rows = res => (res.response?.result?.rows ?? []).map(r => r.map(c => c.value))
const one = async (sql, args = []) => rows((await pipe([exec(sql, args)]))[0])

const setPaths = (paths, home) => pipe([exec(
  `UPDATE "StaffRoleDef" SET paths = ?, homePath = ? WHERE key = ?`,
  [t(JSON.stringify(paths)), t(home), t(`${MARK}-role`)])])

/** Follows no redirects: the status IS the answer. */
const visit = (path, cookie) =>
  fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "AuditLog" WHERE entityType = 'StaffRoleDef' AND summary LIKE '%${MARK}%'`),
    exec(`DELETE FROM "Staff" WHERE name LIKE '${MARK}%'`),
    exec(`DELETE FROM "StaffRoleDef" WHERE key LIKE '${MARK}%'`),
  ])
}

try {
  await cleanup()

  // ── A role that can open the run sheet, and a staff member on it ──
  await pipe([exec(
    `INSERT INTO "StaffRoleDef" (id,key,label,homePath,paths,isSystem,sortOrder,active,createdAt,updatedAt)
     VALUES (?,?,?,?,?,0,90,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(`${MARK}-id`), t(`${MARK}-role`), t(`${MARK} Night Carer`), t('/runsheet'),
     t(JSON.stringify(['/runsheet', '/rooms', '/cats']))])])

  // A PIN the login route can verify. Reuse the app's own hashing by creating
  // the staff row through the manager UI would be heavier; the login route
  // upgrades legacy sha256 hashes, so a sha256 PIN is a supported path.
  const { createHash } = await import('node:crypto')
  const PIN = '918273'
  await pipe([exec(
    `INSERT INTO "Staff" (id,name,role,pinHash,active,createdAt,updatedAt)
     VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(`${MARK}-staff`), t(`${MARK} Carer`), t(`${MARK}-role`), t(createHash('sha256').update('catday:' + PIN).digest('hex'))])])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: PIN }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('a staff member on a custom role can sign in', cookie.startsWith('auth='), `status ${login.status}`)
  check('…and lands on the home the OWNER chose, not a hardcoded one',
    (login.headers.get('location') ?? '').includes('/runsheet'), login.headers.get('location') ?? '')

  // ══ 1. The role opens what it was given ══
  check('a granted tab opens', (await visit('/runsheet', cookie)).status === 200)
  check('…and so does another', (await visit('/rooms', cookie)).status === 200)

  // ══ 2. Default-deny on everything else ══
  const finance = await visit('/finance/income-statement', cookie)
  check('an ungranted tab does NOT open', finance.status !== 200, `status ${finance.status}`)
  check('…it redirects to the role home rather than erroring',
    (finance.headers.get('location') ?? '').includes('/runsheet'), finance.headers.get('location') ?? '')
  check('the dashboard is not reachable either', (await visit('/', cookie)).status !== 200)

  // ══ 3. The point: revoking applies to a LIVE session ══
  // No re-login. The session token is unchanged and lasts 30 days — if
  // permissions were read from it, this would still open.
  await setPaths(['/cats'], '/cats')
  const revoked = await visit('/runsheet', cookie)
  check('a tab removed while signed in stops opening IMMEDIATELY, on the same session',
    revoked.status !== 200, `still 200 — permissions are being read from a stale session`)
  check('…and the still-granted tab keeps working', (await visit('/cats', cookie)).status === 200)

  // ══ 4. Granting applies live too ══
  await setPaths(['/cats', '/pos'], '/cats')
  check('a tab added while signed in opens immediately', (await visit('/pos', cookie)).status === 200)

  // ══ 5. Always-allowed is not revocable ══
  await setPaths(['/cats'], '/cats')
  check('the time clock stays reachable on a role that was never given it',
    (await visit('/timeclock', cookie)).status === 200, 'a role could be left unable to start a shift')
  check('…and so does their own leave', (await visit('/leave', cookie)).status === 200)

  // ══ 6. A deactivated role denies everything, rather than falling through ══
  await pipe([exec(`UPDATE "StaffRoleDef" SET active = 0 WHERE key = ?`, [t(`${MARK}-role`)])])
  const off = await visit('/cats', cookie)
  check('deactivating a role denies its holder rather than defaulting open',
    off.status !== 200, `status ${off.status}`)
  await pipe([exec(`UPDATE "StaffRoleDef" SET active = 1 WHERE key = ?`, [t(`${MARK}-role`)])])

  // ══ 7. The API surface is NOT owner-editable ══
  // Ticking boxes must never be able to expose a manager-only endpoint.
  await setPaths(['/cats', '/api/customers'], '/cats')
  const api = await visit('/api/customers?q=a', cookie)
  check('a manager-only API stays closed even if its path is stored on the role',
    api.status === 403, `status ${api.status}`)
  await setPaths(['/runsheet', '/rooms', '/cats'], '/runsheet')

  // ══ 8. The manager role cannot be narrowed or deleted ══
  const manager = await one(`SELECT isSystem FROM "StaffRoleDef" WHERE key = 'Manager'`)
  check('Manager is a system role', String(manager[0][0]) === '1', String(manager[0][0]))

  const src = await import('node:fs').then(fs => fs.readFileSync('app/hr/roles/actions.ts', 'utf8'))
  check('editing a system role is refused server-side', /isSystem[\s\S]{0,120}cannot be narrowed/.test(src))
  check('deleting a system role is refused server-side', /isSystem[\s\S]{0,120}cannot be deleted/.test(src))
  check('a role still holding staff cannot be deleted', /holders > 0/.test(src))
  check('paths are filtered to the catalogue, not trusted from the form', /VALID_TAB_HREFS\.has/.test(src))
  check('a landing page outside the role is refused, or login would loop', /isReachable/.test(src))

  // ══ 9. Manager access is unchanged ══
  const mgr = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const mgrCookie = (mgr.headers.get('set-cookie') ?? '').split(';')[0]
  check('the manager still reaches the finances', (await visit('/finance/income-statement', mgrCookie)).status === 200)
  check('…and the new Roles screen', (await visit('/hr/roles', mgrCookie)).status === 200)

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
