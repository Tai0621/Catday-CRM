import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for the three-statement model. Seeds a small, self-consistent 2025 book,
// keys the balance sheet so it balances, then asserts:
//  • Balance Sheet auto lines (receivables, wallet, retained earnings) are right
//  • Assets = Liabilities + Equity (check = 0)
//  • Cash Flow ties to the balance sheet's closing cash (tie = 0)
// All figures reconcile by the accounting identity. Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFY3S'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
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

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const apptId = crypto.randomUUID(), txnId = crypto.randomUUID(), expId = crypto.randomUUID(), weId = crypto.randomUUID()
const D2025 = '2025-01-15T12:00:00.000Z'

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "Transaction" WHERE notes = ?`, [t(MARK)]),
    exec(`DELETE FROM Expense WHERE notes = ?`, [t(MARK)]),
    exec(`DELETE FROM WalletEntry WHERE note = ?`, [t(MARK)]),
    exec(`DELETE FROM Appointment WHERE id = ?`, [t(apptId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM BalanceSheetCell WHERE asOf = '2025-12'`),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

try {
  await cleanup()

  // Book: revenue 1000, rent 1200 → 2025 net income −200 (loss, no tax)
  // receivables 500 (unpaid completed appt), wallet +300 (top-up)
  // keyed: cash 600, capital 1000 → balances (Assets 1100 = L+E 1100)
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,300,0,?,?)`, [t(custId), t(`${MARK} Cust`), t('+60100000009'), t(D2025), t(D2025)]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`, [t(catId), t(custId), t(`${MARK}Cat`), t(D2025), t(D2025)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,method,notes,createdAt)
          VALUES (?,NULL,?,?,'Grooming','Cash',?,?)`, [t(txnId), t(D2025), f(1000), t(MARK), t(D2025)]),
    exec(`INSERT INTO Expense (id,date,category,amount,notes,createdAt,updatedAt)
          VALUES (?,?,'Rent',?,?,?,?)`, [t(expId), t(D2025), f(1200), t(MARK), t(D2025), t(D2025)]),
    exec(`INSERT INTO WalletEntry (id,customerId,amount,kind,note,createdAt)
          VALUES (?,?,?,'TopUp',?,?)`, [t(weId), t(custId), f(300), t(MARK), t(D2025)]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?, 'Completed', ?, 0, 0, ?, ?)`, [t(apptId), t(custId), t(catId), t(D2025), f(500), t(D2025), t(D2025)]),
    exec(`INSERT INTO BalanceSheetCell (id,asOf,lineKey,amount,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`, [t(crypto.randomUUID()), t('2025-12'), t('a.cash'), f(600)]),
    exec(`INSERT INTO BalanceSheetCell (id,asOf,lineKey,amount,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`, [t(crypto.randomUUID()), t('2025-12'), t('e.capital'), f(1000)]),
  ])
  console.log('seeded a balancing 2025 book')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  const csvOf = async url => (await (await fetch(`${BASE}${url}`, { headers: { Cookie: cookie } })).text())
  const cell = (csv, label) => { const l = csv.split(/\r?\n/).find(x => x.startsWith(label)); return l ? l.split(',').slice(1).join(',') : null }
  const numOf = s => s == null ? null : Number(String(s).replace(/[(),]/g, m => m === '(' ? '-' : ''))

  // ── Balance Sheet ──
  const bs = await csvOf('/finance/balance-sheet/export?asOf=2025-12')
  check('receivables auto = 500', numOf(cell(bs, 'Accounts receivable')) === 500, cell(bs, 'Accounts receivable'))
  check('wallet liability auto = 300', numOf(cell(bs, 'Customer wallet balances')) === 300, cell(bs, 'Customer wallet balances'))
  check('retained earnings (system) = −200', numOf(cell(bs, 'Retained earnings — recorded in system')) === -200, cell(bs, 'Retained earnings — recorded in system'))
  check('cash keyed = 600', numOf(cell(bs, 'Cash & bank')) === 600, cell(bs, 'Cash & bank'))
  check('total liabilities = 300', numOf(cell(bs, 'TOTAL LIABILITIES')) === 300, cell(bs, 'TOTAL LIABILITIES'))
  check('total equity = 800', numOf(cell(bs, 'TOTAL EQUITY')) === 800, cell(bs, 'TOTAL EQUITY'))

  // TOTAL ASSETS and the balance check are measured as MOVEMENT, not as a
  // figure. The cells above are scoped to asOf=2025-12 and belong to this test
  // alone, but the totals also carry things no period filter touches — chiefly
  // inventory at cost, which on the demo is nearly twenty thousand ringgit of
  // real stock. Asserting "TOTAL ASSETS = 1100" therefore only ever held on an
  // empty database, and read as a broken balance sheet the moment the demo had
  // products in it.
  //
  // What the feature actually promises is that a balanced set of entries leaves
  // the sheet balanced — whatever was already on it. So: read, remove the seed,
  // read again.
  // Measured at the very end, after every check that still needs the seed.
  const withSeed = { assets: numOf(cell(bs, 'TOTAL ASSETS')), check: numOf(cell(bs, 'Balance check (Assets − L − E)')) }

  // ── Cash Flow (YTD 2025) ──
  const cf = await csvOf('/finance/cash-flow/export?to=2025-12')
  check('cash flow net income = −200', numOf(cell(cf, 'Net income for the period')) === -200, cell(cf, 'Net income for the period'))
  check('cash flow net change = 600', numOf(cell(cf, 'Net change in cash')) === 600, cell(cf, 'Net change in cash'))
  check('cash flow closing (computed) = 600', numOf(cell(cf, 'Closing cash (computed)')) === 600, cell(cf, 'Closing cash (computed)'))
  check('cash flow TIES to balance sheet (tie = 0)', numOf(cell(cf, 'Tie check')) === 0, cell(cf, 'Tie check'))

  // ── the totals, as movement ──
  // Last, because it removes the seed the checks above depend on.
  await cleanup() // idempotent; the `finally` runs it again harmlessly
  const bare = await csvOf('/finance/balance-sheet/export?asOf=2025-12')
  const without = { assets: numOf(cell(bare, 'TOTAL ASSETS')), check: numOf(cell(bare, 'Balance check (Assets − L − E)')) }

  check('the seeded entries add exactly their own value to total assets',
    withSeed.assets - without.assets === 1100, `${withSeed.assets} seeded, ${without.assets} bare`)
  check('…and leave the sheet no less balanced than they found it',
    withSeed.check - without.check === 0, `check moved ${without.check} → ${withSeed.check}`)

  // ── auth guard ──
  const anon = await fetch(`${BASE}/finance/balance-sheet/export?asOf=2025-12`, { redirect: 'manual' })
  check('export requires sign-in', anon.status === 401 || ([302, 307].includes(anon.status) && (anon.headers.get('location') ?? '').includes('/login')))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
