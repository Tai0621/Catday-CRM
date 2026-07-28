import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'

// Logical backup of the Turso database — a self-contained JSON dump of every
// table, using the same HTTP pipeline the migrations use (no CLI needed). Writes
// to ./backups/ and, when BLOB_READ_WRITE_TOKEN is set, uploads a copy to Vercel
// Blob under backups/. Restore with scripts/restore-db.mjs (see BACKUP_RESTORE.md).

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW || !TOKEN) { console.error('DATABASE_URL / DATABASE_AUTH_TOKEN required'); process.exit(1) }
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const resultOf = r => r.response.result

async function main() {
  // Enumerate real tables (skip SQLite internals + libsql replication bookkeeping).
  const [tablesRes] = await pipe([exec(
    `SELECT name FROM sqlite_master WHERE type='table'
      AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%'
      ORDER BY name`,
  )])
  const tables = resultOf(tablesRes).rows.map(row => row[0].value)

  const dump = { generatedAt: new Date().toISOString(), database: RAW.replace(/\/\/.*@/, '//'), tables: {} }
  let totalRows = 0
  for (const name of tables) {
    const [res] = await pipe([exec(`SELECT * FROM "${name}"`)])
    const r = resultOf(res)
    const columns = r.cols.map(c => c.name)
    const rows = r.rows // array of arrays of {type, value}
    dump.tables[name] = { columns, rows }
    totalRows += rows.length
    console.log(`  • ${name}: ${rows.length} rows`)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.resolve('backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `backup-${stamp}.json`)
  const json = JSON.stringify(dump)
  fs.writeFileSync(file, json)
  console.log(`\nWrote ${file} (${tables.length} tables, ${totalRows} rows, ${(json.length / 1e6).toFixed(2)} MB)`)

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob')
    const blob = await put(`backups/backup-${stamp}.json`, json, {
      access: 'private', contentType: 'application/json', token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    console.log(`Uploaded to Blob: ${blob.pathname}`)
  } else {
    console.log('(BLOB_READ_WRITE_TOKEN not set — kept local copy only)')
  }
}

main().catch(e => { console.error('backup failed:', e); process.exit(1) })
