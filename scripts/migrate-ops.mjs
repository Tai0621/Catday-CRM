import 'dotenv/config'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL not set')

const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function pipeline(statements) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      requests: [...statements.map(s => ({ type: 'execute', stmt: s })), { type: 'close' }],
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function safe(sql, label) {
  try {
    const out = await pipeline([{ sql }])
    const r = out.results?.[0]
    if (r?.type === 'error') {
      const msg = r.error?.message ?? ''
      if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
      throw new Error(msg)
    }
    console.log(`  ✓ ${label}`)
  } catch (e) {
    const msg = String(e.message ?? e)
    if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw e
  }
}

console.log('Operations Round migration…')

await safe('ALTER TABLE "Cat" ADD COLUMN "coatType" TEXT', 'Cat.coatType')
await safe('ALTER TABLE "Cat" ADD COLUMN "foundingNumber" INTEGER', 'Cat.foundingNumber')
await safe('CREATE UNIQUE INDEX IF NOT EXISTS "Cat_foundingNumber_key" ON "Cat" ("foundingNumber")', 'Cat foundingNumber unique index')
await safe('ALTER TABLE "Customer" ADD COLUMN "walletBalance" REAL NOT NULL DEFAULT 0', 'Customer.walletBalance')

await safe(
  `CREATE TABLE IF NOT EXISTS "CatAssessment" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "catId" TEXT NOT NULL,
    "skinCondition" TEXT,
    "coatCondition" TEXT,
    "earCondition" TEXT,
    "nailCondition" TEXT,
    "stressLevel" TEXT,
    "weightKg" REAL,
    "findings" TEXT,
    "carePlan" TEXT,
    "rebookDays" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CatAssessment table',
)
await safe('CREATE INDEX IF NOT EXISTS "CatAssessment_catId_idx" ON "CatAssessment" ("catId")', 'CatAssessment index')

await safe(
  `CREATE TABLE IF NOT EXISTS "WalletEntry" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'WalletEntry table',
)
await safe('CREATE INDEX IF NOT EXISTS "WalletEntry_customerId_idx" ON "WalletEntry" ("customerId")', 'WalletEntry index')

console.log('Done.')
