import 'dotenv/config'

// Phase 2 — audit trail. Creates the AuditLog table.
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
    throw new Error(msg)
  }
  console.log(`  ✓ ${label}`)
}

await safe(`CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorKind" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "summary" TEXT NOT NULL,
  "detail" TEXT,
  "ip" TEXT
)`, 'AuditLog table')
await safe(`CREATE INDEX "AuditLog_at_idx" ON "AuditLog" ("at")`, 'idx AuditLog.at')
await safe(`CREATE INDEX "AuditLog_entity_idx" ON "AuditLog" ("entityType", "entityId")`, 'idx AuditLog.entity')

console.log('done')
