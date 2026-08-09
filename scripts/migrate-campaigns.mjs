import 'dotenv/config'

// M1 — Campaign + CampaignRecipient. Idempotent; safe to re-run.

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
  CREATE TABLE "Campaign" (
    "id"              TEXT PRIMARY KEY NOT NULL,
    "name"            TEXT NOT NULL,
    "intent"          TEXT NOT NULL,
    "offerType"       TEXT NOT NULL,
    "serviceId"       TEXT,
    "discountPct"     REAL NOT NULL DEFAULT 0,
    "validFrom"       DATETIME NOT NULL,
    "validTo"         DATETIME NOT NULL,
    "targetGroupKey"  TEXT,
    "message"         TEXT NOT NULL,
    "rationale"       TEXT,
    "facts"           TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'Draft',
    "ownerApprovedAt" DATETIME,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`, 'Campaign table')
await safe(`CREATE INDEX "Campaign_status_createdAt_idx" ON "Campaign"("status", "createdAt")`, 'Campaign(status, createdAt)')

await safe(`
  CREATE TABLE "CampaignRecipient" (
    "id"                     TEXT PRIMARY KEY NOT NULL,
    "campaignId"             TEXT NOT NULL,
    "customerId"             TEXT NOT NULL,
    "variant"                TEXT,
    "sentAt"                 DATETIME,
    "respondedAt"            DATETIME,
    "convertedTransactionId" TEXT,
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE
  )
`, 'CampaignRecipient table')
await safe(`CREATE UNIQUE INDEX "CampaignRecipient_campaignId_customerId_key" ON "CampaignRecipient"("campaignId", "customerId")`,
  'CampaignRecipient(campaignId, customerId) unique')
await safe(`CREATE INDEX "CampaignRecipient_customerId_idx" ON "CampaignRecipient"("customerId")`, 'CampaignRecipient(customerId)')

console.log('Done.')
