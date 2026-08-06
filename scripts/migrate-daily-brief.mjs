import 'dotenv/config'

// C5 — DailyBrief: the nightly analyst brief, one row per business day.
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
  CREATE TABLE "DailyBrief" (
    "id"           TEXT PRIMARY KEY NOT NULL,
    "date"         TEXT NOT NULL,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "facts"        TEXT NOT NULL,
    "observations" TEXT NOT NULL,
    "actions"      TEXT NOT NULL,
    "model"        TEXT NOT NULL,
    "inputTokens"  INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0
  )
`, 'DailyBrief table')

await safe(`CREATE UNIQUE INDEX "DailyBrief_date_key" ON "DailyBrief"("date")`, 'DailyBrief.date unique')
await safe(`CREATE INDEX "DailyBrief_createdAt_idx" ON "DailyBrief"("createdAt")`, 'DailyBrief(createdAt)')

console.log('Done.')
