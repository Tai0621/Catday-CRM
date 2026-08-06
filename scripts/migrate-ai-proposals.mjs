import 'dotenv/config'

// C2 — AiProposal: a write the assistant wants to make, held until confirmed.
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
  CREATE TABLE "AiProposal" (
    "id"        TEXT PRIMARY KEY NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind"      TEXT NOT NULL,
    "payload"   TEXT NOT NULL,
    "summary"   TEXT NOT NULL,
    "prompt"    TEXT NOT NULL,
    "status"    TEXT NOT NULL DEFAULT 'Pending',
    "decidedAt" DATETIME,
    "resultId"  TEXT,
    "error"     TEXT
  )
`, 'AiProposal table')

await safe(`CREATE INDEX "AiProposal_status_createdAt_idx" ON "AiProposal"("status", "createdAt")`, 'AiProposal(status, createdAt)')
await safe(`CREATE INDEX "AiProposal_createdAt_idx" ON "AiProposal"("createdAt")`, 'AiProposal(createdAt)')

console.log('Done.')
