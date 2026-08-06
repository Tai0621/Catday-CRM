import 'dotenv/config'

// C1 · Copilot dock — daily AI spend tracking.
// Additive: one new table. No existing data is touched.

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

console.log('C1 · AI usage tracking')

await safe(`CREATE TABLE IF NOT EXISTS "AiUsage" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "date"         TEXT NOT NULL,
  "inputTokens"  INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "calls"        INTEGER NOT NULL DEFAULT 0,
  "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, 'AiUsage table')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "AiUsage_date_key" ON "AiUsage"("date")`, 'AiUsage.date unique')

console.log('done')
