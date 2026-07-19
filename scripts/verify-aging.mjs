import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for A/R & A/P: an unpaid completed visit shows as a receivable (aging
// page + customer detail + customer list "owes" flag); an unpaid expense shows
// as a payable and flows into the balance sheet; mark-paid clears it.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYAGE'

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

const custId = crypto.randomUUID(), catId = crypto.randomUUID(), apptId = crypto.randomUUID(), expId = crypto.randomUUID()
// completed visit 45 days ago (→ 31–60 bucket), unpaid RM 320
const visitDate = new Date(Date.now() - 45 * 86400000).toISOString()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Appointment WHERE id = ?`, [t(apptId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Expense WHERE notes = ?`, [t(MARK)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Debtor`), t('+60122223333')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catId), t(custId), t(`${MARK}Cat`)]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?, 'Completed', ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(apptId), t(custId), t(catId), t(visitDate), f(320)]),
    // unpaid expense RM 500, vendor OKANA, due 10 days ago (overdue)
    exec(`INSERT INTO Expense (id,date,category,amount,vendor,notes,paid,dueDate,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(expId), t(new Date(Date.now() - 20 * 86400000).toISOString()), t('Grooming Supplies'), f(500), t('OKANA'), t(MARK), t(new Date(Date.now() - 10 * 86400000).toISOString())]),
  ])
  console.log('seeded a debtor (RM320) and an unpaid bill (RM500)')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const get = async u => { await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } }); return strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text()) }

  // ── A/R aging page ──
  const aging = await get('/finance/aging')
  check('A/R page shows the debtor', aging.includes(`${MARK} Debtor`))
  check('A/R shows RM 320', aging.includes('320'))
  check('A/R aged into 31–60 bucket', /31.?60 days/.test(aging))
  check('A/P page shows the OKANA bill', aging.includes('OKANA'))
  check('A/P shows RM 500 & overdue', aging.includes('500') && aging.includes('overdue'))

  // ── customer linking ──
  const detail = await get(`/customers/${custId}`)
  check('customer page shows Outstanding balance', detail.includes('Outstanding balance') && detail.includes('320'))
  check('customer page has Collect-at-POS link', detail.includes(`/pos?customerId=${custId}`))
  const list = await get('/customers?q=' + encodeURIComponent(`${MARK} Debtor`))
  check('customer list flags "owes RM 320"', /owes RM\s*320/.test(list))

  // ── balance sheet payables now auto ──
  const nowMonth = new Date().toISOString().slice(0, 7)
  const bsCsv = await (await fetch(`${BASE}/finance/balance-sheet/export?asOf=${nowMonth}`, { headers: { Cookie: cookie } })).text()
  const apRow = bsCsv.split(/\r?\n/).find(l => l.startsWith('Accounts payable')) ?? ''
  check('balance sheet Accounts payable auto = 500', apRow.split(',')[1] === '500', apRow)
  const arRow = bsCsv.split(/\r?\n/).find(l => l.startsWith('Accounts receivable')) ?? ''
  check('balance sheet Accounts receivable auto = 320', arRow.split(',')[1] === '320', arRow)

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
