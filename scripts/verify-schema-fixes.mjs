import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for the schema gap-fixes:
//  1) TransactionLine.appointmentId — deleting a POS sale re-opens the
//     appointment it settled (paid → false).
//  2) Product.costPrice — inventory shows at cost on the balance sheet.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const REF = 'CD-SFTEST1', MARK = 'VERIFYSF'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const int = v => ({ type: 'integer', value: String(v) })
const mark = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }) })
  const j = await r.json(); const e = j.results?.find(x => x?.type === 'error'); if (e) throw new Error(e.error?.message); return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const scalar = async sql => (await pipe([exec(sql)]))[0].response.result.rows[0]?.[0]?.value

const custId = crypto.randomUUID(), catId = crypto.randomUUID(), apptId = crypto.randomUUID()
const prodId = crypto.randomUUID(), txnId = crypto.randomUUID(), lineA = crypto.randomUUID(), lineP = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM TransactionLine WHERE transactionId = ?`, [t(txnId)]),
    exec(`DELETE FROM "Transaction" WHERE reference = ?`, [t(REF)]),
    exec(`DELETE FROM Appointment WHERE id = ?`, [t(apptId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Product WHERE id = ?`, [t(prodId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

try {
  await cleanup()
  // completed+paid grooming (settled by the sale), a product with cost 12 × 5 in stock = 60 at cost
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt) VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60123339999')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catId), t(custId), t(`${MARK}Cat`)]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt) VALUES (?,?,?,'Grooming',CURRENT_TIMESTAMP,'Completed',?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(apptId), t(custId), t(catId), f(120)]),
    exec(`INSERT INTO Product (id,name,price,costPrice,stockQty,active,sortOrder,createdAt,updatedAt) VALUES (?,?,?,?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(prodId), t(`${MARK} Treats`), f(30), f(12), int(5)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,method,reference,notes,createdAt) VALUES (?,?,CURRENT_TIMESTAMP,?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(txnId), t(custId), f(120), t('Grooming'), t('Cash'), t(REF), t('POS · Owner')]),
    exec(`INSERT INTO TransactionLine (id,transactionId,appointmentId,description,quantity,unitPrice,subtotal) VALUES (?,?,?,?,1,?,?)`, [t(lineA), t(txnId), t(apptId), t('Full Groom'), f(120), f(120)]),
    exec(`INSERT INTO TransactionLine (id,transactionId,productId,description,quantity,unitPrice,subtotal) VALUES (?,?,?,?,1,?,?)`, [t(lineP), t(txnId), t(prodId), t('Treats'), f(30), f(30)]),
  ])
  console.log('seeded a paid appointment + a costed product')

  const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual' })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── inventory-at-cost on the balance sheet (5 × RM12 = RM60) ──
  const nowMonth = new Date().toISOString().slice(0, 7)
  const bs = await (await fetch(`${BASE}/finance/balance-sheet/export?asOf=${nowMonth}`, { headers: { Cookie: cookie } })).text()
  const invRow = bs.split(/\r?\n/).find(l => l.startsWith('Inventory (at cost)')) ?? ''
  check('inventory auto = 60 (5 × RM12 cost)', invRow.split(',')[1] === '60', invRow)

  // ── deleting the sale re-opens the appointment ──
  check('appointment starts paid', String(await scalar(`SELECT paid FROM Appointment WHERE id='${apptId}'`)) === '1')
  const pageHtml = await (await fetch(`${BASE}/revenue`, { headers: { Cookie: cookie } })).text()
  const srcs = [...new Set([...pageHtml.matchAll(/\/_next\/static\/chunks\/[^"'\\\s>]+\.js/g)].map(m => m[0].replace(/&amp;/g, '&')))]
  let actionId = null
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src}`)).text()
    if (!js.includes('deleteTransaction')) continue
    const v = (js.match(/"deleteTransaction",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/) ?? [])[1]
    if (v) actionId = (js.match(new RegExp(`const ${v.replace(/\$/g, '\\$')}[\\s\\S]{0,2000}?"([0-9a-f]{40,})"`)) ?? [])[1] ?? null
    if (actionId) break
  }
  check('found deleteTransaction action id', !!actionId)
  let res
  for (let i = 0; ; i++) {
    const r = await fetch(`${BASE}/revenue`, { method: 'POST', headers: { Cookie: cookie, 'Next-Action': actionId, 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify([txnId]) })
    res = await r.text(); if (r.status !== 404 || i >= 6) break; await new Promise(x => setTimeout(x, 900))
  }
  check('delete reports 1 visit re-opened', /"apptsReopened":1/.test(res))
  check('appointment now unpaid (re-opened)', String(await scalar(`SELECT paid FROM Appointment WHERE id='${apptId}'`)) === '0')
  check('appointment row still exists (not deleted)', Number(await scalar(`SELECT COUNT(*) FROM Appointment WHERE id='${apptId}'`)) === 1)
  check('product restocked 5 → 6', Number(await scalar(`SELECT stockQty FROM Product WHERE id='${prodId}'`)) === 6)

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
