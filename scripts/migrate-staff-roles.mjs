import 'dotenv/config'

// Owner-defined staff roles.
//
// The four roles were a hardcoded union in lib/roles.ts; they are now rows the
// owner can edit. The existing four are seeded with EXACTLY the access they
// already had, so this migration changes no one's permissions on the way in —
// a migration that silently widens or narrows access is the one nobody notices
// until a groomer opens the finances.
//
// Idempotent: re-running skips the table and leaves existing rows alone.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL is not set')
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function run(sql, args = []) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args } }, { type: 'close' }] }),
  })
  const json = await res.json()
  const r = json.results?.[0]
  if (r?.type === 'error') throw new Error(r.error?.message ?? 'unknown')
  return (r?.response?.result?.rows ?? []).map(row => row.map(c => c.value))
}
async function safe(sql, label) {
  try { await run(sql); console.log(`  ✓ ${label}`) }
  catch (e) {
    if (/duplicate column|already exists/i.test(e.message)) { console.log(`  • skip (exists): ${label}`); return }
    throw new Error(`${label}: ${e.message}`)
  }
}
const t = v => ({ type: 'text', value: String(v) })
const i = v => ({ type: 'integer', value: String(v) })

console.log('StaffRoleDef — owner-defined roles')
await safe(`CREATE TABLE IF NOT EXISTS "StaffRoleDef" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "key"       TEXT NOT NULL UNIQUE,
  "label"     TEXT NOT NULL,
  "homePath"  TEXT NOT NULL,
  "paths"     TEXT NOT NULL,
  "isSystem"  BOOLEAN NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active"    BOOLEAN NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, 'StaffRoleDef table')

// The access each role has today, copied verbatim from lib/roles.ts.
const SEED = [
  { key: 'Manager', label: 'Store Manager', home: '/', system: 1, order: 0, paths: ['*'] },
  { key: 'FrontDesk', label: 'Front Desk', home: '/actions', system: 0, order: 1, paths:
    ['/actions', '/appointments', '/board', '/runsheet', '/rooms', '/pos', '/customers', '/cats', '/memberships', '/incidents', '/requests'] },
  { key: 'Groomer', label: 'Groomer', home: '/board', system: 0, order: 2, paths: ['/board', '/cats'] },
  { key: 'Boarding', label: 'Boarding Care', home: '/runsheet', system: 0, order: 3, paths: ['/runsheet', '/rooms', '/cats'] },
]

const existing = new Set((await run(`SELECT key FROM "StaffRoleDef"`)).map(r => String(r[0])))
for (const r of SEED) {
  if (existing.has(r.key)) { console.log(`  • skip (exists): role ${r.key}`); continue }
  await run(
    `INSERT INTO "StaffRoleDef" (id,key,label,homePath,paths,isSystem,sortOrder,active,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(`role_${r.key.toLowerCase()}`), t(r.key), t(r.label), t(r.home), t(JSON.stringify(r.paths)), i(r.system), i(r.order)])
  console.log(`  ✓ role ${r.key} (${r.paths.length === 1 && r.paths[0] === '*' ? 'unrestricted' : `${r.paths.length} tabs`})`)
}

console.log('\nDone.')
