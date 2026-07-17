import 'dotenv/config'
import crypto from 'node:crypto'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW || !TOKEN) throw new Error('DATABASE_URL / DATABASE_AUTH_TOKEN not set')
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

// Build the room list: 54 Standard, then 7 Suite
const rooms = []
for (let i = 1; i <= 54; i++) rooms.push({ name: `Room ${String(i).padStart(2, '0')}`, type: 'Standard' })
for (let i = 1; i <= 7; i++)  rooms.push({ name: `Suite ${i}`, type: 'Suite' })

// Skip any that already exist (idempotent re-runs)
async function pipeline(requests) {
  const res = await fetch(HTTP, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests }) })
  const json = await res.json()
  const err = json.results?.find(r => r?.type === 'error')
  if (err) throw new Error(err.error?.message)
  return json.results
}

const existRes = await pipeline([{ type: 'execute', stmt: { sql: 'SELECT name FROM Room' } }, { type: 'close' }])
const existing = new Set((existRes[0].response.result.rows).map(r => r[0].value))

const t = (v) => ({ type: 'text', value: String(v) })
const n = (v) => ({ type: 'integer', value: String(v) })

const requests = []
let sort = 0, made = 0
for (const r of rooms) {
  if (existing.has(r.name)) { sort++; continue }
  requests.push({ type: 'execute', stmt: {
    sql: `INSERT INTO Room (id, name, type, status, sortOrder, isActive, createdAt, updatedAt)
          VALUES (?, ?, ?, 'Available', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    args: [t(crypto.randomUUID()), t(r.name), t(r.type), n(sort)] } })
  sort++; made++
}
requests.push({ type: 'close' })

if (made === 0) { console.log('All rooms already exist — nothing to add.'); process.exit(0) }
await pipeline(requests)
console.log(`Inserted ${made} rooms (${rooms.filter(r=>r.type==='Standard').length} Standard, ${rooms.filter(r=>r.type==='Suite').length} Suite).`)

// Verify
const check = await pipeline([{ type: 'execute', stmt: { sql: "SELECT type, COUNT(*) c FROM Room GROUP BY type" } }, { type: 'close' }])
for (const row of check[0].response.result.rows) console.log(`  ${row[0].value}: ${row[1].value}`)
