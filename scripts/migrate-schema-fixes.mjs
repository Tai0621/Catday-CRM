import 'dotenv/config'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL not set')

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
    throw new Error(msg)
  }
  console.log(`  ✓ ${label}`)
}

console.log('Schema gap-fixes migration…')

// New columns
await safe(`ALTER TABLE "TransactionLine" ADD COLUMN "appointmentId" TEXT`, 'TransactionLine.appointmentId')
await safe(`ALTER TABLE "Product" ADD COLUMN "costPrice" REAL NOT NULL DEFAULT 0`, 'Product.costPrice')

// Hot-path indexes
const idx = [
  ['TransactionLine_transactionId_idx', 'TransactionLine', 'transactionId'],
  ['TransactionLine_appointmentId_idx', 'TransactionLine', 'appointmentId'],
  ['Appointment_customerId_idx', 'Appointment', 'customerId'],
  ['Appointment_catId_idx', 'Appointment', 'catId'],
  ['Appointment_status_idx', 'Appointment', 'status'],
  ['Appointment_scheduledAt_idx', 'Appointment', 'scheduledAt'],
  ['Transaction_customerId_idx', 'Transaction', 'customerId'],
  ['Transaction_date_idx', 'Transaction', 'date'],
  ['Transaction_reference_idx', 'Transaction', 'reference'],
  ['Expense_date_idx', 'Expense', 'date'],
  ['Expense_paid_idx', 'Expense', 'paid'],
  ['Membership_customerId_idx', 'Membership', 'customerId'],
  ['Membership_status_idx', 'Membership', 'status'],
]
for (const [name, table, col] of idx) {
  await safe(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}"("${col}")`, `idx ${table}.${col}`)
}

console.log('done')
