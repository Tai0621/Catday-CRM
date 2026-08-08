import 'dotenv/config'

// C9 — MonthlyReport: one department's report for one closed month.
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
  CREATE TABLE "MonthlyReport" (
    "id"           TEXT PRIMARY KEY NOT NULL,
    "month"        TEXT NOT NULL,
    "department"   TEXT NOT NULL,
    "facts"        TEXT NOT NULL,
    "headline"     TEXT,
    "observations" TEXT,
    "actions"      TEXT,
    "status"       TEXT NOT NULL DEFAULT 'Facts',
    "unsupported"  TEXT,
    "model"        TEXT,
    "inputTokens"  INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "generatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`, 'MonthlyReport table')

await safe(`CREATE UNIQUE INDEX "MonthlyReport_month_department_key" ON "MonthlyReport"("month", "department")`,
  'MonthlyReport(month, department) unique')
await safe(`CREATE INDEX "MonthlyReport_month_idx" ON "MonthlyReport"("month")`, 'MonthlyReport(month)')

console.log('Done.')
