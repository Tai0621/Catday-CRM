import 'dotenv/config'

// Track B / B1 — white-label seam. Overrides the business name, accent colour and
// logo via Setting rows, then confirms those flow through getConfig() into the
// rendered login screen (public) and the app shell (metadata + injected brand CSS
// variables). Captures and restores the prior Setting values in finally, so the
// live app is unchanged after the run.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const NAME = 'VERIFYBRAND Co', PRIMARY = '#0a0b0c', LOGO = '/verify-logo.png'
const KEYS = { 'business.name': NAME, 'brand.primary': PRIMARY, 'brand.logoUrl': LOGO }

const t = v => ({ type: 'text', value: String(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

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

let prior = {}
async function capturePrior() {
  const res = await pipe(Object.keys(KEYS).map(k => exec(`SELECT value FROM Setting WHERE key=?`, [t(k)])))
  Object.keys(KEYS).forEach((k, i) => { const r = rowsOf(res[i]); prior[k] = r.length ? r[0][0] : null })
}
async function restore() {
  await pipe(Object.entries(prior).map(([k, v]) => v === null
    ? exec(`DELETE FROM Setting WHERE key=?`, [t(k)])
    : exec(`INSERT OR REPLACE INTO Setting (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)`, [t(k), t(v)])))
}

try {
  await capturePrior()
  await pipe(Object.entries(KEYS).map(([k, v]) =>
    exec(`INSERT OR REPLACE INTO Setting (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)`, [t(k), t(v)])))
  console.log('applied branding overrides')

  // ── Public login reflects the override ──
  const login = await (await fetch(`${BASE}/login`)).text()
  check('login footer shows the configured business name', login.includes(`${NAME} OS`))
  check('login uses the configured logo', login.includes(`src="${LOGO}"`))
  check('page <title> is config-driven', login.includes(`${NAME} OS</title>`))
  check('brand accent injected as a CSS variable', login.includes(`--brand-primary:${PRIMARY}`))

  // ── App shell (authenticated) injects the same ──
  const mgrLogin = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (mgrLogin.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const dash = (await (await fetch(`${BASE}/`, { headers: { Cookie: mgr } })).text()).replace(/<!--[\s\S]*?-->/g, '')
  check('app shell injects the brand accent variable', dash.includes(`--brand-primary:${PRIMARY}`))
  check('dashboard membership section uses the business name', dash.includes(`${NAME} Privé`))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await restore()
  console.log('restored prior branding settings')
}
