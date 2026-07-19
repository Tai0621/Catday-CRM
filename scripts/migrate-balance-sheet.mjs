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

console.log('Balance sheet migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "BalanceSheetCell" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "asOf" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'BalanceSheetCell table',
)
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "BalanceSheetCell_asOf_lineKey_key" ON "BalanceSheetCell"("asOf","lineKey")`, 'unique (asOf, lineKey)')

console.log('done')
