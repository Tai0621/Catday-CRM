import 'dotenv/config'

// M4 · Review engine + M5 · Referral engine.
// Additive: two new tables, plus two nullable columns and a unique index on
// Customer. Nothing existing is rewritten, so this is a MINOR change per
// docs/VERSIONING.md.

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

console.log('M4 · Review engine')

await safe(`CREATE TABLE IF NOT EXISTS "ReviewRequest" (
  "id"            TEXT PRIMARY KEY NOT NULL,
  "token"         TEXT NOT NULL,
  "customerId"    TEXT NOT NULL,
  "appointmentId" TEXT,
  "sentAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt"   DATETIME,
  "sentiment"     TEXT,
  "clickedAt"     DATETIME,
  "incidentId"    TEXT,
  "staffId"       TEXT,
  CONSTRAINT "ReviewRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`, 'ReviewRequest table')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "ReviewRequest_token_key" ON "ReviewRequest"("token")`, 'ReviewRequest.token unique')
await safe(`CREATE INDEX IF NOT EXISTS "ReviewRequest_customerId_sentAt_idx" ON "ReviewRequest"("customerId", "sentAt")`, 'ReviewRequest(customerId,sentAt)')
await safe(`CREATE INDEX IF NOT EXISTS "ReviewRequest_sentAt_idx" ON "ReviewRequest"("sentAt")`, 'ReviewRequest(sentAt)')

console.log('M5 · Referral engine')

await safe(`ALTER TABLE "Customer" ADD COLUMN "referralCode" TEXT`, 'Customer.referralCode')
await safe(`ALTER TABLE "Customer" ADD COLUMN "referredById" TEXT`, 'Customer.referredById')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "Customer_referralCode_key" ON "Customer"("referralCode")`, 'Customer.referralCode unique')

await safe(`CREATE TABLE IF NOT EXISTS "Referral" (
  "id"               TEXT PRIMARY KEY NOT NULL,
  "referrerId"       TEXT NOT NULL,
  "referredId"       TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'Pending',
  "referrerCreditRM" REAL NOT NULL DEFAULT 0,
  "referredCreditRM" REAL NOT NULL DEFAULT 0,
  "creditedAt"       DATETIME,
  "note"             TEXT,
  "createdAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Referral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`, 'Referral table')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "Referral_referredId_key" ON "Referral"("referredId")`, 'Referral.referredId unique')
await safe(`CREATE INDEX IF NOT EXISTS "Referral_status_idx" ON "Referral"("status")`, 'Referral(status)')
await safe(`CREATE INDEX IF NOT EXISTS "Referral_referrerId_idx" ON "Referral"("referrerId")`, 'Referral(referrerId)')

console.log('done')
