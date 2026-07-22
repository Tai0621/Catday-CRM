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

console.log('Fixed Asset Register migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "FixedAsset" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cost" REAL NOT NULL,
    "salvageValue" REAL NOT NULL DEFAULT 0,
    "purchaseDate" DATETIME NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'FixedAsset table',
)
await safe(`CREATE INDEX IF NOT EXISTS "FixedAsset_purchaseDate_idx" ON "FixedAsset" ("purchaseDate")`, 'FixedAsset.purchaseDate index')

console.log('done — FixedAsset table ready. Statements are unchanged until the first asset is added (the fixed-assets line stays accountant-keyed while the register is empty).')
