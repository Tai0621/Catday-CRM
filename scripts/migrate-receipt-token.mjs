import 'dotenv/config'

// Round 7 — digital receipt: a public token + send-tracking on Transaction.
const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
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

await safe(`ALTER TABLE "Transaction" ADD COLUMN "publicToken" TEXT`, 'Transaction.publicToken')
await safe(`ALTER TABLE "Transaction" ADD COLUMN "receiptSentAt" DATETIME`, 'Transaction.receiptSentAt')
await safe(`ALTER TABLE "Transaction" ADD COLUMN "receiptChannel" TEXT`, 'Transaction.receiptChannel')
// SQLite treats NULLs as distinct, so a UNIQUE index co-exists with many null tokens.
await safe(`CREATE UNIQUE INDEX "Transaction_publicToken_key" ON "Transaction" ("publicToken")`, 'idx Transaction.publicToken')

console.log('done')
