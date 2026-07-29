import 'dotenv/config'

// HR 1 — time clock. Creates the TimeEntry table.
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

await safe(`CREATE TABLE "TimeEntry" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "staffId" TEXT NOT NULL,
  "clockInAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clockOutAt" DATETIME,
  "clockInPhotoId" TEXT,
  "clockOutPhotoId" TEXT,
  "clockInIp" TEXT,
  "clockOutIp" TEXT,
  "onPremiseIn" BOOLEAN,
  "onPremiseOut" BOOLEAN,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id")
)`, 'TimeEntry table')
await safe(`CREATE INDEX "TimeEntry_staff_idx" ON "TimeEntry" ("staffId", "clockInAt")`, 'idx TimeEntry.staff')
await safe(`CREATE INDEX "TimeEntry_clockInAt_idx" ON "TimeEntry" ("clockInAt")`, 'idx TimeEntry.clockInAt')

console.log('done')
