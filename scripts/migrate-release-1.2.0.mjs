import 'dotenv/config'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

// Apply everything v1.2.0 adds to the database it is pointed at, in the order
// the changes were made, then PROVE it landed.
//
//   node scripts/migrate-release-1.2.0.mjs --check          # report only, no writes
//   node scripts/migrate-release-1.2.0.mjs --confirm=<db>   # apply
//
// `--confirm` must name the database being targeted. Every migration here is
// additive and idempotent, so re-running is safe — but running them against the
// WRONG database is not the kind of mistake a confirmation prompt should be
// able to lose to muscle memory. Typing the name is the interlock.
//
// Read-only by default for the same reason: the first thing an operator wants
// mid-release is to know what is missing, not to change something.

const MIGRATIONS = [
  'migrate-customer-groups.mjs',
  'migrate-reviews-referrals.mjs',
  'migrate-ai-usage.mjs',
  'migrate-ai-proposals.mjs',
  'migrate-daily-brief.mjs',
  'migrate-monthly-report.mjs',
  'migrate-onboarding.mjs',
  'migrate-public-presence.mjs',
  'migrate-academy-funnel.mjs',
  'migrate-language.mjs',
  'migrate-content-studio.mjs',
  'migrate-campaigns.mjs',
  'migrate-appointment-changes.mjs',
  'migrate-staff-roles.mjs',
  'migrate-role-nav-layout.mjs',
]

// What must exist afterwards. A migration that "succeeded" without creating its
// table is the failure mode worth catching — the scripts swallow
// already-exists errors by design, and that tolerance can hide a no-op.
// Taken from `git diff main..develop -- prisma/schema.prisma | grep '^+model'`,
// not from memory: the first draft of this list invented a CustomerGroup table
// that does not exist, and the post-check below is what caught it.
const EXPECTED_TABLES = [
  'GroupSend', 'ReviewRequest', 'Referral', 'AiUsage', 'AiProposal',
  'DailyBrief', 'MonthlyReport', 'OnboardingPlan', 'PublicPageView', 'ContentDraft',
  'Campaign', 'CampaignRecipient', 'BookingRequest', 'StaffRoleDef',
]
const EXPECTED_COLUMNS = [
  ['StaffRoleDef', 'layout'],
  ['Customer', 'language'],
]

const args = process.argv.slice(2)
const confirm = args.find(a => a.startsWith('--confirm='))?.split('=')[1]
const checkOnly = args.includes('--check') || !confirm

const RAW = process.env.DATABASE_URL ?? ''
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) { console.error('DATABASE_URL is not set.'); process.exit(1) }
const dbName = RAW.replace(/^libsql:\/\//, '').split('.')[0]
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function sql(statement) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: statement } }, { type: 'close' }] }),
  })
  const j = await r.json()
  const res = j.results?.[0]
  if (res?.type === 'error') throw new Error(res.error?.message)
  return (res.response?.result?.rows ?? []).map(row => row.map(c => c.value))
}

async function state() {
  const tables = new Set((await sql(`SELECT name FROM sqlite_master WHERE type='table'`)).map(r => r[0]))
  const missingTables = EXPECTED_TABLES.filter(t => !tables.has(t))
  const missingColumns = []
  for (const [table, col] of EXPECTED_COLUMNS) {
    if (!tables.has(table)) { missingColumns.push(`${table}.${col} (table absent)`); continue }
    const cols = (await sql(`PRAGMA table_info("${table}")`)).map(r => r[1])
    if (!cols.includes(col)) missingColumns.push(`${table}.${col}`)
  }
  return { missingTables, missingColumns }
}

const run = file => new Promise((resolve, reject) => {
  const child = spawn('node', [`scripts/${file}`], { stdio: 'inherit', env: process.env })
  child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`))))
})

console.log(`\nTarget database: ${dbName}\n`)

const before = await state()
console.log(`Before: ${EXPECTED_TABLES.length - before.missingTables.length}/${EXPECTED_TABLES.length} tables present`)
if (before.missingTables.length) console.log(`  missing tables: ${before.missingTables.join(', ')}`)
if (before.missingColumns.length) console.log(`  missing columns: ${before.missingColumns.join(', ')}`)

if (checkOnly) {
  const ready = before.missingTables.length === 0 && before.missingColumns.length === 0
  console.log(`\n${ready ? '✓ already migrated for v1.2.0' : '• not yet migrated'}`)
  if (!ready) console.log(`\nTo apply:  node scripts/migrate-release-1.2.0.mjs --confirm=${dbName}\n`)
  process.exit(0)
}

if (confirm !== dbName) {
  console.error(`\nRefusing: --confirm=${confirm} does not name the target database (${dbName}).`)
  console.error(`This guard exists so a release cannot be applied to the wrong tenant.\n`)
  process.exit(1)
}

for (const [i, file] of MIGRATIONS.entries()) {
  if (!existsSync(`scripts/${file}`)) { console.error(`\nMissing ${file} — aborting.`); process.exit(1) }
  console.log(`\n[${i + 1}/${MIGRATIONS.length}] ${file}`)
  try {
    await run(file)
  } catch (e) {
    // Stop on the first real failure. Half a schema is easier to reason about
    // than fifteen scripts that each half-worked.
    console.error(`\nFAILED on ${file}: ${e.message}`)
    console.error('Stopped. Fix this one, then re-run — the earlier scripts are idempotent.\n')
    process.exit(1)
  }
}

const after = await state()
console.log(`\nAfter: ${EXPECTED_TABLES.length - after.missingTables.length}/${EXPECTED_TABLES.length} tables present`)
if (after.missingTables.length || after.missingColumns.length) {
  console.error(`\n✗ Something did not land:`)
  if (after.missingTables.length) console.error(`  tables: ${after.missingTables.join(', ')}`)
  if (after.missingColumns.length) console.error(`  columns: ${after.missingColumns.join(', ')}`)
  console.error(`\nDo NOT deploy against this database yet.\n`)
  process.exit(1)
}
console.log(`\n✓ ${dbName} is ready for v1.2.0\n`)
