import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for accountant overrides: OS figures render black and update live;
// hard-keyed cells save via the server action, render blue (#1D4ED8), flow
// into totals and the CSV export, and clearing reverts to the OS figure.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYOVR'
const YEAR = 2025

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
    exec(`DELETE FROM StatementCell WHERE year = ?`, [{ type: 'integer', value: String(YEAR) }]),
  ])
}

let pass = 0, total = 0
const check = (label, ok) => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()

  // OS figure: Grooming RM1000 in Feb 2025 (black, live)
  await pipe([exec(
    `INSERT INTO "Transaction" (id,customerId,date,total,category,method,notes,createdAt)
     VALUES (?,NULL,?,?,'Grooming','Cash',?,CURRENT_TIMESTAMP)`,
    [t(crypto.randomUUID()), t(new Date(YEAR, 1, 15, 12).toISOString()), f(1000), t(MARK)])])
  console.log('seeded OS grooming figure')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── live dev action id: scan every chunk the page references (script tags
  // AND escaped flight strings — client-component chunks hide in the latter),
  // then map export name → $$RSC_SERVER_ACTION_n → createServerReference hex.
  // (.next manifests can't be trusted here: `next build` overwrites them with
  // production ids salted differently from the running dev server.)
  const pageUrl = `${BASE}/finance/income-statement?year=${YEAR}`
  const pageHtml = await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()
  const srcs = [...new Set([...pageHtml.matchAll(/\/_next\/static\/chunks\/[^"'\\\s>]+\.js/g)].map(m => m[0].replace(/&amp;/g, '&')))]
  let actionId = null
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src}`)).text()
    // The action is saveStatementCellS — it was pluralised when single-cell
    // saves became an Excel-style batch. The old singular name still passed the
    // substring guard above ("saveStatementCells".includes("saveStatementCell")),
    // so this script kept scanning every chunk, matched nothing, and reported
    // 2/11 as though the feature were broken. verify-statement-rows.mjs was
    // updated at the rename; this one was missed.
    if (!js.includes('saveStatementCells')) continue
    const nameToVar = {}
    for (const m of js.matchAll(/"saveStatementCells",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/g)) nameToVar.saveStatementCells = m[1]
    const varToHex = {}
    for (const m of js.matchAll(/const (\$\$RSC_SERVER_ACTION_\d+)[\s\S]{0,2000}?"([0-9a-f]{40,})"/g)) varToHex[m[1]] ??= m[2]
    if (nameToVar.saveStatementCells && varToHex[nameToVar.saveStatementCells]) {
      actionId = varToHex[nameToVar.saveStatementCells]
      break
    }
  }
  check('found saveStatementCells action id', !!actionId)

  // Dev registers file-level actions lazily — retry while it 404s
  const call = async payload => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(pageUrl, {
        method: 'POST',
        headers: { Cookie: cookie, 'Next-Action': actionId, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify([JSON.stringify(payload)]),
      })
      const text = await r.text()
      if (r.status !== 404 || attempt >= 6) return { status: r.status, text }
      await new Promise(res => setTimeout(res, 900))
    }
  }

  // ── hard-key Boarding Feb = 2000 (blue) ──
  const save = await call({ year: YEAR, cells: [{ month: 1, rowKey: 'rev:Boarding', amount: 2000 }] })
  check('save accepted', save.status === 200 && save.text.includes('"ok":true'))

  let page = strip(await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text())
  check('blue cell rendered (#1D4ED8)', page.includes('#1D4ED8') || /color:\s*rgb\(29,\s*78,\s*216\)/.test(page))
  check('total revenue Feb = 3,000 (1000 OS + 2000 keyed)', page.includes('3,000'))

  const csv = await (await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { headers: { Cookie: cookie } })).text()
  const cells = label => (csv.split(/\r?\n/).find(l => l.startsWith(label)) ?? '').split(',')
  check('csv uses keyed figure (Total Revenue Feb 3000)', cells('Total Revenue')[2] === '3000.00')
  check('csv Boarding row Feb 2000', cells('Boarding Revenue')[2] === '2000.00')

  // ── tax override: key RM50 over the auto provision ──
  const saveTax = await call({ year: YEAR, cells: [{ month: 1, rowKey: 'tax', amount: 50 }] })
  check('tax override accepted', saveTax.text.includes('"ok":true'))
  const csv2 = await (await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { headers: { Cookie: cookie } })).text()
  const cells2 = label => (csv2.split(/\r?\n/).find(l => l.startsWith(label)) ?? '').split(',')
  check('csv tax Feb = 50, net = EBITDA − 50',
    cells2('Tax Provision @ 24%')[2] === '50.00' &&
    Math.abs(parseFloat(cells2('Net Income')[2]) - (parseFloat(cells2('EBITDA (Operating Income)')[2]) - 50)) < 0.01)

  // ── clear the Boarding override → reverts to OS (0 for Boarding, total 1000) ──
  const clear = await call({ year: YEAR, cells: [{ month: 1, rowKey: 'rev:Boarding', amount: null }] })
  check('clear accepted', clear.text.includes('"ok":true'))
  const csv3 = await (await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { headers: { Cookie: cookie } })).text()
  const cells3 = label => (csv3.split(/\r?\n/).find(l => l.startsWith(label)) ?? '').split(',')
  check('reverted: Boarding Feb 0, Total Revenue Feb 1000',
    cells3('Boarding Revenue')[2] === '0.00' && cells3('Total Revenue')[2] === '1000.00')

  // ── guardrail: unknown row rejected ──
  const bad = await call({ year: YEAR, cells: [{ month: 1, rowKey: 'rev:Nonsense', amount: 10 }] })
  check('unknown row key rejected', bad.text.includes('Unknown statement row'))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
