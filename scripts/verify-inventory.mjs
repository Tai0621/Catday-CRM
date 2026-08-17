import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 9 — inventory. Seeds a low-stock product with a movement history
// and a healthy one, then asserts the products list (valuation + low flag), the
// product detail (movement ledger + low banner), and the low-stock Action Inbox
// card + access control. (Sale/reversal ledger writes + manual stock actions are
// server-action-bound → build-typechecked.) Cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYINV'

const t = v => ({ type: 'text', value: String(v) })
const i = v => ({ type: 'integer', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DBTOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

function craft(session) {
  const n = Date.now()
  const payload = { ...session, iat: n, exp: n + 3600_000, ep: EPOCH }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(`v3:${b64}`).digest('hex')
  return `v3.${b64}.${sig}`
}

const pLow = crypto.randomUUID(), pOk = crypto.randomUUID()
async function cleanup() {
  await pipe([
    exec(`DELETE FROM StockMovement WHERE productId IN (?,?)`, [t(pLow), t(pOk)]),
    exec(`DELETE FROM Product WHERE id IN (?,?)`, [t(pLow), t(pOk)]),
  ])
}
const product = (id, name, stock, reorder, cost) => exec(
  `INSERT INTO Product (id,name,price,costPrice,stockQty,reorderLevel,active,sortOrder,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  [t(id), t(name), f(30), f(cost), i(stock), i(reorder)])
const move = (pid, delta, reason, ref, note) => exec(
  `INSERT INTO StockMovement (id,productId,delta,reason,reference,note,createdAt) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
  [t(crypto.randomUUID()), t(pid), i(delta), t(reason), ref ? t(ref) : { type: 'null' }, note ? t(note) : { type: 'null' }])

try {
  await cleanup()
  await pipe([
    product(pLow, `${MARK} Cat Litter`, 2, 5, 10),   // 2 <= 5 → low
    product(pOk, `${MARK} Shampoo`, 20, 5, 8),        // healthy
    move(pLow, 10, 'InitialStock', null, 'Opening stock'),
    move(pLow, -8, 'Sale', 'CD-VERIFYX', null),
  ])
  console.log('seeded a low-stock product (+ history) and a healthy one')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const getHtml = async (u, cookie) => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Products list ──
  const list = await getHtml('/products', mgr)
  check('list shows valuation tiles', list.includes('Units in stock') && list.includes('Stock at cost') && list.includes('Low stock'))
  check('low product flagged in the list', list.includes(`${MARK} Cat Litter`) && list.includes('low'))
  check('product links to its detail page', list.includes(`/products/${pLow}`))

  // ── Product detail ──
  const detail = await getHtml(`/products/${pLow}`, mgr)
  check('detail shows the low-stock banner', detail.includes('Low stock') && detail.includes('Time to reorder'))
  check('movement ledger shows opening + sale', detail.includes('Opening stock') && detail.includes('Sale'))
  check('ledger shows the deltas', detail.includes('+10') && detail.includes('-8'))

  // ── Action Inbox ──
  const inbox = await getHtml('/actions', mgr)
  check('low stock raises a Reorder card', inbox.includes(`Reorder — ${MARK} Cat Litter`))

  // ── Access control ──
  const unauth = await fetch(`${BASE}/products`, { redirect: 'manual' })
  check('products unauth → /login', unauth.status === 307 && (unauth.headers.get('location') ?? '').includes('/login'))
  const staffTok = craft({ kind: 'staff', staffId: 'x', name: `${MARK} Groomer`, role: 'Groomer' })
  const staffRes = await fetch(`${BASE}/products`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  check('products blocks non-manager staff', staffRes.status === 307 && !(staffRes.headers.get('location') ?? '').includes('/products'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
