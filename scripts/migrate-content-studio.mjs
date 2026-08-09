import 'dotenv/config'

// M3 — Content Studio: drafted social posts for completed grooms, and a per-cat
// opt-out from the content pool. Idempotent; safe to re-run.

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

// Defaults to 0 — in the pool — because the gate that actually protects anyone
// is Customer.marketingConsent, which is opt-IN and already false for most.
// This flag exists so a customer can decline publication WITHOUT also giving up
// being messaged.
await safe(`ALTER TABLE "Cat" ADD COLUMN "contentOptOut" BOOLEAN NOT NULL DEFAULT 0`, 'Cat.contentOptOut')

await safe(`
  CREATE TABLE "ContentDraft" (
    "id"            TEXT PRIMARY KEY NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "caption"       TEXT NOT NULL,
    "hashtags"      TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'Draft',
    "model"         TEXT NOT NULL,
    "inputTokens"   INTEGER NOT NULL DEFAULT 0,
    "outputTokens"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`, 'ContentDraft table')
await safe(`CREATE UNIQUE INDEX "ContentDraft_appointmentId_key" ON "ContentDraft"("appointmentId")`,
  'ContentDraft.appointmentId unique')
await safe(`CREATE INDEX "ContentDraft_status_createdAt_idx" ON "ContentDraft"("status", "createdAt")`,
  'ContentDraft(status, createdAt)')

console.log('Done.')
