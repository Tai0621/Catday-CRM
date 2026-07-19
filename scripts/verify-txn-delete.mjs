import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for deleting wrongly-recorded transactions: removes the row + its lines,
// sweeps up split-payment siblings sharing a reference, but never touches
// unrelated null-reference rows.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYDEL'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const nul = { type: 'null' }
const mark = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const count = async where => Number((await pipe([exec(`SELECT COUNT(*) FROM "Transaction" WHERE ${where}`)]))[0].response.result.rows[0][0].value)
const lineCount = async ids => Number((await pipe([exec(`SELECT COUNT(*) FROM TransactionLine WHERE transactionId IN (${ids.map(i => `'${i}'`).join(',')})`)]))[0].response.result.rows[0][0].value)

const REF = `${MARK}-CD1`
const idPrimary = crypto.randomUUID(), idWallet = crypto.randomUUID()
const idSolo = crypto.randomUUID(), idOtherNull = crypto.randomUUID()
const lineId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM TransactionLine WHERE id = ?`, [t(lineId)]),
    exec(`DELETE FROM "Transaction" WHERE notes = ?`, [t(MARK)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

try {
  await cleanup()

  // Split POS sale: primary (RM80 card) + wallet portion (RM20) sharing REF, primary has a line.
  // Plus a solo manual entry (null ref) and another unrelated null-ref row.
  await pipe([
    exec(`INSERT INTO "Transaction" (id,date,total,category,method,reference,notes,createdAt)
          VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(idPrimary), t(new Date().toISOString()), f(80), t('Grooming'), t('Card'), t(REF), t(MARK)]),
    exec(`INSERT INTO "Transaction" (id,date,total,category,method,reference,notes,createdAt)
          VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(idWallet), t(new Date().toISOString()), f(20), t('Grooming'), t('Wallet'), t(REF), t(MARK)]),
    exec(`INSERT INTO "Transaction" (id,date,total,category,method,reference,notes,createdAt)
          VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(idSolo), t(new Date().toISOString()), f(45), t('Retail'), t('Cash'), nul, t(MARK)]),
    exec(`INSERT INTO "Transaction" (id,date,total,category,method,reference,notes,createdAt)
          VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`, [t(idOtherNull), t(new Date().toISOString()), f(99), t('Other'), t('Cash'), nul, t(MARK)]),
    exec(`INSERT INTO TransactionLine (id,transactionId,description,quantity,unitPrice,subtotal)
          VALUES (?,?,?,1,?,?)`, [t(lineId), t(idPrimary), t('Full Groom'), f(80), f(80)]),
  ])
  console.log('seeded 4 transactions + 1 line')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── find the deleteTransaction action id (scan all referenced chunks) ──
  const pageUrl = `${BASE}/revenue`
  const pageHtml = await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()
  const srcs = [...new Set([...pageHtml.matchAll(/\/_next\/static\/chunks\/[^"'\\\s>]+\.js/g)].map(m => m[0].replace(/&amp;/g, '&')))]
  let actionId = null
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src}`)).text()
    if (!js.includes('deleteTransaction')) continue
    const v = (js.match(/"deleteTransaction",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/) ?? [])[1]
    if (!v) continue
    actionId = (js.match(new RegExp(`const ${v.replace(/\$/g, '\\$')}[\\s\\S]{0,2000}?"([0-9a-f]{40,})"`)) ?? [])[1] ?? null
    if (actionId) break
  }
  check('found deleteTransaction action id', !!actionId)

  const call = async (id) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(pageUrl, {
        method: 'POST',
        headers: { Cookie: cookie, 'Next-Action': actionId, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify([id]),
      })
      const text = await r.text()
      if (r.status !== 404 || attempt >= 6) return { status: r.status, text }
      await new Promise(res => setTimeout(res, 900))
    }
  }

  // ── delete the primary of the split sale ──
  const res = await call(idPrimary)
  check('delete accepted', res.text.includes('"ok":true') || /removed/.test(res.text))

  check('both split rows removed (primary + wallet)', (await count(`reference = '${REF}'`)) === 0)
  check('its line item removed', (await lineCount([idPrimary, idWallet])) === 0)
  check('solo null-ref row untouched', (await count(`id = '${idSolo}'`)) === 1)
  check('unrelated null-ref row untouched', (await count(`id = '${idOtherNull}'`)) === 1)

  // ── delete a solo null-reference row: only that one goes ──
  await call(idSolo)
  check('solo delete removed only itself', (await count(`id = '${idSolo}'`)) === 0 && (await count(`id = '${idOtherNull}'`)) === 1)

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
