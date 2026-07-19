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

console.log('Statement row-order migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "StatementRowOrder" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "year" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "orderJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'StatementRowOrder table',
)
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "StatementRowOrder_year_section_key" ON "StatementRowOrder"("year","section")`, 'unique (year, section)')

console.log('done')
