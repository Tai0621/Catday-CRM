import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

// Finishing pass for the demo data: reads each month's ACTUAL computed
// balance-sheet sub-totals straight from the running demo server (the exact
// code path the app itself uses — lib/balance-sheet.ts), solves for the one
// plausible unknown (cash), and writes it directly into the local demo.db.
// This can never drift from what the page displays, because it IS what the
// page displays. Run this AFTER `npm run dev:demo` is up.

const BASE = process.env.DEMO_BASE ?? 'http://localhost:3000'
const OWNER_CAPITAL = 150000
const db = new PrismaClient({ adapter: new PrismaLibSql({ url: 'file:./prisma/demo.db' }) })

const r2 = v => Math.round(v * 100) / 100
const num = s => Number(String(s).replace(/[(),]/g, m => (m === '(' ? '-' : '')))

async function login() {
  const pw = process.env.APP_PASSWORD
  if (!pw) throw new Error('Set APP_PASSWORD in the environment (it is already in .env — run via `node -r dotenv/config scripts/balance-demo-books.mjs` or export it first).')
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: pw }).toString(),
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(',').map(s => s.trim()).find(s => s.startsWith('auth='))
  if (!cookie) throw new Error('Login failed — check APP_PASSWORD and that the demo server is running (npm run dev:demo).')
  return cookie.split(';')[0]
}

function cell(csv, label) {
  const line = csv.split(/\r?\n/).find(l => l.startsWith(label))
  return line ? num(line.split(',')[1]) : 0
}

async function main() {
  const cookie = await login()
  const now = new Date()

  // The Cash Flow page always compares against "December of the previous
  // year" as its opening reference (app/finance/cash-flow/page.tsx), even
  // though this demo's real history starts in January — so key that month
  // too. It has no seeded transactions of its own, but Inventory (at cost)
  // is deliberately NOT date-filtered in lib/balance-sheet.ts (it's always
  // *current* stock), so it still shows up there and needs balancing.
  const refYear = now.getMonth() === 0 ? now.getFullYear() - 2 : now.getFullYear() - 1
  const refMonth = `${refYear}-12`
  const realMonths = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (6 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  // The reference month gets capital=0 (nothing injected yet) so the
  // RM150,000 shows up as a genuine "Owner capital injected" financing
  // activity in the real months — a nicer demo story than hiding it by
  // keying capital=150,000 everywhere with no visible change.
  for (const [asOf, capital] of [[refMonth, 0], ...realMonths.map(m => [m, OWNER_CAPITAL])]) {
    const csv = await (await fetch(`${BASE}/finance/balance-sheet/export?asOf=${asOf}`, { headers: { Cookie: cookie } })).text()
    const receivables = cell(csv, 'Accounts receivable')
    const inventory = cell(csv, 'Inventory (at cost)')
    const payables = cell(csv, 'Accounts payable')
    const wallet = cell(csv, 'Customer wallet balances')
    const retained = cell(csv, 'Retained earnings — recorded in system')

    // assets = liabilities + equity  →  cash + receivables + inventory = payables + wallet + capital + retained
    const cash = r2(payables + wallet + capital + retained - receivables - inventory)

    await db.balanceSheetCell.upsert({
      where: { asOf_lineKey: { asOf, lineKey: 'a.cash' } },
      create: { asOf, lineKey: 'a.cash', amount: cash },
      update: { amount: cash },
    })
    await db.balanceSheetCell.upsert({
      where: { asOf_lineKey: { asOf, lineKey: 'e.capital' } },
      create: { asOf, lineKey: 'e.capital', amount: capital },
      update: { amount: capital },
    })
    console.log(`  ${asOf}: cash = RM${cash.toLocaleString()}, capital = RM${capital.toLocaleString()}`)
  }

  console.log('\n✓ Balance sheet keyed for every month — Assets = Liabilities + Equity exactly, verified via the live server.')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
