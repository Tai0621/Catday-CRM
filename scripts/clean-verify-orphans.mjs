import 'dotenv/config'
import './_guard.mjs'

// Delete VERIFY* fixtures a verification run left behind.
//
//   node scripts/clean-verify-orphans.mjs
//
// Every verify-*.mjs cleans up in a `finally`, so this is only needed when a run
// is KILLED — the finally never executes and the seeded rows persist. That is
// not merely untidy: the next run of those suites dies on UNIQUE constraints,
// and until this is run the whole sweep reads as a wall of regressions that are
// really one interrupted run.
//
// Worse, the leftovers can break the app. An interrupted verify-commission left
// three active Staff rows carrying an unparseable placeholder hash, and because
// login verifies a PIN against every active staff member in turn, NOBODY could
// sign in with a PIN until they were deleted. `verifyPassword` no longer throws
// on a bad hash (lib/auth.ts) and that suite now seeds a real-shaped one, but
// this stays as the recovery tool.
//
// Guarded like every script here — it refuses to touch the live database.

const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
async function q(sql) {
  const r = await fetch(HTTP, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }) })
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`)
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) { const m = e.error?.message ?? ''; if (/no such table|no such column/i.test(m)) return { skipped: m }; throw new Error(m) }
  return j.results[0].response.result
}
const MARKED_CAT  = `SELECT id FROM Cat WHERE name LIKE 'VERIFY%'`
const MARKED_CUST = `SELECT id FROM Customer WHERE name LIKE 'VERIFY%' OR phone LIKE '%VERIFY%'`
const MARKED_ROOM = `SELECT id FROM Room WHERE name LIKE 'VERIFY%'`
const APPTS = `SELECT id FROM Appointment WHERE catId IN (${MARKED_CAT}) OR customerId IN (${MARKED_CUST}) OR roomId IN (${MARKED_ROOM})`

// Dependents first, parents last.
const steps = [
  ['CareTask',      `DELETE FROM CareTask WHERE appointmentId IN (${APPTS})`],
  ['DailyCareLog',  `DELETE FROM DailyCareLog WHERE appointmentId IN (${APPTS})`],
  ['BoardingCheck', `DELETE FROM BoardingCheck WHERE appointmentId IN (${APPTS})`],
  ['BoardingItem',  `DELETE FROM BoardingItem WHERE appointmentId IN (${APPTS})`],
  ['TransactionLine', `DELETE FROM TransactionLine WHERE appointmentId IN (${APPTS}) OR transactionId IN (SELECT id FROM "Transaction" WHERE customerId IN (${MARKED_CUST}))`],
  ['Transaction',   `DELETE FROM "Transaction" WHERE customerId IN (${MARKED_CUST})`],
  ['LoyaltyEntry',  `DELETE FROM LoyaltyEntry WHERE customerId IN (${MARKED_CUST})`],
  ['WalletEntry',   `DELETE FROM WalletEntry WHERE customerId IN (${MARKED_CUST})`],
  ['Appointment',   `DELETE FROM Appointment WHERE catId IN (${MARKED_CAT}) OR customerId IN (${MARKED_CUST}) OR roomId IN (${MARKED_ROOM})`],
  ['CatAssessment', `DELETE FROM CatAssessment WHERE catId IN (${MARKED_CAT})`],
  ['CatStock',      `DELETE FROM CatStock WHERE catId IN (${MARKED_CAT})`],
  ['Litter',        `DELETE FROM Litter WHERE id IN (SELECT litterId FROM CatStock WHERE catId IN (${MARKED_CAT}))`],
  ['Membership',    `DELETE FROM Membership WHERE customerId IN (${MARKED_CUST})`],
  ['ReviewRequest', `DELETE FROM ReviewRequest WHERE customerId IN (${MARKED_CUST})`],
  ['Referral',      `DELETE FROM Referral WHERE referrerId IN (${MARKED_CUST}) OR referredId IN (${MARKED_CUST})`],
  ['WhatsAppLead',  `DELETE FROM WhatsAppLead WHERE customerId IN (${MARKED_CUST})`],
  ['GroupSend',     `DELETE FROM GroupSend WHERE customerId IN (${MARKED_CUST})`],
  ['Cat',           `DELETE FROM Cat WHERE name LIKE 'VERIFY%'`],
  ['Customer',      `DELETE FROM Customer WHERE name LIKE 'VERIFY%' OR phone LIKE '%VERIFY%'`],
  ['Room',          `DELETE FROM Room WHERE name LIKE 'VERIFY%'`],
  ['Staff',         `DELETE FROM Staff WHERE name LIKE 'VERIFY%'`],
  ['StaffRoleDef',  `DELETE FROM StaffRoleDef WHERE key LIKE 'VERIFY%'`],
  ['Service',       `DELETE FROM Service WHERE name LIKE 'VERIFY%'`],
  ['Product',       `DELETE FROM Product WHERE name LIKE 'VERIFY%'`],
]

// Settings are not marked, they are OVERWRITTEN — verify-branding stores the
// prior value in memory and puts it back in its `finally`, so a killed run
// leaves the test value live on the demo site. That is not a stray row nobody
// sees: it left the demo showing "VERIFYBRAND Co" as the business name, a
// near-black accent colour and a logo URL pointing at a file that does not
// exist. Named here so the next person does not have to work that out twice.
const BRANDING_TEST_VALUES = [
  ['business.name', 'VERIFYBRAND Co'],
  ['brand.primary', '#0a0b0c'],
  ['brand.logoUrl', '/verify-logo.png'],
]
for (const [label, sql] of steps) {
  const res = await q(sql)
  console.log(res.skipped ? `  · skip ${label} (${res.skipped})` : `  ✓ ${label}: ${res.affected_row_count ?? 0} row(s)`)
}

// Delete only rows still holding the test value; a real setting is never touched.
for (const [key, testValue] of BRANDING_TEST_VALUES) {
  const res = await q(`DELETE FROM Setting WHERE key = '${key}' AND value = '${testValue.replace(/'/g, "''")}'`)
  const n = res.affected_row_count ?? 0
  if (n > 0) console.log(`  ! ${key} was still set to the test value; cleared (falls back to the default)`)
}
console.log('\nIf branding was cleared, run: node scripts/restore-demo-identity.mjs')
