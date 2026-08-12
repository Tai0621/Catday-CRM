import 'dotenv/config'

// How each role's sidebar is arranged: pinned tabs plus named drop-downs.
//
// Presentation only. Access still lives in StaffRoleDef.paths, and the two are
// separate columns on purpose — arranging a sidebar must never change what
// someone can open.
//
// Nullable with no backfill: a role with no layout falls back to "always-allowed
// pinned, everything else in one group", which is what they see today.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL is not set')
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

console.log('StaffRoleDef — sidebar layout')
await safe(`ALTER TABLE "StaffRoleDef" ADD COLUMN "layout" TEXT`, 'StaffRoleDef.layout')
console.log('\nDone.')
