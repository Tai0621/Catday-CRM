import 'dotenv/config'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL not set')

const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function pipeline(statements) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      requests: [...statements.map(s => ({ type: 'execute', stmt: s })), { type: 'close' }],
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function safe(stmt, label) {
  const s = typeof stmt === 'string' ? { sql: stmt } : stmt
  try {
    const out = await pipeline([s])
    const r = out.results?.[0]
    if (r?.type === 'error') {
      const msg = r.error?.message ?? ''
      if (/duplicate column|already exists|UNIQUE constraint/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
      throw new Error(msg)
    }
    console.log(`  ✓ ${label}`)
  } catch (e) {
    const msg = String(e.message ?? e)
    if (/duplicate column|already exists|UNIQUE constraint/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw e
  }
}

console.log('Operations & Sales migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "Staff" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'Staff table',
)
await safe('CREATE UNIQUE INDEX IF NOT EXISTS "Staff_pinHash_key" ON "Staff" ("pinHash")', 'Staff pin index')

await safe(
  `CREATE TABLE IF NOT EXISTS "Service" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "price" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'Service table',
)
await safe('CREATE UNIQUE INDEX IF NOT EXISTS "Service_name_key" ON "Service" ("name")', 'Service name index')

await safe(
  `CREATE TABLE IF NOT EXISTS "CareTask" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "date" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "catId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "staffId" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CareTask table',
)
await safe('CREATE UNIQUE INDEX IF NOT EXISTS "CareTask_date_appointmentId_task_key" ON "CareTask" ("date","appointmentId","task")', 'CareTask unique index')

await safe(
  `CREATE TABLE IF NOT EXISTS "CashUp" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "date" TEXT NOT NULL,
    "expectedRM" REAL NOT NULL,
    "countedRM" REAL NOT NULL,
    "variance" REAL NOT NULL,
    "note" TEXT,
    "staffName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CashUp table',
)
await safe('CREATE UNIQUE INDEX IF NOT EXISTS "CashUp_date_key" ON "CashUp" ("date")', 'CashUp date index')

await safe('ALTER TABLE "Appointment" ADD COLUMN "serviceId" TEXT', 'Appointment.serviceId')
await safe('ALTER TABLE "Appointment" ADD COLUMN "staffId" TEXT', 'Appointment.staffId')
await safe('ALTER TABLE "Appointment" ADD COLUMN "depositRM" REAL', 'Appointment.depositRM')
await safe('ALTER TABLE "Transaction" ADD COLUMN "method" TEXT', 'Transaction.method')
await safe('ALTER TABLE "Cat" ADD COLUMN "careNotes" TEXT', 'Cat.careNotes')

// ── Seed the service menu (manager edits prices/durations at /services) ──
const SERVICES = [
  ['svc-fullgroom',  'Full Groom',                    'Grooming',  90, 180, 1],
  ['svc-basicbath',  'Basic Bath & Dry',              'Bath',      60, 120, 2],
  ['svc-demat',      'De-matting Session',            'Grooming', 120, 250, 3],
  ['svc-seasonal',   'Seasonal Care Package',         'Grooming',  90, 128, 4],
  ['svc-diagnosis',  'Health Diagnosis & Profiling',  'Diagnosis', 30,  88, 5],
  ['svc-stress',     'Stress & Behaviour Assessment', 'Diagnosis', 30,  68, 6],
  ['svc-board-std',  'Boarding — Standard (per night)', 'Boarding', 0,  80, 7],
  ['svc-board-suite','Boarding — Suite (per night)',    'Boarding', 0, 120, 8],
]
for (const [id, name, category, durationMin, price, sortOrder] of SERVICES) {
  await safe({
    sql: `INSERT INTO "Service" ("id","name","category","durationMin","price","sortOrder","updatedAt")
          VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    args: [
      { type: 'text', value: id }, { type: 'text', value: name }, { type: 'text', value: category },
      { type: 'integer', value: String(durationMin) }, { type: 'float', value: price },
      { type: 'integer', value: String(sortOrder) },
    ],
  }, `seed service: ${name}`)
}

console.log('Done.')
