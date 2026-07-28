import 'dotenv/config'

// E2E for Phase 3 commit 1: the public health probe. (Error boundaries are
// build-verified; the backup script is exercised separately in the run.)

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

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} catch (e) {
  console.error('verify error:', e)
  process.exitCode = 1
}
