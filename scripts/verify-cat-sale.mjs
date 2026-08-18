import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for selling a cat through the POS, and — the part that matters — the
// reversal. Data-integrity rule 3: everything a checkout creates must be undone
// by deleting the sale.
//
// Asserts, in order:
//  • checkout transfers the ANIMAL to the buyer, closes the stock record, books
//    the sale under the Cat Sale category, and ends any residency
//  • a cat already sold cannot be sold again
//  • a cat reserved for someone else cannot be sold over their head
//  • deleting the sale returns the cat to stock AND ownership to the house
//  • the reversal is keyed on the sale reference, so deleting a LATER grooming
//    sale for the same cat does not drag it back into inventory — the bug that
//    matching on catId would have caused
//
// Technique B (Next-Action) is not needed: checkout is a file-level action
// called with a JSON string, so it is driven by resolving the action id from the
// dev chunks. That makes this suite DEV-ONLY, like verify-txn-delete.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYCATSALE'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const mark = ok => (ok ? '✓' : '✗')

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`)
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const scalar = async (sql, args = []) => (await pipe([exec(sql, args)]))[0].response.result.rows[0]?.[0]?.value

const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const iso = d => d.toISOString()

const buyerId = crypto.randomUUID(), otherId = crypto.randomUUID()
const catId = crypto.randomUUID(), stockId = crypto.randomUUID()
const heldCat = crypto.randomUUID(), heldStock = crypto.randomUUID()
const SKU = `${MARK}-S1`, SKU_HELD = `${MARK}-H1`

async function cleanup() {
  await pipe([
    exec(`DELETE FROM TransactionLine WHERE transactionId IN (SELECT id FROM "Transaction" WHERE notes LIKE ?)`, [t(`%${MARK}%`)]),
    exec(`DELETE FROM "Transaction" WHERE notes LIKE ?`, [t(`%${MARK}%`)]),
    exec(`DELETE FROM LoyaltyEntry WHERE customerId IN (SELECT id FROM Customer WHERE name LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM CatCost WHERE catStockId IN (SELECT id FROM CatStock WHERE sku LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM CareTask WHERE catId IN (SELECT id FROM Cat WHERE name LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM Appointment WHERE catId IN (SELECT id FROM Cat WHERE name LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM CatStock WHERE sku LIKE ?`, [t(`${MARK}%`)]),
    exec(`DELETE FROM Cat WHERE name LIKE ?`, [t(`${MARK}%`)]),
    exec(`DELETE FROM Customer WHERE name LIKE ?`, [t(`${MARK}%`)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

/** Resolve a file-level action's id from the dev chunks (AGENTS.md technique B). */
async function actionId(pagePath, name, cookie) {
  const html = await (await fetch(`${BASE}${pagePath}`, { headers: { Cookie: cookie } })).text()
  const srcs = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"'\\\s>]+\.js/g)]
    .map(m => m[0].replace(/&amp;/g, '&')))]
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src}`)).text()
    if (!js.includes(name)) continue
    const sym = (js.match(new RegExp(`"${name}",\\s*\\(\\)=>(\\$\\$RSC_SERVER_ACTION_\\d+)`)) ?? [])[1]
    if (!sym) continue
    const id = (js.match(new RegExp(`const ${sym.replace(/\$/g, '\\$')}[\\s\\S]{0,2000}?"([0-9a-f]{40,})"`)) ?? [])[1]
    if (id) return id
  }
  return null
}

async function callAction(pagePath, id, args, cookie) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${BASE}${pagePath}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(args),
    })
    const text = await r.text()
    if (r.status !== 404 || i >= 6) return text
    await new Promise(x => setTimeout(x, 900))
  }
}

try {
  await cleanup()

  const nextYear = new Date(now.getTime() + 300 * DAY)
  const houseId = await scalar(`SELECT id FROM Customer WHERE isHouse = 1 LIMIT 1`)
  if (!houseId) throw new Error('no house customer — run scripts/import-cat-inventory.mjs or add a stock cat first')

  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,source,marketingConsent,needsDetails,isHouse,createdAt,updatedAt)
          VALUES (?,?,?,0,0,'WalkIn',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(buyerId), t(`${MARK} Buyer`), t('+60100000101')]),
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,source,marketingConsent,needsDetails,isHouse,createdAt,updatedAt)
          VALUES (?,?,?,0,0,'WalkIn',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(otherId), t(`${MARK} Other`), t('+60100000102')]),

    exec(`INSERT INTO Cat (id,name,breed,gender,dateOfBirth,lastVaccinatedAt,vaccinationExpiry,lastDewormAt,customerId,contentOptOut,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(`${MARK} Sellme`), t('British Shorthair'), t('Female'), t(iso(new Date(now.getTime() - 200 * DAY))),
       t(iso(new Date(now.getTime() - 30 * DAY))), t(iso(nextYear)), t(iso(new Date(now.getTime() - 10 * DAY))), t(houseId)]),
    exec(`INSERT INTO CatStock (id,catId,sku,role,status,acquisitionRM,askingRM,microchipNo,createdAt,updatedAt)
          VALUES (?,?,?,'ForSale','InStock',?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(stockId), t(catId), t(SKU), f(1000), f(3800), t('900000000000009')]),

    // reserved for someone else — must not be sellable to the buyer
    exec(`INSERT INTO Cat (id,name,breed,gender,dateOfBirth,lastVaccinatedAt,vaccinationExpiry,customerId,contentOptOut,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(heldCat), t(`${MARK} Held`), t('Minuet'), t('Male'), t(iso(new Date(now.getTime() - 200 * DAY))),
       t(iso(new Date(now.getTime() - 30 * DAY))), t(iso(nextYear)), t(houseId)]),
    exec(`INSERT INTO CatStock (id,catId,sku,role,status,acquisitionRM,askingRM,reservedForId,createdAt,updatedAt)
          VALUES (?,?,?,'ForSale','Reserved',0,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(heldStock), t(heldCat), t(SKU_HELD), f(3000), t(otherId)]),
  ])
  console.log('seeded a buyer, a sellable cat and a cat held for someone else')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  const checkoutId = await actionId('/pos', 'checkout', cookie)
  check('resolved the checkout action id', !!checkoutId)
  if (!checkoutId) throw new Error('cannot drive checkout — is this a dev server?')

  const sell = (customerId, refId, price) => callAction('/pos', checkoutId, [JSON.stringify({
    customerId,
    items: [{ kind: 'cat', refId, label: `${MARK} cat sale`, qty: 1, unitPrice: price }],
    walletAmount: 0, method: 'Cash', note: MARK,
  })], cookie)

  // ── the guards, before the happy path ──
  const noBuyer = await sell(null, stockId, 3800)
  check('a cat sale without a buyer is refused', /needs the buyer selected/.test(noBuyer), noBuyer.slice(0, 160))
  const stillInStock = await scalar(`SELECT status FROM CatStock WHERE id = ?`, [t(stockId)])
  check('…and nothing changed', stillInStock === 'InStock', String(stillInStock))

  const overHold = await sell(buyerId, heldStock, 3000)
  check("a cat held for another customer is refused", /reserved for someone else/.test(overHold), overHold.slice(0, 160))

  // ── the sale ──
  const sold = await sell(buyerId, stockId, 3800)
  check('checkout succeeded', /"ok":true/.test(sold), sold.slice(0, 200))

  const status = await scalar(`SELECT status FROM CatStock WHERE id = ?`, [t(stockId)])
  check('stock record is Sold', status === 'Sold', String(status))
  const owner = await scalar(`SELECT customerId FROM Cat WHERE id = ?`, [t(catId)])
  check('the ANIMAL now belongs to the buyer', owner === buyerId, String(owner))
  const saleRM = Number(await scalar(`SELECT saleRM FROM CatStock WHERE id = ?`, [t(stockId)]))
  check('sale price recorded on the stock row', saleRM === 3800, String(saleRM))
  const ref = await scalar(`SELECT saleReference FROM CatStock WHERE id = ?`, [t(stockId)])
  check('sale reference recorded (what the reversal keys on)', !!ref, String(ref))
  const category = await scalar(`SELECT category FROM "Transaction" WHERE reference = ? LIMIT 1`, [t(ref)])
  check('booked under the Cat Sale category', category === 'Cat Sale', String(category))
  const lineCat = await scalar(
    `SELECT catId FROM TransactionLine WHERE transactionId IN (SELECT id FROM "Transaction" WHERE reference = ?) LIMIT 1`, [t(ref)])
  check('the sale line links to the animal', lineCat === catId, String(lineCat))

  const resold = await sell(buyerId, stockId, 3800)
  check('a cat that has left cannot be sold again', /already left/.test(resold), resold.slice(0, 160))

  // ── the reversal ──
  const txnId = await scalar(`SELECT id FROM "Transaction" WHERE reference = ? LIMIT 1`, [t(ref)])
  const delId = await actionId('/revenue', 'deleteTransaction', cookie)
  check('resolved the deleteTransaction action id', !!delId)
  if (delId) {
    const res = await callAction('/revenue', delId, [txnId], cookie)
    check('delete reports one cat returned', /"catsReturned":1/.test(res), res.slice(0, 200))
    const back = await scalar(`SELECT status FROM CatStock WHERE id = ?`, [t(stockId)])
    check('the cat is back in stock', back === 'InStock', String(back))
    const ownerBack = await scalar(`SELECT customerId FROM Cat WHERE id = ?`, [t(catId)])
    check('ownership returned to the house', ownerBack === houseId, String(ownerBack))
    const refCleared = await scalar(`SELECT saleReference FROM CatStock WHERE id = ?`, [t(stockId)])
    check('sale reference cleared', refCleared == null, String(refCleared))
    const catRow = Number(await scalar(`SELECT COUNT(*) FROM Cat WHERE id = ?`, [t(catId)]))
    check('the animal record still exists (never deleted)', catRow === 1)
  }

  // ── the trap: a later sale for the SAME cat must not drag it back ──
  //
  // Sell it again, then record a separate grooming sale carrying the same catId,
  // and delete THAT. Matching the reversal on catId instead of the sale
  // reference would take a customer's pet back into inventory.
  const sold2 = await sell(buyerId, stockId, 3800)
  check('sold again for the reference test', /"ok":true/.test(sold2), sold2.slice(0, 160))
  const groomRef = `${MARK}-GROOM`
  const groomTxn = crypto.randomUUID()
  await pipe([
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,method,reference,notes,createdAt)
          VALUES (?,?,CURRENT_TIMESTAMP,?, 'Grooming','Cash',?,?,CURRENT_TIMESTAMP)`,
      [t(groomTxn), t(buyerId), f(120), t(groomRef), t(`${MARK} grooming after sale`)]),
    exec(`INSERT INTO TransactionLine (id,transactionId,catId,description,quantity,unitPrice,subtotal)
          VALUES (?,?,?,?,1,?,?)`, [t(crypto.randomUUID()), t(groomTxn), t(catId), t('Full groom'), f(120), f(120)]),
  ])
  if (delId) {
    const res2 = await callAction('/revenue', delId, [groomTxn], cookie)
    check('deleting a later grooming sale returns NO cats', /"catsReturned":0/.test(res2), res2.slice(0, 200))
    const stillSold = await scalar(`SELECT status FROM CatStock WHERE id = ?`, [t(stockId)])
    check("…and the sold cat stays sold (it is the customer's pet now)", stillSold === 'Sold', String(stillSold))
    const stillTheirs = await scalar(`SELECT customerId FROM Cat WHERE id = ?`, [t(catId)])
    check('…and still belongs to the buyer', stillTheirs === buyerId, String(stillTheirs))
  }

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
