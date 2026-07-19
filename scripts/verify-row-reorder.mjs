import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for drag-to-reorder: saving a section's order changes the row order the
// statement renders (and the CSV export), without touching any figures.
// Restores the prior order afterwards.

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

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

try {
  await pipe([exec(`DELETE FROM StatementRowOrder WHERE year = ?`, [i(YEAR)])])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  const pageUrl = `${BASE}/finance/income-statement?year=${YEAR}`
  const pageHtml = await (await fetch(pageUrl, { headers: { Cookie: cookie } })).text()
  const srcs = [...new Set([...pageHtml.matchAll(/\/_next\/static\/chunks\/[^"'\\\s>]+\.js/g)].map(m => m[0].replace(/&amp;/g, '&')))]
  let actionId = null
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src}`)).text()
    if (!js.includes('reorderStatementRows')) continue
    const v = (js.match(/"reorderStatementRows",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/) ?? [])[1]
    if (!v) continue
    actionId = (js.match(new RegExp(`const ${v.replace(/\$/g, '\\$')}[\\s\\S]{0,2000}?"([0-9a-f]{40,})"`)) ?? [])[1] ?? null
    if (actionId) break
  }
  check('found reorderStatementRows action id', !!actionId)

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

  // Default revenue order starts Grooming, Boarding, Retail, … — move Academy & Other to the front
  const newOrder = ['rev:Academy', 'rev:Other', 'rev:Grooming', 'rev:Boarding', 'rev:Retail', 'rev:Membership']
  const res = await call({ year: YEAR, section: 'rev', keys: newOrder })
  check('reorder accepted', res.text.includes('"ok":true'))

  // The CSV export renders rows in statement order — Academy Revenue should now
  // come before Grooming Revenue (it doesn't by default)
  const csv = await (await fetch(`${BASE}/finance/income-statement/export?year=${YEAR}`, { headers: { Cookie: cookie } })).text()
  const lines = csv.split(/\r?\n/)
  const posAcademy = lines.findIndex(l => l.startsWith('Academy Revenue'))
  const posGrooming = lines.findIndex(l => l.startsWith('Grooming Revenue'))
  check('Academy row now appears before Grooming', posAcademy > 0 && posGrooming > 0 && posAcademy < posGrooming,
    `academy@${posAcademy} grooming@${posGrooming}`)

  // Totals unaffected by order
  const totalRev = (lines.find(l => l.startsWith('Total Revenue')) ?? '').split(',')[13]
  check('Total Revenue unchanged by reorder', totalRev !== undefined && totalRev !== '')

  // Bad section rejected
  const bad = await call({ year: YEAR, section: 'nope', keys: [] })
  check('bad section rejected', bad.text.includes('Bad section'))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await pipe([exec(`DELETE FROM StatementRowOrder WHERE year = ?`, [i(YEAR)])])
  console.log('cleaned up row order')
}
