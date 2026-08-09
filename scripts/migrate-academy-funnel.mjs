import 'dotenv/config'

// M7 — link Academy enrolments to customers, and backfill the ones already
// recorded. Idempotent; safe to re-run.
//
// The backfill matters more than the column: without it the funnel reads zero
// on day one and looks broken, when in fact the history is there and simply was
// never joined. Matching is by normalised phone, then by email — the same order
// lib/academy.ts uses at enrolment time.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function run(requests) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
  })
  const json = await res.json()
  const err = json.results?.find(r => r?.type === 'error')
  if (err) throw new Error(err.error?.message)
  return json.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const t = v => ({ type: 'text', value: String(v) })
const rows = r => (r.response?.result?.rows ?? []).map(row => row.map(c => c.value))

async function safe(sql, label) {
  try {
    await run([exec(sql)])
    console.log(`  ✓ ${label}`)
  } catch (e) {
    if (/duplicate column|already exists/i.test(e.message)) { console.log(`  • skip (exists): ${label}`); return }
    throw e
  }
}

console.log(`Migrating ${RAW}`)

await safe(`ALTER TABLE "AcademyEnrollment" ADD COLUMN "customerId" TEXT`, 'AcademyEnrollment.customerId')
await safe(`CREATE INDEX "AcademyEnrollment_customerId_idx" ON "AcademyEnrollment"("customerId")`, 'AcademyEnrollment(customerId)')
await safe(`CREATE INDEX "AcademyEnrollment_enrolledAt_idx" ON "AcademyEnrollment"("enrolledAt")`, 'AcademyEnrollment(enrolledAt)')

// ── backfill ──
// Mirrors normalisePhone(): strip everything but digits, drop a leading 0 and
// prefix the Malaysian country code, so a stored "012-345 6789" matches
// "60123456789".
const digitsOnly = s => String(s ?? '').replace(/\D/g, '')
const normalise = s => {
  const d = digitsOnly(s)
  if (!d) return ''
  if (d.startsWith('60')) return d
  if (d.startsWith('0')) return `60${d.slice(1)}`
  return d
}

const enrolments = rows((await run([exec(
  `SELECT id, phone, email FROM "AcademyEnrollment" WHERE customerId IS NULL`)]))[0])
const customers = rows((await run([exec(
  `SELECT id, phone, email FROM "Customer" WHERE erasedAt IS NULL`)]))[0])

const byPhone = new Map()
const byEmail = new Map()
for (const [id, phone, email] of customers) {
  const p = normalise(phone)
  if (p && !byPhone.has(p)) byPhone.set(p, id)
  const e = String(email ?? '').trim().toLowerCase()
  if (e && !byEmail.has(e)) byEmail.set(e, id)
}

let linked = 0
for (const [id, phone, email] of enrolments) {
  const match = byPhone.get(normalise(phone)) ?? byEmail.get(String(email ?? '').trim().toLowerCase())
  if (!match) continue
  await run([exec(`UPDATE "AcademyEnrollment" SET customerId = ? WHERE id = ?`, [t(match), t(id)])])
  linked++
}

console.log(`  ✓ backfilled ${linked} of ${enrolments.length} unlinked enrolments`)
console.log('Done.')
