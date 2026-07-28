import 'dotenv/config'

// E2E for Phase 3 commit 1: the public health probe + the backup cron's
// auth/graceful-degrade. (Error boundaries are build-verified.)

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

try {
  // Public — no auth cookie, must NOT redirect to /login.
  const res = await fetch(`${BASE}/api/health`, { redirect: 'manual' })
  check('/api/health is public (200, no login redirect)', res.status === 200, `status ${res.status}`)
  const body = await res.json().catch(() => ({}))
  check('reports status: ok', body.status === 'ok', JSON.stringify(body))
  check('reports db: up', body.db === 'up')
  check('includes version + timestamp', typeof body.version === 'string' && typeof body.ts === 'string')
  check('includes uptime', typeof body.uptimeSec === 'number')

  // ── Backup cron: fail-closed, then authorized (manager) + graceful ──
  const bkNoAuth = await fetch(`${BASE}/api/cron/backup`, { redirect: 'manual' })
  check('backup cron without auth → 401', bkNoAuth.status === 401, `status ${bkNoAuth.status}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const bk = await fetch(`${BASE}/api/cron/backup`, { method: 'POST', headers: { Cookie: cookie ?? '' } })
  const bkBody = await bk.json().catch(() => ({}))
  // 200 when BLOB is configured; graceful 503 + ok:false when it isn't (local).
  check('backup cron authorizes a manager (200 or graceful 503)', [200, 503].includes(bk.status), `status ${bk.status}`)
  check('backup reports Blob status', bk.status === 200 ? bkBody.ok === true : bkBody.ok === false, JSON.stringify(bkBody))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} catch (e) {
  console.error('verify error:', e)
  process.exitCode = 1
}
