import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for removing built-in rows: hiding excludes the row (and its OS figures)
// from the statement + CSV, restore brings them back, tax can't be removed.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYHIDE'
const YEAR = 2025

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(v) })
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
    exec(`DELETE FROM StatementHiddenRow WHERE year = ?`, [i(YEAR)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok) => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}`) }

try {
  await cleanup()

  // Two OS revenue figures: Grooming 1000 + Academy 500 (Feb 2025)
  const txn = (cat, amt) => exec(
    `INSERT INTO "Transaction" (id,customerId,date,total,category,method,notes,createdAt)
     VALUES (?,NULL,?,?,?,'Cash',?,CURRENT_TIMESTAMP)`,
    [t(crypto.randomUUID()), t(new Date(YEAR, 1, 15, 12).toISOString()), f(amt), t(cat), t(MARK)])
  await pipe([txn('Grooming', 1000), txn('Academy', 500)])
  console.log('seeded')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── live action ids ──
  const pageUrl = `${BASE}/finance/income-statement?year=${YEAR}`
  const pageHtml = await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()
  const srcs = [...new Set([...pageHtml.matchAll(/\/_next\/static\/chunks\/[^"'\\\s>]+\.js/g)].map(m => m[0].replace(/&amp;/g, '&')))]
  const ids = {}
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src}`)).text()
    if (!js.includes('hideStatementRow')) continue
    const nameToVar = {}
    for (const m of js.matchAll(/"(hideStatementRow|unhideStatementRow)",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/g)) nameToVar[m[1]] = m[2]
    const varToHex = {}
    for (const m of js.matchAll(/const (\$\$RSC_SERVER_ACTION_\d+)[\s\S]{0,2000}?"([0-9a-f]{40,})"/g)) varToHex[m[1]] ??= m[2]
    for (const [name, v] of Object.entries(nameToVar)) if (varToHex[v]) ids[name] = varToHex[v]
    if (ids.hideStatementRow && ids.unhideStatementRow) break
  }
  check('found hide/unhide action ids', !!(ids.hideStatementRow && ids.unhideStatementRow))

  const call = async (name, payload) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(pageUrl, {
        method: 'POST',
        headers: { Cookie: cookie, 'Next-Action': ids[name], 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify([JSON.stringify(payload)]),
      })
      const text = await r.text()
      if (r.status !== 404 || attempt >= 6) return { status: r.status, text }
      await new Promise(res => setTimeout(res, 900))
    }
  }
  const csvOf = async () => (await (await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { headers: { Cookie: cookie } })).text())
  const cells = (c, label) => (c.split(/\r?\n/).find(l => l.startsWith(label)) ?? '').split(',')

  let csv = await csvOf()
  check('baseline: Academy row present, total 1500', csv.includes('Academy Revenue') && cells(csv, 'Total Revenue')[13] === '1500.00')

  // ── remove the built-in Academy row ──
  const hid = await call('hideStatementRow', { year: YEAR, rowKey: 'rev:Academy' })
  check('hide accepted', hid.text.includes('"ok":true'))
  csv = await csvOf()
  check('csv: Academy row gone', !csv.includes('Academy Revenue'))
  check('csv: totals exclude its RM500 (revenue 1000)', cells(csv, 'Total Revenue')[13] === '1000.00')

  const page = (await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()).replace(/<!--[\s\S]*?-->/g, '')
  check('page: Academy row gone, listed as restorable', !page.includes('>Academy Revenue<') && page.includes('rev:Academy'))

  // ── restore ──
  const back = await call('unhideStatementRow', { year: YEAR, rowKey: 'rev:Academy' })
  check('restore accepted', back.text.includes('"ok":true'))
  csv = await csvOf()
  check('csv: Academy back, total 1500 again', csv.includes('Academy Revenue') && cells(csv, 'Total Revenue')[13] === '1500.00')

  // ── guard: tax can't be removed ──
  const bad = await call('hideStatementRow', { year: YEAR, rowKey: 'tax' })
  check('tax row protected', bad.text.includes('cannot be removed'))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
