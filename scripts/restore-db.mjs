import 'dotenv/config'
import fs from 'node:fs'

// Restore a logical backup produced by backup-db.mjs into a Turso database.
// DESTRUCTIVE: it DELETEs each table's contents before re-inserting. Intended
// for disaster recovery into a freshly-migrated (schema-present) database.
// Guarded — pass the backup file and --confirm to actually run.
//
//   node scripts/restore-db.mjs backups/backup-XXXX.json --confirm
//
// Restore the SCHEMA first by running the migrate-*.mjs scripts (see
// BACKUP_RESTORE.md); this script only restores data (rows).

const file = process.argv[2]
const confirmed = process.argv.includes('--confirm')
if (!file) { console.error('usage: node scripts/restore-db.mjs <backup.json> --confirm'); process.exit(1) }

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
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

async function main() {
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'))
  const tables = Object.keys(dump.tables)
  console.log(`Backup from ${dump.generatedAt} · ${tables.length} tables`)
  if (!confirmed) {
    console.log('\nDRY RUN — pass --confirm to write. Would restore:')
    for (const t of tables) console.log(`  • ${t}: ${dump.tables[t].rows.length} rows`)
    return
  }

  // FKs off for the duration so insertion order doesn't matter.
  await pipe([exec('PRAGMA foreign_keys=OFF')])
  for (const name of tables) {
    const { columns, rows } = dump.tables[name]
    await pipe([exec(`DELETE FROM "${name}"`)])
    if (rows.length === 0) { console.log(`  • ${name}: 0 rows`); continue }
    const colList = columns.map(c => `"${c}"`).join(',')
    const placeholders = columns.map(() => '?').join(',')
    // Insert in chunks to keep each pipeline request reasonable.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      await pipe(chunk.map(cells => exec(`INSERT INTO "${name}" (${colList}) VALUES (${placeholders})`, cells)))
    }
    console.log(`  • ${name}: restored ${rows.length} rows`)
  }
  await pipe([exec('PRAGMA foreign_keys=ON')])
  console.log('\nRestore complete.')
}

main().catch(e => { console.error('restore failed:', e); process.exit(1) })
