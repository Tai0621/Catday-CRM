import 'dotenv/config'

// v1.3.0 · Cat inventory.
//
// Adds the stock sidecar (CatStock), litters, the per-cat cost ledger, the house
// flag on Customer, and four date columns on Cat. Idempotent — the `safe()`
// helper tolerates "already exists" / "duplicate column", so re-running is fine.
//
//   node scripts/migrate-cat-inventory.mjs            # apply
//   node scripts/migrate-cat-inventory.mjs --check    # report only, writes nothing
//
// Also rewrites STORED ROLE PATHS, which is the part that is easy to miss:
// `/products` moved to `/inventory/products`, and StaffRoleDef.paths is data. A
// role that was granted Products would otherwise be bounced from the page by an
// access check that still names the old route — the tab would look broken, not
// forbidden, and nobody would connect it to a rename.

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
  const json = await res.json()
  return json.results ?? []
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

async function query(sql, args = []) {
  const [r] = await pipe([{ type: 'execute', stmt: { sql, args } }])
  if (r?.type === 'error') throw new Error(r.error?.message)
  return r.response.result
}

const TABLES = ['CatStock', 'Litter', 'CatCost', 'CatCostBatch']
const CAT_COLUMNS = ['lastVaccinatedAt', 'rabiesAt', 'desexedAt']

console.log(CHECK ? 'Checking cat-inventory schema…\n' : 'Applying cat-inventory migration…\n')

// ── tables ──
await safe(`CREATE TABLE IF NOT EXISTS "Litter" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "damId" TEXT,
  "sireId" TEXT,
  "sireName" TEXT,
  "expectedAt" DATETIME,
  "bornAt" DATETIME,
  "bornCount" INTEGER,
  "survivingCount" INTEGER,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Litter_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Cat" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Litter_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Cat" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`, 'Litter')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "Litter_code_key" ON "Litter"("code")`, 'Litter.code unique')

await safe(`CREATE TABLE IF NOT EXISTS "CatStock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "catId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'InStock',
  "acquiredAt" DATETIME,
  "acquiredFrom" TEXT,
  "acquisitionRM" REAL NOT NULL DEFAULT 0,
  "askingRM" REAL,
  "reservedForId" TEXT,
  "depositRM" REAL,
  "reservedUntil" DATETIME,
  "microchipNo" TEXT,
  "registrationNo" TEXT,
  "litterId" TEXT,
  "soldAt" DATETIME,
  "soldToId" TEXT,
  "saleRM" REAL,
  "exitAt" DATETIME,
  "exitReason" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatStock_catId_fkey" FOREIGN KEY ("catId") REFERENCES "Cat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CatStock_litterId_fkey" FOREIGN KEY ("litterId") REFERENCES "Litter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`, 'CatStock')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "CatStock_catId_key" ON "CatStock"("catId")`, 'CatStock.catId unique')
await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "CatStock_sku_key" ON "CatStock"("sku")`, 'CatStock.sku unique')
await safe(`CREATE INDEX IF NOT EXISTS "CatStock_status_role_idx" ON "CatStock"("status", "role")`, 'CatStock(status,role)')

await safe(`CREATE TABLE IF NOT EXISTS "CatCostBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "date" DATETIME NOT NULL,
  "vendor" TEXT,
  "totalRM" REAL NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'PerCat',
  "notes" TEXT,
  "expenseId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, 'CatCostBatch')

await safe(`CREATE TABLE IF NOT EXISTS "CatCost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "catStockId" TEXT NOT NULL,
  "date" DATETIME NOT NULL,
  "category" TEXT NOT NULL,
  "amountRM" REAL NOT NULL,
  "batchId" TEXT,
  "expenseId" TEXT,
  "vendor" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatCost_catStockId_fkey" FOREIGN KEY ("catStockId") REFERENCES "CatStock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CatCost_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatCostBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`, 'CatCost')
await safe(`CREATE INDEX IF NOT EXISTS "CatCost_catStockId_date_idx" ON "CatCost"("catStockId", "date")`, 'CatCost(catStockId,date)')
await safe(`CREATE INDEX IF NOT EXISTS "CatCost_batchId_idx" ON "CatCost"("batchId")`, 'CatCost(batchId)')

// ── columns ──
await safe(`ALTER TABLE "CatStock" ADD COLUMN "saleReference" TEXT`, 'CatStock.saleReference')
await safe(`ALTER TABLE "Customer" ADD COLUMN "isHouse" BOOLEAN NOT NULL DEFAULT 0`, 'Customer.isHouse')
await safe(`ALTER TABLE "Cat" ADD COLUMN "lastVaccinatedAt" DATETIME`, 'Cat.lastVaccinatedAt')
await safe(`ALTER TABLE "Cat" ADD COLUMN "rabiesAt" DATETIME`, 'Cat.rabiesAt')
await safe(`ALTER TABLE "Cat" ADD COLUMN "desexedAt" DATETIME`, 'Cat.desexedAt')

// ── stored role paths: /products → /inventory/products ──
//
// StaffRoleDef.paths and .layout are JSON text columns holding route strings.
// A plain string replace is correct here and a JSON round trip is not: `layout`
// nests tab hrefs inside group objects, and rewriting it structurally would risk
// reordering a sidebar the owner arranged by hand.
if (!CHECK) {
  const roles = await query(`SELECT id, paths, layout FROM StaffRoleDef`)
  let touched = 0
  for (const row of roles.rows) {
    const id = row[0].value
    const paths = row[1]?.value ?? null
    const layout = row[2]?.value ?? null
    const nextPaths = paths == null ? null : paths.replaceAll('"/products"', '"/inventory/products"')
    const nextLayout = layout == null ? null : layout.replaceAll('"/products"', '"/inventory/products"')
    if (nextPaths === paths && nextLayout === layout) continue
    await query(`UPDATE StaffRoleDef SET paths = ?, layout = ? WHERE id = ?`, [
      nextPaths == null ? { type: 'null' } : { type: 'text', value: nextPaths },
      nextLayout == null ? { type: 'null' } : { type: 'text', value: nextLayout },
      { type: 'text', value: id },
    ])
    touched++
  }
  console.log(`  ✓ role paths rewritten: ${touched} role${touched === 1 ? '' : 's'}`)
}

// ── post-check ──
const names = await query(`SELECT name FROM sqlite_master WHERE type='table'`)
const have = new Set(names.rows.map(r => r[0].value))
const catCols = await query(`PRAGMA table_info("Cat")`)
const catHave = new Set(catCols.rows.map(r => r[1].value))
const custCols = await query(`PRAGMA table_info("Customer")`)
const custHave = new Set(custCols.rows.map(r => r[1].value))

console.log('\nState:')
for (const t of TABLES) console.log(`  ${have.has(t) ? '✓' : '✗'} table ${t}`)
for (const c of CAT_COLUMNS) console.log(`  ${catHave.has(c) ? '✓' : '✗'} Cat.${c}`)
console.log(`  ${custHave.has('isHouse') ? '✓' : '✗'} Customer.isHouse`)

const missing = TABLES.filter(t => !have.has(t)).length
  + CAT_COLUMNS.filter(c => !catHave.has(c)).length
  + (custHave.has('isHouse') ? 0 : 1)
console.log(missing === 0 ? '\nSchema is current.' : `\n${missing} item(s) missing.`)
if (CHECK && missing > 0) process.exitCode = 1
