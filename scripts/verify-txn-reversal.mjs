import 'dotenv/config'
import crypto from 'node:crypto'

// E2E: deleting a POS transaction must unwind its side effects —
// loyalty points (+ pointsBalance), wallet payment (+ walletBalance refund),
// and product stock — not just remove the revenue row.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const REF = 'CD-REVTEST1'
const MARK = 'VERIFYREV'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const int = v => ({ type: 'integer', value: String(v) })
const mark = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json(); const e = j.results?.find(x => x?.type === 'error'); if (e) throw new Error(e.error?.message); return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const scalar = async (sql) => (await pipe([exec(sql)]))[0].response.result.rows[0]?.[0]?.value
const count = async where => Number(await scalar(`SELECT COUNT(*) FROM ${where}`))

const custId = crypto.randomUUID(), prodId = crypto.randomUUID()
const txnId = crypto.randomUUID(), lineId = crypto.randomUUID(), loyId = crypto.randomUUID(), walId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM TransactionLine WHERE id = ?`, [t(lineId)]),
    exec(`DELETE FROM "Transaction" WHERE reference = ?`, [t(REF)]),
    exec(`DELETE FROM LoyaltyEntry WHERE note = ?`, [t(REF)]),
    exec(`DELETE FROM WalletEntry WHERE note = ?`, [t(`POS ${REF}`)]),
    // Reversal restocks, and StockMovement.productId is a NOT NULL FK, so the
    // movement rows must go before the Product. Without this the cleanup threw
    // after all 12 checks had passed, stranding a "VERIFYREV …" product whose
    // random id no later run could target — and the next run then failed
    // outright on the unique name. Sweep by MARK so an interrupted run heals.
    exec(`DELETE FROM StockMovement WHERE productId = ?`, [t(prodId)]),
    exec(`DELETE FROM StockMovement WHERE productId IN (SELECT id FROM Product WHERE name LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM Product WHERE id = ?`, [t(prodId)]),
    exec(`DELETE FROM Product WHERE name LIKE ?`, [t(`${MARK}%`)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Customer WHERE name LIKE ?`, [t(`${MARK}%`)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

try {
  await cleanup()
  // customer: 500 pts, RM30 wallet · product: 8 in stock (2 sold) · sale ref CD-REVTEST1
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,30,500,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60123330000')]),
    exec(`INSERT INTO Product (id,name,price,stockQty,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?,?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(prodId), t(`${MARK} Shampoo`), f(25), int(8)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,method,reference,notes,createdAt)
          VALUES (?,?,CURRENT_TIMESTAMP,?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(txnId), t(custId), f(50), t('Retail'), t('Cash'), t(REF), t('POS · Owner')]),
    exec(`INSERT INTO TransactionLine (id,transactionId,productId,description,quantity,unitPrice,subtotal)
          VALUES (?,?,?,?,?,?,?)`, [t(lineId), t(txnId), t(prodId), t('Shampoo'), int(2), f(25), f(50)]),
    exec(`INSERT INTO LoyaltyEntry (id,customerId,points,reason,note,createdAt)
          VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(loyId), t(custId), int(120), t('Purchase'), t(REF)]),
    exec(`INSERT INTO WalletEntry (id,customerId,amount,kind,note,createdAt)
          VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(walId), t(custId), f(-30), t('Spend'), t(`POS ${REF}`)]),
  ])
  console.log('seeded a POS sale: 120 pts, RM30 wallet, 2 units')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // find the deleteTransaction action id
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
    res = await r.text()
    if (r.status !== 404 || i >= 6) break
    await new Promise(x => setTimeout(x, 900))
  }
  check('delete accepted', res.includes('"ok":true'))
  check('result reports 120 pts reversed', /"pointsReversed":120/.test(res))
  check('result reports RM30 wallet refunded', /"walletRefunded":30/.test(res))
  check('result reports 2 restocked', /"restocked":2/.test(res))

  // ── verify the actual state ──
  check('transaction removed', (await count(`"Transaction" WHERE reference = '${REF}'`)) === 0)
  check('transaction line removed', (await count(`TransactionLine WHERE id = '${lineId}'`)) === 0)
  check('loyalty entry removed', (await count(`LoyaltyEntry WHERE note = '${REF}'`)) === 0)
  check('wallet entry removed', (await count(`WalletEntry WHERE note = 'POS ${REF}'`)) === 0)
  check('pointsBalance 500 → 380', Number(await scalar(`SELECT pointsBalance FROM Customer WHERE id='${custId}'`)) === 380)
  check('walletBalance 30 → 60 (refunded)', Number(await scalar(`SELECT walletBalance FROM Customer WHERE id='${custId}'`)) === 60)
  check('product stock 8 → 10 (restocked)', Number(await scalar(`SELECT stockQty FROM Product WHERE id='${prodId}'`)) === 10)

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
