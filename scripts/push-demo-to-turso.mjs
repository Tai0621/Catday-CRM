import 'dotenv/config'
import { DatabaseSync } from 'node:sqlite'
import { loadClients, selectClients } from './clients.mjs'

// Load the local demo database into a hosted demo tenant.
//
// seed-demo-data.mjs issues hundreds of individual Prisma writes. Against a
// local file that is instant; against Turso in Tokyo it is hundreds of
// sequential HTTPS round-trips, which is slow and — as it turned out — drops
// with ECONNRESET partway through, leaving the tenant half-populated.
//
// So: seed locally where it is fast, then bulk-copy the result here in batched
// pipeline requests. One network round-trip per few hundred rows instead of per
// row. Idempotent — it clears the target's tables first, so re-running fixes a
// partial load rather than duplicating it.
//
//   npm run demo:reset                      # build prisma/demo.db locally
//   node scripts/push-demo-to-turso.mjs     # copy it up
//
// Refuses any tenant not marked env:"demo" in the registry.

const SOURCE = 'prisma/demo.db'
const BATCH = 200

const slug = process.argv.find(a => a.startsWith('--only='))?.split('=')[1] ?? 'demo'
const [client] = selectClients(loadClients(), { only: slug })
if (!client) {
  console.error(`No tenant "${slug}" in the registry.`)
  process.exit(1)
}
if (client.env !== 'demo') {
  console.error(`Refusing to overwrite "${client.slug}" — it is marked env:"${client.env}", not "demo".`)
  console.error('This script deletes every row in the target before loading.')
  process.exit(1)
}

const HTTP = client.databaseUrl.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function pipe(requests) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.authToken}` },
    body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
  const json = await res.json()
  const err = json.results?.find(r => r?.type === 'error')
  if (err) throw new Error(err.error?.message ?? 'unknown pipeline error')
  return json.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

// libsql wants explicitly typed arguments; node:sqlite hands back native JS.
function arg(v) {
  if (v === null || v === undefined) return { type: 'null' }
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }
  }
  if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') }
  return { type: 'text', value: String(v) }
}

const db = new DatabaseSync(SOURCE, { readOnly: true })
const tables = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name`,
).all().map(r => r.name)

console.log(`Loading ${SOURCE} → ${client.name} (${client.slug})`)
console.log(`  ${tables.length} tables\n`)

// Foreign keys off for the duration: rows are copied table-by-table in
// alphabetical order, which is not dependency order, and re-deriving a valid
// insert order across 43 tables would be far more fragile than this.
await pipe([exec('PRAGMA foreign_keys=OFF')].concat(
  [...tables].reverse().map(t => exec(`DELETE FROM "${t}"`)),
))
console.log('  cleared target\n')

let grandTotal = 0
for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all()
  if (rows.length === 0) continue

  const cols = Object.keys(rows[0])
  const sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    await pipe([exec('PRAGMA foreign_keys=OFF')].concat(
      slice.map(r => exec(sql, cols.map(c => arg(r[c])))),
    ))
  }
  grandTotal += rows.length
  console.log(`  ${table.padEnd(24)} ${String(rows.length).padStart(5)}`)
}

console.log(`\n  ${grandTotal} rows loaded — verifying…`)

let mismatches = 0
for (const table of tables) {
  const local = db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n
  const [res] = await pipe([exec(`SELECT COUNT(*) FROM "${table}"`)])
  const remote = Number(res.response.result.rows[0][0].value)
  if (local !== remote) {
    console.error(`  ✗ ${table}: local ${local} vs remote ${remote}`)
    mismatches++
  }
}

if (mismatches > 0) {
  console.error(`\n${mismatches} table(s) did not match. Re-run to reload.`)
  process.exitCode = 1
} else {
  console.log(`  ✓ every table matches the local demo database`)
}
