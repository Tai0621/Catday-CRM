import 'dotenv/config'

// HR 2 — leave. Creates the LeaveRequest table.
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

await safe(`CREATE TABLE "LeaveRequest" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "staffId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "days" INTEGER NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "reviewedBy" TEXT,
  "reviewedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id")
)`, 'LeaveRequest table')
await safe(`CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest" ("status")`, 'idx LeaveRequest.status')
await safe(`CREATE INDEX "LeaveRequest_staff_idx" ON "LeaveRequest" ("staffId")`, 'idx LeaveRequest.staff')

console.log('done')
