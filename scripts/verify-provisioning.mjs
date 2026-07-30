import { execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { seedBaseline } from './seed-baseline.mjs'

// Track B — proves provisioning works end-to-end WITHOUT a second live Turso DB:
// it generates the real schema DDL from prisma/schema.prisma, applies it to a
// fresh in-memory SQLite database, then runs the real seedBaseline() against it
// through a shim that translates the Turso pipeline calls into node:sqlite. Then
// it asserts the schema is complete, the baseline rows landed, and re-running the
// seed is idempotent. (node:sqlite is the same SQLite dialect Turso/libsql uses.)

const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

// 1. Generate DDL from the schema (the same call provision-client.mjs makes)
const ddl = execSync('npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script', { encoding: 'utf8' })
const statements = ddl.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)
check('DDL generated with a healthy statement count', statements.length >= 40, `got ${statements.length}`)

// 2. Apply DDL to a fresh in-memory SQLite
const db = new DatabaseSync(':memory:')
let ddlErr = null
for (const s of statements) { try { db.exec(s) } catch (e) { ddlErr = `${e.message} :: ${s.slice(0, 60)}` } }
check('all DDL statements execute cleanly', ddlErr === null, ddlErr ?? '')

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(r => r.name)
check('core tables created', ['Customer', 'Cat', 'Transaction', 'MembershipTier', 'Service', 'Room', 'AuditLog', 'StockMovement'].every(t => tables.includes(t)), tables.join(','))
check('new A-track columns present on Customer', (() => {
  const cols = db.prepare(`PRAGMA table_info(Customer)`).all().map(c => c.name)
  return cols.includes('erasedAt') && cols.includes('marketingConsentAt') && cols.includes('marketingConsentSource') && !cols.includes('photos')
})())

// 3. Run the REAL seedBaseline() through a node:sqlite shim
function shimPipe(reqs) {
  for (const req of reqs) {
    if (req.type !== 'execute') continue
    const args = (req.stmt.args ?? []).map(a => (a.type === 'null' ? null : a.type === 'integer' || a.type === 'float' ? Number(a.value) : a.value))
    db.prepare(req.stmt.sql).run(...args)
  }
  return []
}
await seedBaseline(shimPipe)

const tierCount = db.prepare(`SELECT COUNT(*) c FROM MembershipTier`).get().c
const svcCount = db.prepare(`SELECT COUNT(*) c FROM Service`).get().c
const roomCount = db.prepare(`SELECT COUNT(*) c FROM Room`).get().c
check('baseline seeded 3 membership tiers', tierCount === 3, `got ${tierCount}`)
check('baseline seeded 4 services', svcCount === 4, `got ${svcCount}`)
check('baseline seeded 2 rooms', roomCount === 2, `got ${roomCount}`)
check('baseline tiers include Essential + Black Circle', (() => {
  const names = db.prepare(`SELECT name FROM MembershipTier`).all().map(r => r.name)
  return names.includes('Essential') && names.includes('Black Circle')
})())
check('baseline carries no brand-specific copy', (() => {
  const taglines = db.prepare(`SELECT tagline FROM MembershipTier`).all().map(r => r.tagline ?? '').join(' ')
  return !/Cat Day/i.test(taglines)
})())

// 4. Idempotent re-run
await seedBaseline(shimPipe)
const tierCount2 = db.prepare(`SELECT COUNT(*) c FROM MembershipTier`).get().c
check('re-running the seed is idempotent (no duplicates)', tierCount2 === 3, `got ${tierCount2}`)

db.close()
console.log(`\n${pass}/${total} checks passed`)
if (pass !== total) process.exitCode = 1
