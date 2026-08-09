import 'dotenv/config'

// M9 — per-customer language, and language-tagged message variants.
// Idempotent; safe to re-run.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function safe(sql, label) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  })
  const json = await res.json()
  const r = json.results?.[0]
  if (r?.type === 'error') {
    const msg = r.error?.message ?? ''
    if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw new Error(`${label}: ${msg}`)
  }
  console.log(`  ✓ ${label}`)
}

console.log(`Migrating ${RAW}`)

// Deliberately no backfill. Null means "nobody has established this", and
// defaulting every existing customer to English would manufacture a fact the
// business never recorded — then every generator would confidently write to a
// Mandarin-speaking household in English on the strength of it.
await safe(`ALTER TABLE "Customer" ADD COLUMN "language" TEXT`, 'Customer.language')
await safe(`ALTER TABLE "ActionVariant" ADD COLUMN "language" TEXT`, 'ActionVariant.language')

console.log('Done.')
