import 'dotenv/config'
import './_guard.mjs'

// E2E for Excel-style statement editing: add a custom row, batch-save cells
// (Edit → Save cycle), figures land in totals + CSV, delete the row cleanly.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const YEAR = 2025

const t = v => ({ type: 'text', value: String(v) })
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
    exec(`DELETE FROM StatementCell WHERE year = ?`, [i(YEAR)]),
    exec(`DELETE FROM StatementRowDef WHERE year = ?`, [i(YEAR)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok) => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}`) }

try {
  await cleanup()

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── live action ids: scan every chunk referenced anywhere in the HTML ──
  const pageUrl = `${BASE}/finance/income-statement?year=${YEAR}`
  const pageHtml = await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()
  const srcs = [...new Set([...pageHtml.matchAll(/\/_next\/static\/chunks\/[^"'\\\s>]+\.js/g)].map(m => m[0].replace(/&amp;/g, '&')))]
  const ids = {}
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src}`)).text()
    if (!js.includes('saveStatementCells')) continue
    const nameToVar = {}
    for (const m of js.matchAll(/"(saveStatementCells|addStatementRow|removeStatementRow)",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/g)) {
      nameToVar[m[1]] = m[2]
    }
    const varToHex = {}
    for (const m of js.matchAll(/const (\$\$RSC_SERVER_ACTION_\d+)[\s\S]{0,2000}?"([0-9a-f]{40,})"/g)) varToHex[m[1]] ??= m[2]
    for (const [name, v] of Object.entries(nameToVar)) if (varToHex[v]) ids[name] = varToHex[v]
    if (Object.keys(ids).length === 3) break
  }
  check('found all 3 action ids', !!(ids.saveStatementCells && ids.addStatementRow && ids.removeStatementRow))

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

  // ── add a custom opex row ──
  const added = await call('addStatementRow', { year: YEAR, section: 'opex', label: 'Depreciation' })
  check('add row accepted', added.text.includes('"ok":true'))
  const rowId = (added.text.match(/"id":"([a-z0-9]+)"/) ?? [])[1]
  check('row id returned', !!rowId)

  let page = (await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()).replace(/<!--[\s\S]*?-->/g, '')
  check('Depreciation row renders', page.includes('Depreciation'))

  // ── Excel-style batch save: custom row Feb=100 + Boarding override Feb=2000 ──
  const saved = await call('saveStatementCells', {
    year: YEAR,
    cells: [
      { month: 1, rowKey: `custom:${rowId}`, amount: 100 },
      { month: 1, rowKey: 'rev:Boarding', amount: 2000 },
    ],
  })
  check('batch save accepted', saved.text.includes('"ok":true'))

  const csvOf = async () => (await (await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { headers: { Cookie: cookie } })).text())
  let csv = await csvOf()
  const cells = (c, label) => (c.split(/\r?\n/).find(l => l.startsWith(label)) ?? '').split(',')
  check('csv: Depreciation Feb 100', cells(csv, 'Depreciation')[2] === '100.00')
  check('csv: Total Opex includes it (100)', cells(csv, 'Total Operating Expenses')[2] === '100.00')
  check('csv: Boarding override 2000 · net = 2000 − 100 − tax', cells(csv, 'Boarding Revenue')[2] === '2000.00')

  // ── batch clear reverts the override ──
  const cleared = await call('saveStatementCells', { year: YEAR, cells: [{ month: 1, rowKey: 'rev:Boarding', amount: null }] })
  check('batch clear accepted', cleared.text.includes('"ok":true'))
  csv = await csvOf()
  check('csv: Boarding reverted to 0', cells(csv, 'Boarding Revenue')[2] === '0.00')

  // ── delete the custom row (cells go with it) ──
  const removed = await call('removeStatementRow', { id: rowId })
  check('remove row accepted', removed.text.includes('"ok":true'))
  csv = await csvOf()
  check('csv: Depreciation row gone', !csv.includes('Depreciation'))
  const left = await pipe([exec(`SELECT COUNT(*) FROM StatementCell WHERE rowKey = ?`, [t(`custom:${rowId}`)])])
  check('its cells deleted too', left[0].response.result.rows[0][0].value === '0')

  // ── guard ──
  const bad = await call('addStatementRow', { year: YEAR, section: 'nonsense', label: 'X' })
  check('bad section rejected', bad.text.includes('Bad section'))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
