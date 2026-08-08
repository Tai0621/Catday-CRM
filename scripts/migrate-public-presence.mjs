import 'dotenv/config'

// M6 — BookingRequest + PublicPageView for the public presence page.
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
  CREATE TABLE "BookingRequest" (
    "id"            TEXT PRIMARY KEY NOT NULL,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name"          TEXT NOT NULL,
    "phone"         TEXT NOT NULL,
    "email"         TEXT,
    "catName"       TEXT,
    "serviceName"   TEXT,
    "preferredDate" TEXT,
    "notes"         TEXT,
    "status"        TEXT NOT NULL DEFAULT 'New',
    "appointmentId" TEXT,
    "handledBy"     TEXT,
    "handledAt"     DATETIME
  )
`, 'BookingRequest table')
await safe(`CREATE INDEX "BookingRequest_status_createdAt_idx" ON "BookingRequest"("status", "createdAt")`, 'BookingRequest(status, createdAt)')
await safe(`CREATE INDEX "BookingRequest_createdAt_idx" ON "BookingRequest"("createdAt")`, 'BookingRequest(createdAt)')

await safe(`
  CREATE TABLE "PublicPageView" (
    "date"      TEXT PRIMARY KEY NOT NULL,
    "views"     INTEGER NOT NULL DEFAULT 0,
    "requests"  INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`, 'PublicPageView table')

console.log('Done.')
