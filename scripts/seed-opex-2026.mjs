import 'dotenv/config'
import crypto from 'node:crypto'

// One-off: key the Excel model's fixed monthly opex into the 2026 actuals as
// accountant cells (blue). Idempotent — re-running only fills months that
// have no keyed figure yet, so later manual edits are never clobbered.

const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const YEAR = 2026

const FIXED_OPEX = {
  'opex:Rent': 17000,
  'opex:Salaries': 20800,
  'opex:Cleaning Supplies': 850,
  'opex:Utilities': 4000,
  'opex:Marketing': 5500,
  'opex:Maintenance': 1000,
}

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(v) })
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

// Existing keyed cells — don't touch them
const res = await pipe([exec(`SELECT month, rowKey FROM StatementCell WHERE year = ?`, [i(YEAR)])])
const have = new Set(res[0].response.result.rows.map(r => `${r[1].value}|${r[0].value}`))

const reqs = []
let made = 0
for (const [rowKey, amount] of Object.entries(FIXED_OPEX)) {
  for (let m = 0; m < 12; m++) {
    if (have.has(`${rowKey}|${m}`)) continue
    reqs.push(exec(
      `INSERT INTO StatementCell (id, year, month, rowKey, amount, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), i(YEAR), i(m), t(rowKey), f(amount)]))
    made++
  }
}
if (made === 0) { console.log('all fixed-opex cells already keyed — nothing to do'); process.exit(0) }
await pipe(reqs)
const monthly = Object.values(FIXED_OPEX).reduce((a, b) => a + b, 0)
console.log(`keyed ${made} cells (${Object.keys(FIXED_OPEX).length} categories × months without existing figures)`)
console.log(`monthly fixed opex: RM ${monthly.toLocaleString()} · year RM ${(monthly * 12).toLocaleString()}`)
