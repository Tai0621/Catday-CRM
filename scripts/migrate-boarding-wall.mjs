import 'dotenv/config'

// v1.3.0 · Boarding Wall — zones and unit positions.
//
//   node scripts/migrate-boarding-wall.mjs            # apply
//   node scripts/migrate-boarding-wall.mjs --check    # report only
//
// Idempotent. Adds RoomZone and six nullable columns on Room; existing rooms
// keep working untouched, and any room without a position renders in the
// "Unplaced" strip rather than disappearing.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const CHECK = process.argv.includes('--check')

async function pipe(requests) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
  })
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  if (!json.results) throw new Error(`Unexpected response: ${JSON.stringify(json).slice(0, 200)}`)
  return json.results
}

async function safe(sql, label) {
  if (CHECK) return
  const [r] = await pipe([{ type: 'execute', stmt: { sql } }])
  if (r?.type === 'error') {
    const msg = r.error?.message ?? ''
    if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw new Error(`${label}: ${msg}`)
  }
  console.log(`  ✓ ${label}`)
}

async function query(sql) {
  const [r] = await pipe([{ type: 'execute', stmt: { sql } }])
  if (r?.type === 'error') throw new Error(r.error?.message)
  return r.response.result
}

console.log(CHECK ? 'Checking boarding-wall schema…\n' : 'Applying boarding-wall migration…\n')

await safe(`CREATE TABLE IF NOT EXISTS "RoomZone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'Boarding',
  "cols" INTEGER NOT NULL DEFAULT 1,
  "rows" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, 'RoomZone')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "RoomZone_code_key" ON "RoomZone"("code")`, 'RoomZone.code unique')

await safe(`ALTER TABLE "Room" ADD COLUMN "zoneId" TEXT REFERENCES "RoomZone"("id") ON DELETE SET NULL ON UPDATE CASCADE`, 'Room.zoneId')
await safe(`ALTER TABLE "Room" ADD COLUMN "gridCol" INTEGER`, 'Room.gridCol')
await safe(`ALTER TABLE "Room" ADD COLUMN "gridRow" INTEGER`, 'Room.gridRow')
await safe(`ALTER TABLE "Room" ADD COLUMN "colSpan" INTEGER NOT NULL DEFAULT 1`, 'Room.colSpan')
await safe(`ALTER TABLE "Room" ADD COLUMN "rowSpan" INTEGER NOT NULL DEFAULT 1`, 'Room.rowSpan')
await safe(`ALTER TABLE "Room" ADD COLUMN "unitKind" TEXT NOT NULL DEFAULT 'arch'`, 'Room.unitKind')
await safe(`CREATE INDEX IF NOT EXISTS "Room_zoneId_idx" ON "Room"("zoneId")`, 'Room(zoneId)')

const tables = await query(`SELECT name FROM sqlite_master WHERE type='table'`)
const have = new Set(tables.rows.map(r => r[0].value))
const cols = await query(`PRAGMA table_info("Room")`)
const roomCols = new Set(cols.rows.map(r => r[1].value))
const want = ['zoneId', 'gridCol', 'gridRow', 'colSpan', 'rowSpan', 'unitKind']

console.log('\nState:')
console.log(`  ${have.has('RoomZone') ? '✓' : '✗'} table RoomZone`)
for (const c of want) console.log(`  ${roomCols.has(c) ? '✓' : '✗'} Room.${c}`)

const missing = (have.has('RoomZone') ? 0 : 1) + want.filter(c => !roomCols.has(c)).length
console.log(missing === 0 ? '\nSchema is current.' : `\n${missing} item(s) missing.`)
if (CHECK && missing > 0) process.exitCode = 1
