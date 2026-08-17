import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for the income statement: seeds a clean test year (2025) with known
// figures, then asserts the page and the CSV export compute the Excel's
// structure exactly: revenue → COGS → gross profit → opex → EBITDA → 24% tax
// on profitable months → net income → cumulative.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYFIN'
const YEAR = 2025 // clean past year — real data lives in 2026

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

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "Transaction" WHERE notes = ?`, [t(MARK)]),
    exec(`DELETE FROM Expense WHERE notes = ?`, [t(MARK)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok) => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}`) }

try {
  await cleanup()

  // Feb 2025: rev 1500 (Grooming 1000 + Boarding 500), COGS 200, opex 300
  //   → GP 1300, EBITDA 1000, tax 240, net 760
  // Mar 2025: rev 2000 (Grooming), COGS 500, opex 800
  //   → GP 1500, EBITDA 700, tax 168, net 532 · cumulative 1292
  const txn = (month, cat, amt) => exec(
    `INSERT INTO "Transaction" (id,customerId,date,total,category,method,notes,createdAt)
     VALUES (?,NULL,?,?,?,'Cash',?,CURRENT_TIMESTAMP)`,
    [t(crypto.randomUUID()), t(new Date(YEAR, month, 15, 12).toISOString()), f(amt), t(cat), t(MARK)])
  const expn = (month, cat, amt) => exec(
    `INSERT INTO Expense (id,date,category,amount,notes,createdAt,updatedAt)
     VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(crypto.randomUUID()), t(new Date(YEAR, month, 15, 12).toISOString()), t(cat), f(amt), t(MARK)])

  await pipe([
    txn(1, 'Grooming', 1000), txn(1, 'Boarding', 500),
    expn(1, 'Grooming Supplies', 200), expn(1, 'Rent', 300),
    txn(2, 'Grooming', 2000),
    expn(2, 'Food & Litter', 500), expn(2, 'Salaries', 800),
  ])
  console.log('seeded 2025 test figures')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── page ──
  await fetch(`${BASE}/finance/income-statement?year=${YEAR}`, { headers: { Cookie: cookie } })
  const page = (await (await fetch(`${BASE}/finance/income-statement?year=${YEAR}`, { headers: { Cookie: cookie } })).text())
    .replace(/<!--[\s\S]*?-->/g, '')
  check('statement page renders', page.includes('Income Statement'))
  check('revenue headline RM 3,500', page.includes('3,500'))
  check('gross profit 2,800', page.includes('2,800'))
  check('EBITDA 1,700', page.includes('1,700'))
  check('net income 1,292', page.includes('1,292'))
  check('year switcher shows 2025', page.includes(`?year=${YEAR}`) || page.includes('>2025<'))

  // ── export CSV ──
  const csvRes = await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { headers: { Cookie: cookie } })
  const csv = await csvRes.text()
  check('export downloads as CSV', csvRes.status === 200 && (csvRes.headers.get('content-type') ?? '').includes('csv'))
  check('csv: filename header', (csvRes.headers.get('content-disposition') ?? '').includes(`CATDAY-Income-Statement-${YEAR}.csv`))
  const rowOf = label => csv.split(/\r?\n/).find(l => l.startsWith(label)) ?? ''
  const cells = label => rowOf(label).split(',')
  check('csv: total revenue Feb 1500 / Mar 2000 / year 3500',
    cells('Total Revenue')[2] === '1500.00' && cells('Total Revenue')[3] === '2000.00' && cells('Total Revenue')[13] === '3500.00')
  check('csv: gross profit year 2800', cells('Gross Profit')[13] === '2800.00')
  check('csv: EBITDA Feb 1000 / Mar 700', cells('EBITDA (Operating Income)')[2] === '1000.00' && cells('EBITDA (Operating Income)')[3] === '700.00')
  check('csv: tax 24% on profitable months (240 / 168)', cells('Tax Provision @ 24%')[2] === '240.00' && cells('Tax Provision @ 24%')[3] === '168.00')
  check('csv: net income year 1292', cells('Net Income')[13] === '1292.00')
  check('csv: cumulative Feb 760 → Mar 1292', cells('Cumulative Net Income')[2] === '760.00' && cells('Cumulative Net Income')[3] === '1292.00')

  // ── auth guard: proxy bounces anonymous hits to /login (or the route 401s) ──
  const anon = await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { redirect: 'manual' })
  const bounced = anon.status === 401 || ([302, 307].includes(anon.status) && (anon.headers.get('location') ?? '').includes('/login'))
  check('export requires sign-in', bounced)

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
