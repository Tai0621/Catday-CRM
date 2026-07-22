import 'dotenv/config'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL not set')

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

console.log('Licenses & Renewals migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "License" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "authority" TEXT,
    "licenseNo" TEXT,
    "issueDate" DATETIME,
    "renewalDate" DATETIME NOT NULL,
    "reminderDays" INTEGER NOT NULL DEFAULT 30,
    "cost" REAL,
    "notes" TEXT,
    "archived" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'License table',
)
await safe(`CREATE INDEX IF NOT EXISTS "License_archived_renewalDate_idx" ON "License" ("archived", "renewalDate")`, 'License index')

console.log('done — License table ready. Add licences at /admin/licenses; renewals surface in the Action Inbox ahead of their due date.')
