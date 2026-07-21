import { createClient } from '@libsql/client'
import { existsSync, unlinkSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Builds a brand-new, fully isolated LOCAL SQLite file database with the
// current schema applied — completely separate from the shared Turso
// database that dev and production both point at. Nothing here ever touches
// the real business's data.
//
// The DDL (prisma/demo-schema.sql) is generated offline via:
//   npx prisma migrate diff --from-empty --to-schema=prisma/schema.prisma --script
// Re-run that command and overwrite prisma/demo-schema.sql whenever
// prisma/schema.prisma changes, then re-run this script.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'prisma', 'demo.db')
const DDL_PATH = path.join(__dirname, '..', 'prisma', 'demo-schema.sql')

for (const suffix of ['', '-wal', '-shm']) {
  const f = DB_PATH + suffix
  if (existsSync(f)) unlinkSync(f)
}

const client = createClient({ url: `file:${DB_PATH}` })
const sql = readFileSync(DDL_PATH, 'utf8')

// Split on statement boundaries, then strip each chunk's leading `-- Comment`
// line(s) — Prisma's generated script prefixes every statement with one.
const statements = sql
  .split(/;\s*\n/)
  .map(chunk => chunk.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim())
  .filter(s => s.length > 0)

console.log(`Applying ${statements.length} DDL statements to ${DB_PATH}…`)
for (const stmt of statements) {
  await client.execute(stmt)
}
console.log('✓ local demo database created and schema applied')
client.close()
