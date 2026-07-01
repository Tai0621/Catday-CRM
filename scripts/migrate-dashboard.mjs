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

async function safe(sql, label) {
  try {
    const out = await pipeline([{ sql }])
    const r = out.results?.[0]
    if (r?.type === 'error') {
      const msg = r.error?.message ?? ''
      if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
      throw new Error(msg)
    }
    console.log(`  ✓ ${label}`)
  } catch (e) {
    const msg = String(e.message ?? e)
    if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw e
  }
}

console.log('Applying dashboard schema changes…')

await safe('ALTER TABLE "Cat" ADD COLUMN "vaccinationExpiry" DATETIME', 'Cat.vaccinationExpiry')
await safe('ALTER TABLE "Appointment" ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT 0', 'Appointment.paid')

await safe(
  `CREATE TABLE IF NOT EXISTS "Incident" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "customerId" TEXT,
    "catId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'Incident table',
)

console.log('Done.')
