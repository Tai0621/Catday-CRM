import 'dotenv/config'

// C6 — OnboardingPlan: a generated starting configuration for a new client.
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

await safe(`
  CREATE TABLE "OnboardingPlan" (
    "id"           TEXT PRIMARY KEY NOT NULL,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description"  TEXT NOT NULL,
    "plan"         TEXT NOT NULL,
    "committed"    TEXT NOT NULL DEFAULT '[]',
    "model"        TEXT NOT NULL,
    "inputTokens"  INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0
  )
`, 'OnboardingPlan table')

await safe(`CREATE INDEX "OnboardingPlan_createdAt_idx" ON "OnboardingPlan"("createdAt")`, 'OnboardingPlan(createdAt)')

console.log('Done.')
