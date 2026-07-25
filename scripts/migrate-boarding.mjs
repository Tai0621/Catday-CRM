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

console.log('Boarding check-in/out migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "BoardingCheck" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "roomCondition" TEXT,
    "catCondition" TEXT,
    "allCollected" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "staffId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'BoardingCheck table',
)
await safe(`CREATE INDEX IF NOT EXISTS "BoardingCheck_appt_idx" ON "BoardingCheck" ("appointmentId")`, 'BoardingCheck index')

await safe(
  `CREATE TABLE IF NOT EXISTS "BoardingItem" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "returned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'BoardingItem table',
)
await safe(`CREATE INDEX IF NOT EXISTS "BoardingItem_appt_idx" ON "BoardingItem" ("appointmentId")`, 'BoardingItem index')

console.log('done — boarding check-in/out records ready.')
