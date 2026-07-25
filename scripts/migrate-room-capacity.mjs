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

console.log('Room capacity (multi-cat) migration…')

await safe(`ALTER TABLE "Room" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 2`, 'Room.capacity')
// Set capacities by room class per the owner's rule (Standard 2, Suite 6, DayStay 1).
await safe(`UPDATE "Room" SET "capacity" = 6 WHERE "type" = 'Suite'`, 'Suites → 6')
await safe(`UPDATE "Room" SET "capacity" = 2 WHERE "type" = 'Standard'`, 'Standards → 2')
await safe(`UPDATE "Room" SET "capacity" = 1 WHERE "type" = 'DayStay'`, 'DayStay → 1')

console.log('done — rooms now hold multiple cats up to their capacity.')
