import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for Round 7: WhatsApp digital receipt + public tokenized link.
// Seeds three sales and asserts:
//  • staff receipt page shows the public /r/<token> link + WhatsApp button + "not sent"
//  • the public /r/<token> page renders WITHOUT auth (no login redirect)
//  • a sale marked sent shows the "sent via WhatsApp" status
//  • a customer with no phone shows the "add a phone" hint, no WhatsApp button
//  • a pre-Round-7 sale (no token) gets a token minted lazily on the receipt page
// Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYRCPT'

const t = v => ({ type: 'text', value: String(v) })
const tn = v => (v == null ? { type: 'null' } : { type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
const mk = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const colValue = (result, col) => {
  const cols = result.response.result.cols.map(c => c.name)
  const row = result.response.result.rows[0]
  return row ? row[cols.indexOf(col)]?.value ?? null : null
}

const custId = crypto.randomUUID(), custNoPhone = crypto.randomUUID()
const paidTxn = crypto.randomUUID(), sentTxn = crypto.randomUUID(), noPhoneTxn = crypto.randomUUID(), legacyTxn = crypto.randomUUID()
const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
const sentToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
const ref = `${MARK}-A`, sentRef = `${MARK}-B`, noPhoneRef = `${MARK}-C`, legacyRef = `${MARK}-D`

async function cleanup() {
  await pipe([
    exec(`DELETE FROM TransactionLine WHERE transactionId IN (?,?,?,?)`, [t(paidTxn), t(sentTxn), t(noPhoneTxn), t(legacyTxn)]),
    exec(`DELETE FROM "Transaction" WHERE id IN (?,?,?,?)`, [t(paidTxn), t(sentTxn), t(noPhoneTxn), t(legacyTxn)]),
    exec(`DELETE FROM LoyaltyEntry WHERE customerId IN (?,?)`, [t(custId), t(custNoPhone)]),
    exec(`DELETE FROM Customer WHERE id IN (?,?)`, [t(custId), t(custNoPhone)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  const txn = (id, ref, tok, phoneCust, opts = {}) => exec(
    `INSERT INTO "Transaction" (id,customerId,date,total,category,method,reference,notes,publicToken,receiptSentAt,receiptChannel,createdAt)
     VALUES (?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [t(id), t(phoneCust), f(opts.total ?? 90), t('Grooming'), t('Cash'), t(ref), t(`${MARK} note`),
     tn(tok), tn(opts.sentAt ?? null), tn(opts.channel ?? null)],
  )
  const line = (txnId, desc, price) => exec(
    `INSERT INTO TransactionLine (id,transactionId,description,quantity,unitPrice,subtotal) VALUES (?,?,?,1,?,?)`,
    [t(crypto.randomUUID()), t(txnId), t(desc), f(price), f(price)],
  )
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60129990001')]),
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custNoPhone), t(`${MARK} NoPhone`), t('')]),
    txn(paidTxn, ref, token, custId, { total: 90 }),
    line(paidTxn, `${MARK} Full groom`, 90),
    exec(`INSERT INTO LoyaltyEntry (id,customerId,points,reason,note,createdAt) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(custId), i(90), t('Purchase'), t(ref)]),
    txn(sentTxn, sentRef, sentToken, custId, { total: 120, sentAt: '2026-07-20 09:00:00', channel: 'WhatsApp' }),
    line(sentTxn, `${MARK} Spa`, 120),
    txn(noPhoneTxn, noPhoneRef, crypto.randomUUID().replace(/-/g, ''), custNoPhone, { total: 60 }),
    line(noPhoneTxn, `${MARK} Nail trim`, 60),
    // legacy sale: no publicToken → receipt page must mint one
    txn(legacyTxn, legacyRef, null, custId, { total: 45 }),
    line(legacyTxn, `${MARK} Bath`, 45),
  ])
  console.log('seeded 4 sales (paid/sent/no-phone/legacy)')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Staff receipt page: link + WhatsApp + not-sent ──
  const rp = await getHtml(`/pos/receipt/${paidTxn}`)
  check('receipt page shows the public /r/<token> link', rp.includes(`/r/${token}`))
  check('receipt page offers WhatsApp receipt', rp.includes('WhatsApp receipt'))
  check('receipt page shows "not sent yet"', rp.includes('Not sent yet'))
  check('receipt renders line + total', rp.includes(`${MARK} Full groom`) && rp.includes('RM 90.00'))

  // ── Public receipt WITHOUT auth ──
  const pubRes = await fetch(`${BASE}/r/${token}`, { redirect: 'manual' })
  const pubBody = strip(await pubRes.text())
  check('public /r/<token> serves 200 (no login redirect)', pubRes.status === 200, `status ${pubRes.status}`)
  check('public receipt renders the sale', pubBody.includes(`${MARK} Full groom`) && pubBody.includes('RM 90.00'))
  check('public receipt has no app nav (Service Board link)', !pubBody.includes('Service Board'))

  // ── Sent status ──
  const sp = await getHtml(`/pos/receipt/${sentTxn}`)
  check('sent sale shows "sent via WhatsApp"', sp.includes('Digital receipt sent via WhatsApp'))

  // ── No-phone hint ──
  const np = await getHtml(`/pos/receipt/${noPhoneTxn}`)
  check('no-phone sale hides WhatsApp button', !np.includes('WhatsApp receipt'))
  check('no-phone sale shows add-phone hint', np.includes('Add a phone number'))

  // ── Legacy sale: token minted lazily ──
  const lp = await getHtml(`/pos/receipt/${legacyTxn}`)
  check('legacy sale receipt renders a /r/ link', /\/r\/[a-f0-9]{64}/.test(lp))
  const minted = await pipe([exec(`SELECT publicToken FROM "Transaction" WHERE id = ?`, [t(legacyTxn)])])
  check('legacy sale got a token persisted', !!colValue(minted[0], 'publicToken'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
