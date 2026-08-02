import 'dotenv/config'

// C3 · Action Inbox learning.
// No new columns — the outcome history the ranking reads has been accumulating
// in ActionLog since the Action Inbox shipped. This only adds the index that
// makes the per-type rolling-year read cheap.

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

console.log('C3 · Action Inbox learning')
await safe(
  `CREATE INDEX IF NOT EXISTS "ActionLog_type_createdAt_idx" ON "ActionLog"("type", "createdAt")`,
  'ActionLog(type, createdAt)',
)
console.log('done')
