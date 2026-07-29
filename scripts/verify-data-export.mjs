import 'dotenv/config'
import crypto from 'node:crypto'

// Track A / A2 — customer data export (right of access / portability). Seeds a
// customer with a cat, a transaction+line, a loyalty entry and a wallet entry,
// then drives GET /api/customers/[id]/export: asserts the JSON bundle is complete
// and correct, that the disclosure is audit-logged, and that non-managers can't
// reach it. Cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYEXP'

const t = v => ({ type: 'text', value: String(v) })
const iv = v => ({ type: 'integer', value: String(v) })
const fv = v => ({ type: 'float', value: Number(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DBTOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const rowsOf = res => res.response.result.rows.map(row => row.map(c => (c.type === 'null' ? null : c.value)))

function craft(session) {
  const n = Date.now()
  const payload = { ...session, iat: n, exp: n + 3600_000, ep: EPOCH }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(`v3:${b64}`).digest('hex')
  return `v3.${b64}.${sig}`
}

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const txId = crypto.randomUUID(), lineId = crypto.randomUUID()
async function cleanup() {
  await pipe([
    exec(`DELETE FROM AuditLog WHERE entityId = ?`, [t(custId)]),
    exec(`DELETE FROM TransactionLine WHERE id = ?`, [t(lineId)]),
    exec(`DELETE FROM "Transaction" WHERE id = ?`, [t(txId)]),
    exec(`DELETE FROM LoyaltyEntry WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM WalletEntry WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,phone,name,email,source,pointsBalance,walletBalance,createdAt,updatedAt) VALUES (?,?,?,?,'WalkIn',120,50,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(custId), t(`+60${MARK}`), t(`${MARK} Alia`), t(`${MARK}@example.com`)]),
    exec(`INSERT INTO Cat (id,name,breed,customerId,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(`${MARK} Tofu`), t('Persian'), t(custId)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,method,reference,createdAt) VALUES (?,?,CURRENT_TIMESTAMP,88,'Grooming','Cash',?,CURRENT_TIMESTAMP)`,
      [t(txId), t(custId), t(`CD-${MARK}`)]),
    exec(`INSERT INTO TransactionLine (id,transactionId,catId,description,quantity,unitPrice,subtotal) VALUES (?,?,?,?,1,88,88)`,
      [t(lineId), t(txId), t(catId), t('Full groom')]),
    exec(`INSERT INTO LoyaltyEntry (id,customerId,points,reason,note,createdAt) VALUES (?,?,120,'GroomingCompleted',?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(custId), t(`${MARK} note`)]),
    exec(`INSERT INTO WalletEntry (id,customerId,amount,kind,createdAt) VALUES (?,?,50,'TopUp',CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(custId)]),
  ])
  console.log('seeded a customer with cat + transaction + loyalty + wallet')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]

  // ── Export as manager ──
  const res = await fetch(`${BASE}/api/customers/${custId}/export`, { headers: { Cookie: mgr } })
  check('export returns 200', res.status === 200, `got ${res.status}`)
  const cd = res.headers.get('content-disposition') ?? ''
  check('served as a download attachment', cd.includes('attachment') && cd.includes('.json'), cd)
  const body = await res.json()
  check('bundle carries the profile (phone + email)', body.profile?.phone === `+60${MARK}` && body.profile?.email === `${MARK}@example.com`)
  check('bundle includes the cat', body.cats?.some(c => c.name === `${MARK} Tofu`))
  check('bundle includes the transaction + line', body.transactions?.some(x => x.id === txId && x.lines?.some(l => l.description === 'Full groom')))
  check('bundle includes the loyalty ledger', body.loyaltyLedger?.some(e => e.points === 120))
  check('bundle includes the wallet ledger', body.walletLedger?.some(e => e.amount === 50))
  check('counts summarise the record', body.counts?.transactions >= 1 && body.counts?.cats >= 1 && body.counts?.loyaltyEntries >= 1)
  check('meta marks it a data-subject export', body.meta?.subject === 'customer' && !!body.meta?.exportedAt)

  // ── Audit trail ──
  const audit = await pipe([exec(`SELECT action, summary FROM AuditLog WHERE entityId = ? AND action = 'customer.export'`, [t(custId)])])
  const arows = rowsOf(audit[0])
  check('export is audit-logged', arows.length >= 1 && /Exported customer data/.test(arows[0]?.[1] ?? ''))

  // ── Access control ──
  const unauth = await fetch(`${BASE}/api/customers/${custId}/export`, { redirect: 'manual' })
  check('unauthenticated cannot export', unauth.status !== 200, `got ${unauth.status}`)
  const staffTok = craft({ kind: 'staff', staffId: 'x', name: `${MARK} FD`, role: 'FrontDesk' })
  const staffRes = await fetch(`${BASE}/api/customers/${custId}/export`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  const staffData = staffRes.status === 200 ? await staffRes.text() : ''
  check('non-manager staff cannot export', staffRes.status !== 200 && !staffData.includes(`${MARK}@example.com`), `got ${staffRes.status}`)

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
