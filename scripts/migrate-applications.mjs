import 'dotenv/config'

// HR 4 — recruiting. Creates the JobApplication table.
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

await safe(`CREATE TABLE "JobApplication" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "roleApplied" TEXT,
  "experience" TEXT,
  "availability" TEXT,
  "status" TEXT NOT NULL DEFAULT 'New',
  "notes" TEXT,
  "source" TEXT NOT NULL DEFAULT 'Careers form',
  "reviewedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, 'JobApplication table')
await safe(`CREATE INDEX "JobApplication_status_idx" ON "JobApplication" ("status")`, 'idx JobApplication.status')
await safe(`CREATE INDEX "JobApplication_createdAt_idx" ON "JobApplication" ("createdAt")`, 'idx JobApplication.createdAt')

console.log('done')
