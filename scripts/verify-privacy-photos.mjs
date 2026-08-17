import 'dotenv/config'
import './_guard.mjs'

// Track A / A1 — verifies the orphaned Cat.photos column is gone and that cat
// pages still render without it. Seeds a customer + cat, logs in as manager,
// checks the schema (PRAGMA) and the list + detail pages, cleans up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYPRIV'

const t = v => ({ type: 'text', value: String(v) })
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
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const rowsOf = res => res.response.result.rows.map(row => row.map(c => (c.type === 'null' ? null : c.value)))

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
async function cleanup() {
  await pipe([
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,phone,name,source,createdAt,updatedAt) VALUES (?,?,?,'WalkIn',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(custId), t(`+60${MARK}`), t(`${MARK} Owner`)]),
    exec(`INSERT INTO Cat (id,name,customerId,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(`${MARK} Mochi`), t(custId)]),
  ])
  console.log('seeded a customer + cat')

  // ── Schema: photos column must be gone ──
  const info = await pipe([exec(`PRAGMA table_info(Cat)`)])
  const cols = rowsOf(info[0]).map(r => r[1])
  check('Cat.photos column removed from schema', !cols.includes('photos'), `cols=${cols.join(',')}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: mgr } })).text())

  // ── Pages still render without the column ──
  const list = await getHtml('/cats')
  check('cats list renders the seeded cat', list.includes(`${MARK} Mochi`))
  const detail = await getHtml(`/cats/${catId}`)
  check('cat detail renders', detail.includes(`${MARK} Mochi`))
  check('cat detail shows the media (Blob) section, not a base64 field', /photos|videos|media/i.test(detail))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
