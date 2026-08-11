import 'dotenv/config'

// Cancelling and moving a booking, recorded on the appointment itself.
//
// The audit log already captures who did what, but it stores prose — you cannot
// GROUP BY it. "Why do people cancel, and is it getting worse?" is a question
// the owner will ask of this data, so the reason lives on the row.
//
// Idempotent: re-running skips columns that already exist.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL is not set')
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function safe(sql, label) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  })
  const json = await res.json()
  const r = json.results?.[0]
  if (r?.type === 'error') {
    const msg = r.error?.message ?? ''
    if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw new Error(`${label}: ${msg}`)
  }
  console.log(`  ✓ ${label}`)
}

console.log('Appointment — cancellation and reschedule columns')
await safe(`ALTER TABLE "Appointment" ADD COLUMN "cancelledAt" DATETIME`, 'Appointment.cancelledAt')
await safe(`ALTER TABLE "Appointment" ADD COLUMN "cancelReason" TEXT`, 'Appointment.cancelReason')
await safe(`ALTER TABLE "Appointment" ADD COLUMN "cancelNote" TEXT`, 'Appointment.cancelNote')
await safe(`ALTER TABLE "Appointment" ADD COLUMN "rescheduledAt" DATETIME`, 'Appointment.rescheduledAt')
await safe(`ALTER TABLE "Appointment" ADD COLUMN "rescheduledFrom" DATETIME`, 'Appointment.rescheduledFrom')

// The agenda view reads forward from "now" across all days rather than one day
// at a time, so scheduledAt is the hot path for a range scan.
await safe(
  `CREATE INDEX IF NOT EXISTS "Appointment_status_scheduledAt_idx" ON "Appointment"("status", "scheduledAt")`,
  'Appointment(status, scheduledAt) index')

console.log('\nDone.')
