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

console.log('Creating business plan tables…')

await safe(
  `CREATE TABLE IF NOT EXISTS "BusinessPlan" (
    "id" TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
    "startMonth" TEXT NOT NULL,
    "breakevenMonth" TEXT NOT NULL,
    "avgSaleValue" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RM',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'BusinessPlan table',
)

await safe(
  `CREATE TABLE IF NOT EXISTS "MonthlyTarget" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "month" TEXT NOT NULL UNIQUE,
    "revenueTarget" REAL NOT NULL DEFAULT 0,
    "costBudget" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'MonthlyTarget table',
)

console.log('Done.')
