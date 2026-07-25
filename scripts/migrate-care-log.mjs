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

console.log('Daily care log migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "DailyCareLog" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "catId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "appetite" TEXT,
    "stool" TEXT,
    "urine" TEXT,
    "energy" TEXT,
    "behavior" TEXT,
    "respiratory" TEXT,
    "skin" TEXT,
    "vomiting" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "staffId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'DailyCareLog table',
)
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "DailyCareLog_appt_date_period_key" ON "DailyCareLog" ("appointmentId","date","period")`, 'DailyCareLog unique index')

console.log('done — structured daily care log ready.')
