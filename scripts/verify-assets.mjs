import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for the Fixed Asset Register feeding the three statements. Seeds the same
// self-consistent 2025 book as verify-three-statement, PLUS a RM2,400 asset
// (24-mo life, bought 2025-07, funded by owner capital), then asserts:
//  • Asset Register page shows the asset with correct monthly dep & NBV
//  • Income statement gains an auto Depreciation row (RM100/mo, RM600 in 2025)
//  • Balance sheet fixed-assets line auto = net book value RM1,800, still balances
//  • Cash flow: depreciation add-back in operating, purchase in investing,
//    and it STILL ties to the balance sheet (tie = 0)
//  • A year with no depreciation shows no Depreciation row (non-breaking)
// All figures reconcile by the accounting identity. Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYASSET'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
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
const assetId = crypto.randomUUID()
const D2025 = '2025-01-15T12:00:00.000Z'
const ASSET_BUY = '2025-07-10T00:00:00.000Z'

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "Transaction" WHERE notes = ?`, [t(MARK)]),
    exec(`DELETE FROM Expense WHERE notes = ?`, [t(MARK)]),
    exec(`DELETE FROM WalletEntry WHERE note = ?`, [t(MARK)]),
    exec(`DELETE FROM Appointment WHERE id = ?`, [t(apptId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM FixedAsset WHERE id = ?`, [t(assetId)]),
    exec(`DELETE FROM BalanceSheetCell WHERE asOf = '2025-12'`),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()

  // Balancing 2025 book WITH the asset (funded by capital so cash is unaffected):
  //   revenue 1000, rent 1200, depreciation 600 → net income −800
  //   receivables 500, wallet +300, fixed assets NBV 1800
  //   keyed: cash 600, capital 3400
  //   Assets 2900 (600+500+1800) = L 300 + E 2600 (3400−800) ✓
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,300,0,?,?)`, [t(custId), t(`${MARK} Cust`), t('+60100000019'), t(D2025), t(D2025)]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`, [t(catId), t(custId), t(`${MARK}Cat`), t(D2025), t(D2025)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,category,method,notes,createdAt)
          VALUES (?,NULL,?,?,'Grooming','Cash',?,?)`, [t(txnId), t(D2025), f(1000), t(MARK), t(D2025)]),
    exec(`INSERT INTO Expense (id,date,category,amount,notes,createdAt,updatedAt)
          VALUES (?,?,'Rent',?,?,?,?)`, [t(expId), t(D2025), f(1200), t(MARK), t(D2025), t(D2025)]),
    exec(`INSERT INTO WalletEntry (id,customerId,amount,kind,note,createdAt)
          VALUES (?,?,?,'TopUp',?,?)`, [t(weId), t(custId), f(300), t(MARK), t(D2025)]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?, 'Completed', ?, 0, 0, ?, ?)`, [t(apptId), t(custId), t(catId), t(D2025), f(500), t(D2025), t(D2025)]),
    exec(`INSERT INTO FixedAsset (id,name,category,cost,salvageValue,purchaseDate,usefulLifeMonths,notes,createdAt,updatedAt)
          VALUES (?,?,?,?,0,?,?,?,?,?)`, [t(assetId), t(`${MARK} Grooming Table`), t('Equipment'), f(2400), t(ASSET_BUY), i(24), t(MARK), t(D2025), t(D2025)]),
    exec(`INSERT INTO BalanceSheetCell (id,asOf,lineKey,amount,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`, [t(crypto.randomUUID()), t('2025-12'), t('a.cash'), f(600)]),
    exec(`INSERT INTO BalanceSheetCell (id,asOf,lineKey,amount,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`, [t(crypto.randomUUID()), t('2025-12'), t('e.capital'), f(3400)]),
  ])
  console.log('seeded a balancing 2025 book with a RM2,400 asset')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  const csvOf = async url => (await (await fetch(`${BASE}${url}`, { headers: { Cookie: cookie } })).text())
  const getHtml = async url => strip(await (await fetch(`${BASE}${url}`, { headers: { Cookie: cookie } })).text())
  const cell = (csv, label) => { const l = csv.split(/\r?\n/).find(x => x.startsWith(label)); return l ? l.split(',').slice(1).join(',') : null }
  const rowCols = (csv, label) => { const l = csv.split(/\r?\n/).find(x => x.startsWith(label)); return l ? l.split(',').slice(1) : null }
  const numOf = s => s == null ? null : Number(String(s).replace(/[(),]/g, m => m === '(' ? '-' : ''))

  // ── Asset Register page ──
  // Date-independent checks (register NBV is "as of now"; the exact NBV math is
  // proven by the 2025-12 balance-sheet assertion below).
  const reg = await getHtml('/admin/assets')
  check('register lists the asset', reg.includes(`${MARK} Grooming Table`))
  check('register shows asset cost RM 2,400', reg.includes('2,400'))
  check('register shows monthly depreciation RM 100', /RM\s*100\b/.test(reg))

  // ── Income Statement 2025 (auto Depreciation row) ──
  const is2025 = await csvOf('/finance/income-statement/export?year=2025')
  const dep = rowCols(is2025, 'Depreciation & Amortization')
  check('income statement has a Depreciation row', dep != null)
  check('depreciation year total = 600', dep && Number(dep[12]) === 600, dep ? dep[12] : 'no row')
  check('depreciation July charge = 100', dep && Number(dep[6]) === 100, dep ? `Jul=${dep[6]}` : 'no row') // col 0=Jan … 6=Jul
  check('depreciation is zero before purchase (June)', dep && Number(dep[5]) === 0, dep ? `Jun=${dep[5]}` : 'no row')
  const ni2025 = rowCols(is2025, 'Net Income')
  check('net income year total = −800', ni2025 && Number(ni2025[12]) === -800, ni2025 ? ni2025[12] : 'no row')

  // ── Income Statement 2024 (no depreciation → no row; non-breaking) ──
  const is2024 = await csvOf('/finance/income-statement/export?year=2024')
  check('a year with no depreciation shows no Depreciation row', !is2024.includes('Depreciation & Amortization'))

  // ── Balance Sheet 2025-12 ──
  const bs = await csvOf('/finance/balance-sheet/export?asOf=2025-12')
  check('fixed assets auto = net book value 1,800', numOf(cell(bs, 'Fixed assets (net of depreciation)')) === 1800, cell(bs, 'Fixed assets (net of depreciation)'))
  check('retained earnings (system) = −800', numOf(cell(bs, 'Retained earnings — recorded in system')) === -800, cell(bs, 'Retained earnings — recorded in system'))
  check('total assets = 2900', numOf(cell(bs, 'TOTAL ASSETS')) === 2900, cell(bs, 'TOTAL ASSETS'))
  check('total equity = 2600', numOf(cell(bs, 'TOTAL EQUITY')) === 2600, cell(bs, 'TOTAL EQUITY'))
  check('balance sheet BALANCES (check = 0)', numOf(cell(bs, 'Balance check (Assets − L − E)')) === 0, cell(bs, 'Balance check (Assets − L − E)'))

  // ── Cash Flow (YTD 2025) ──
  const cf = await csvOf('/finance/cash-flow/export?to=2025-12')
  check('cash flow depreciation add-back = 600', numOf(cell(cf, 'Depreciation (non-cash)')) === 600, cell(cf, 'Depreciation (non-cash)'))
  check('cash flow investing purchase = −2400', numOf(cell(cf, 'Purchase/(disposal) of fixed assets')) === -2400, cell(cf, 'Purchase/(disposal) of fixed assets'))
  check('cash flow net income = −800', numOf(cell(cf, 'Net income for the period')) === -800, cell(cf, 'Net income for the period'))
  check('cash flow net change in cash = 600', numOf(cell(cf, 'Net change in cash')) === 600, cell(cf, 'Net change in cash'))
  check('cash flow STILL TIES to balance sheet (tie = 0)', numOf(cell(cf, 'Tie check')) === 0, cell(cf, 'Tie check'))

  // ── auth guard ──
  const anon = await fetch(`${BASE}/admin/assets`, { redirect: 'manual' })
  check('asset register requires sign-in', [302, 307].includes(anon.status) && (anon.headers.get('location') ?? '').includes('/login'), String(anon.status))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data (asset + book removed)')
}
