import 'dotenv/config'

// Phase 0 of the UI/UX round: the owner lands on the Morning Brief, not the
// dashboard.
//
//   node scripts/migrate-landing-brief.mjs            # DRY RUN
//   node scripts/migrate-landing-brief.mjs --commit
//
// Why this needs a migration at all: the landing page is not only in code.
// `homeFor()` reads `StaffRoleDef.homePath` FIRST and only falls back to
// ROLE_HOME, so changing the constant alone would be overridden by the stored
// row and the change would appear not to work.
//
// Measured before doing this (see docs/PLAN-UI-UX.md §2.1):
//   /        5952ms, 63 queries   <- was the landing
//   /brief    400ms,  3 queries   <- is now
//
// Idempotent, and deliberately conservative: it only rewrites a Manager home
// that is still the dashboard. If someone has since pointed it somewhere else
// on purpose, that choice is left alone.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const COMMIT = process.argv.includes('--commit')

const t = v => ({ type: 'text', value: String(v) })

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`)
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

const target = RAW.includes('catday') ? 'PRODUCTION (Cat Day)' : RAW.split('//')[1]?.split('.')[0]
console.log(`\nTarget: ${target}`)

const rows = (await pipe([exec(`SELECT key, homePath FROM StaffRoleDef WHERE key = 'Manager'`)]))[0]
  .response.result.rows

if (rows.length === 0) {
  console.log('\nNo Manager row in StaffRoleDef — nothing to migrate.')
  console.log('The ROLE_HOME fallback in lib/roles.ts already sends the owner to /brief.')
  process.exit(0)
}

const current = rows[0][1]?.value ?? null
console.log(`Manager.homePath is currently: ${current ?? '(null)'}`)

if (current === '/brief') {
  console.log('\nAlready /brief — nothing to do.')
  process.exit(0)
}
if (current !== '/') {
  console.log(`\nNot the dashboard, so leaving it alone. Someone set this deliberately.`)
  console.log('Re-point it by hand if that was not intentional.')
  process.exit(0)
}

console.log(`\nWould change: '/' -> '/brief'`)

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit.')
  process.exit(0)
}

await pipe([exec(
  `UPDATE StaffRoleDef SET homePath = '/brief', updatedAt = CURRENT_TIMESTAMP WHERE key = 'Manager' AND homePath = '/'`)])

const after = (await pipe([exec(`SELECT homePath FROM StaffRoleDef WHERE key = 'Manager'`)]))[0]
  .response.result.rows[0][0].value
console.log(`\n✓ Manager.homePath = ${after}`)
console.log('The dashboard is still at / — it is just no longer where login lands.')
