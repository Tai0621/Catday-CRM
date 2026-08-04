import 'dotenv/config'
import { execSync } from 'node:child_process'
import { seedBaseline, pipeFactory } from './seed-baseline.mjs'

// Track B — stand up a NEW client instance's database from scratch.
//
// Single source of truth = prisma/schema.prisma. We generate the full CREATE
// TABLE / INDEX DDL from it (so there is never a hand-maintained "init" script to
// drift), apply it to the target Turso database, then seed the neutral baseline
// catalog. Idempotent: existing tables/rows are skipped, so it is safe to re-run.
//
// Usage:
//   PROVISION_DATABASE_URL=libsql://<new-db>...  \
//   PROVISION_DATABASE_AUTH_TOKEN=<token>        \
//   CLIENT_NAME="Acme Cats"  (optional)          \
//   node scripts/provision-client.mjs
//
// Creating the Turso database and the Vercel project themselves is a human step
// (they touch your accounts) — see docs/PROVISIONING.md. This script does the
// repeatable schema + seed part.

const url = process.env.PROVISION_DATABASE_URL
const token = process.env.PROVISION_DATABASE_AUTH_TOKEN
const clientName = process.env.CLIENT_NAME

if (!url || !token) {
  console.error('Set PROVISION_DATABASE_URL and PROVISION_DATABASE_AUTH_TOKEN to the NEW client database.')
  process.exit(1)
}
if (url === process.env.DATABASE_URL) {
  console.error('Refusing to run: PROVISION_DATABASE_URL equals this app’s DATABASE_URL. Point it at the NEW client DB.')
  process.exit(1)
}

const pipe = pipeFactory(url, token)
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

async function applyStatement(sql) {
  try {
    await pipe([exec(sql)])
    return 'ok'
  } catch (e) {
    if (/already exists|duplicate column/i.test(e.message ?? '')) return 'skip'
    throw new Error(`while running:\n${sql}\n→ ${e.message}`)
  }
}

console.log(`Provisioning new client database…\n  target: ${url.replace(/\/\/.*@/, '//…@')}\n`)

// 1. Full schema DDL, generated from prisma/schema.prisma
console.log('1) Generating schema DDL from prisma/schema.prisma')
const ddl = execSync('npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script', {
  encoding: 'utf8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'inherit'],
})
const statements = ddl
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n') // drop comment lines
  .split(';').map(s => s.trim()).filter(Boolean)

let ok = 0, skip = 0
for (const s of statements) {
  const r = await applyStatement(s)
  if (r === 'ok') ok++; else skip++
}
console.log(`   applied ${ok} statements, skipped ${skip} (already present)`)

// 2. Baseline catalog.
// Skipped when the database is about to receive a full demo dataset, which
// brings its own tiers, services and rooms and would collide with these.
if (process.env.SKIP_BASELINE === '1') {
  console.log('2) Baseline catalog skipped (SKIP_BASELINE=1)')
} else {
  console.log('2) Seeding baseline catalog (tiers, services, rooms)')
  await seedBaseline(pipe)
}

// 3. Optional: set the client's business name so the app is branded on first boot
if (clientName) {
  await applyStatement(`INSERT OR REPLACE INTO Setting (key,value,updatedAt) VALUES ('business.name', ${sqlQuote(clientName)}, CURRENT_TIMESTAMP)`)
  console.log(`3) Set business.name = "${clientName}"`)
}

console.log(`\n✅ Database provisioned. Next steps (see docs/PROVISIONING.md):
  • Create the Vercel project pointing at this repo (region hnd1).
  • Set env vars: DATABASE_URL, DATABASE_AUTH_TOKEN (this DB), APP_PASSWORD,
    SESSION_SECRET, CRON_SECRET, ANTHROPIC_API_KEY, AI_ASSISTANT_MODEL,
    WHATSAPP_ANALYSIS_MODEL, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET,
    GOOGLE_FORMS_SECRET, BLOB_READ_WRITE_TOKEN.
  • Log in as manager and set branding in Settings (name, logo, colours, currency).
  • Add staff PINs, then go live.`)

function sqlQuote(s) { return `'${String(s).replace(/'/g, "''")}'` }
