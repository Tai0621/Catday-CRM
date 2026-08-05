import 'dotenv/config'

// M10 · Customer groups & targeted marketing.
// Additive only: one new table recording confirmed outbound sends. Audiences
// themselves are defined in code (lib/customer-groups.ts) rather than seeded, so
// every tenant picks up improvements to a group's definition on deploy instead
// of drifting apart in their own databases.

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

console.log('M10 · Customer groups')

await safe(`CREATE TABLE IF NOT EXISTS "GroupSend" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "groupKey"   TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "channel"    TEXT NOT NULL DEFAULT 'WhatsApp',
  "variant"    TEXT,
  "staffId"    TEXT,
  "sentAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupSend_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`, 'GroupSend table')

await safe(`CREATE INDEX IF NOT EXISTS "GroupSend_customerId_sentAt_idx" ON "GroupSend"("customerId", "sentAt")`, 'GroupSend(customerId,sentAt)')
await safe(`CREATE INDEX IF NOT EXISTS "GroupSend_groupKey_sentAt_idx" ON "GroupSend"("groupKey", "sentAt")`, 'GroupSend(groupKey,sentAt)')

console.log('done')
