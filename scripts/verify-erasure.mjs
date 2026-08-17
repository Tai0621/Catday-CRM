import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// Track A / A3 — erasure. Covers both steps:
//   1. anonymise (POST /api/customers/[id]/erase): identifying data + cat health
//      notes + media redacted/deleted, WhatsApp blanked, but financial rows kept;
//      audit-logged; non-managers blocked.
//   2. purge (/api/cron/retention): an anonymised customer whose newest record is
//      older than the retention window is hard-deleted; a recently-erased one is
//      retained.
// Seeds 4 customers, drives real HTTP, asserts, cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYERA'

const t = v => ({ type: 'text', value: String(v) })
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

const A = crypto.randomUUID(), catA = crypto.randomUUID(), txA = crypto.randomUUID(), lineA = crypto.randomUUID()
const msgA = crypto.randomUUID(), leadA = crypto.randomUUID(), mediaA = crypto.randomUUID()
const B = crypto.randomUUID()
const C = crypto.randomUUID(), txC = crypto.randomUUID()
const D = crypto.randomUUID(), txD = crypto.randomUUID()
const allCust = [A, B, C, D]

async function cleanup() {
  await pipe([
    exec(`DELETE FROM AuditLog WHERE entityType='Customer' AND (entityId IN (?,?,?,?) OR entityId LIKE ?)`, [t(A), t(B), t(C), t(D), t(`%${C}%`)]),
    exec(`DELETE FROM TransactionLine WHERE id IN (?)`, [t(lineA)]),
    exec(`DELETE FROM "Transaction" WHERE id IN (?,?,?)`, [t(txA), t(txC), t(txD)]),
    exec(`DELETE FROM LoyaltyEntry WHERE customerId IN (?,?,?,?)`, [t(A), t(B), t(C), t(D)]),
    exec(`DELETE FROM WalletEntry WHERE customerId IN (?,?,?,?)`, [t(A), t(B), t(C), t(D)]),
    exec(`DELETE FROM WhatsAppLead WHERE id = ?`, [t(leadA)]),
    exec(`DELETE FROM WhatsAppMessage WHERE id = ?`, [t(msgA)]),
    exec(`DELETE FROM MediaAsset WHERE id = ?`, [t(mediaA)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catA)]),
    exec(`DELETE FROM Customer WHERE id IN (?,?,?,?)`, [t(A), t(B), t(C), t(D)]),
  ])
}

const eightYrsAgo = new Date(Date.now() - 8 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const longAgo = '2018-01-01 00:00:00'

try {
  await cleanup()
  await pipe([
    // A — erase target (active, full record)
    exec(`INSERT INTO Customer (id,phone,name,email,address,notes,source,createdAt,updatedAt) VALUES (?,?,?,?,?,?,'WalkIn',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(A), t(`+60${MARK}A`), t(`${MARK} Ana`), t(`${MARK}@x.com`), t('12 Jalan Test'), t('prefers morning')]),
    exec(`INSERT INTO Cat (id,name,healthNotes,careNotes,customerId,createdAt,updatedAt) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catA), t(`${MARK} Milo`), t('skin allergy'), t('gentle brushing'), t(A)]),
    exec(`INSERT INTO MediaAsset (id,url,pathname,kind,contentType,size,ownerType,ownerId,createdAt) VALUES (?,?,?,'image','image/jpeg',100,'cat',?,CURRENT_TIMESTAMP)`,
      [t(mediaA), t(`https://blob.example/${MARK}.jpg`), t(`cat/${catA}/x.jpg`), t(catA)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,method,createdAt) VALUES (?,?,CURRENT_TIMESTAMP,88,'Grooming','Cash',CURRENT_TIMESTAMP)`,
      [t(txA), t(A)]),
    exec(`INSERT INTO TransactionLine (id,transactionId,catId,description,quantity,unitPrice,subtotal) VALUES (?,?,?,?,1,88,88)`,
      [t(lineA), t(txA), t(catA), t('Full groom')]),
    exec(`INSERT INTO LoyaltyEntry (id,customerId,points,reason,createdAt) VALUES (?,?,80,'GroomingCompleted',CURRENT_TIMESTAMP)`, [t(crypto.randomUUID()), t(A)]),
    exec(`INSERT INTO WalletEntry (id,customerId,amount,kind,createdAt) VALUES (?,?,30,'TopUp',CURRENT_TIMESTAMP)`, [t(crypto.randomUUID()), t(A)]),
    exec(`INSERT INTO WhatsAppMessage (id,senderPhone,content,timestamp,createdAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(msgA), t(`+60${MARK}A`), t('Hi can I book Milo')]),
    exec(`INSERT INTO WhatsAppLead (id,messageId,customerId,type,status,summary,createdAt,updatedAt) VALUES (?,?,?,'BookingRequest','Pending',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(leadA), t(msgA), t(A), t(`${MARK} wants a groom`)]),
    // B — staff-denied target (active)
    exec(`INSERT INTO Customer (id,phone,name,source,createdAt,updatedAt) VALUES (?,?,?,'WalkIn',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(B), t(`+60${MARK}B`), t(`${MARK} Bella`)]),
    // C — already erased, OLD record → should be purged
    exec(`INSERT INTO Customer (id,phone,name,source,erasedAt,createdAt,updatedAt) VALUES (?,?,'Erased customer','Erased',?,?,?)`,
      [t(C), t(`ERASED-${C}`), t(longAgo), t(longAgo), t(longAgo)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,createdAt) VALUES (?,?,?,50,'Grooming',?)`,
      [t(txC), t(C), t(eightYrsAgo), t(eightYrsAgo)]),
    // D — already erased, RECENT record → should be retained
    exec(`INSERT INTO Customer (id,phone,name,source,erasedAt,createdAt,updatedAt) VALUES (?,?,'Erased customer','Erased',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(D), t(`ERASED-${D}`), t(longAgo)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,createdAt) VALUES (?,?,CURRENT_TIMESTAMP,60,'Grooming',CURRENT_TIMESTAMP)`,
      [t(txD), t(D)]),
  ])
  console.log('seeded A (erase target), B (staff-denied), C (old→purge), D (recent→retain)')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]

  // ── Step 1: anonymise A ──
  const eraseRes = await fetch(`${BASE}/api/customers/${A}/erase`, { method: 'POST', headers: { Cookie: mgr }, redirect: 'manual' })
  check('erase redirects back (303)', eraseRes.status === 303, `got ${eraseRes.status}`)

  const custA = rowsOf((await pipe([exec(`SELECT name,email,address,notes,phone,erasedAt FROM Customer WHERE id=?`, [t(A)])]))[0])[0]
  check('A name redacted', custA?.[0] === 'Erased customer', custA?.[0])
  check('A email + address + notes cleared', custA?.[1] === null && custA?.[2] === null && custA?.[3] === null)
  check('A phone tokenised', String(custA?.[4]).startsWith('ERASED-'), custA?.[4])
  check('A erasedAt set', !!custA?.[5])

  const catRow = rowsOf((await pipe([exec(`SELECT healthNotes,careNotes FROM Cat WHERE id=?`, [t(catA)])]))[0])[0]
  check('A cat health/care notes cleared', catRow?.[0] === null && catRow?.[1] === null)
  const mediaCount = rowsOf((await pipe([exec(`SELECT COUNT(*) FROM MediaAsset WHERE id=?`, [t(mediaA)])]))[0])[0][0]
  check('A cat media deleted', Number(mediaCount) === 0)

  const txCount = rowsOf((await pipe([exec(`SELECT COUNT(*), SUM(total) FROM "Transaction" WHERE id=?`, [t(txA)])]))[0])[0]
  check('A financial record retained (books intact)', Number(txCount[0]) === 1 && Number(txCount[1]) === 88)

  const waMsg = rowsOf((await pipe([exec(`SELECT content,senderPhone FROM WhatsAppMessage WHERE id=?`, [t(msgA)])]))[0])[0]
  check('A WhatsApp content blanked', waMsg?.[0] === '[erased]' && waMsg?.[1] === 'ERASED')

  const auditA = rowsOf((await pipe([exec(`SELECT summary FROM AuditLog WHERE entityId=? AND action='customer.erase'`, [t(A)])]))[0])
  check('erase is audit-logged', auditA.length >= 1 && /Erased customer/.test(auditA[0]?.[0] ?? ''))

  // ── Access control: non-manager staff cannot erase B ──
  const staffTok = craft({ kind: 'staff', staffId: 'x', name: `${MARK} FD`, role: 'FrontDesk' })
  const staffErase = await fetch(`${BASE}/api/customers/${B}/erase`, { method: 'POST', headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  const bName = rowsOf((await pipe([exec(`SELECT name,erasedAt FROM Customer WHERE id=?`, [t(B)])]))[0])[0]
  check('staff blocked from erasing', staffErase.status !== 303 && bName?.[0] === `${MARK} Bella` && bName?.[1] === null, `status ${staffErase.status}`)

  // ── Step 2: retention purge ──
  const purge = await fetch(`${BASE}/api/cron/retention`, { method: 'POST', headers: { Cookie: mgr } })
  const purgeJson = await purge.json()
  check('purge runs (200)', purge.status === 200 && purgeJson.ok, JSON.stringify(purgeJson))
  const cGone = rowsOf((await pipe([exec(`SELECT COUNT(*) FROM Customer WHERE id=?`, [t(C)])]))[0])[0][0]
  const cTxGone = rowsOf((await pipe([exec(`SELECT COUNT(*) FROM "Transaction" WHERE id=?`, [t(txC)])]))[0])[0][0]
  check('old erased customer C purged (customer + txn gone)', Number(cGone) === 0 && Number(cTxGone) === 0)
  const dHere = rowsOf((await pipe([exec(`SELECT COUNT(*) FROM Customer WHERE id=?`, [t(D)])]))[0])[0][0]
  check('recently-erased customer D retained', Number(dHere) === 1)
  check('purge reported C in its result', Array.isArray(purgeJson.ids) && purgeJson.ids.includes(C))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
