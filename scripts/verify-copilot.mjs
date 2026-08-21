import 'dotenv/config'
import './_guard.mjs'

// C1 — the copilot dock.
//
// Deliberately makes NO model call. Everything worth guarding here is reachable
// without one:
//
//   • scope    — the dock must know where the user is standing
//   • budget   — checked BEFORE the call, so it must refuse without spending
//   • kill     — a zero budget removes the assistant entirely
//   • auth     — the endpoint reads business data and must reject strangers
//   • erasure  — Track A's guarantee has to hold inside the AI tools too
//
// Run the server with a placeholder ANTHROPIC_API_KEY: it makes the assistant
// "configured" so the budget paths are reachable, and no test here POSTs a
// question that would reach Anthropic.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

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

const today = (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date())
const setBudget = n => pipe([exec(
  `INSERT INTO Setting (key,value,updatedAt) VALUES ('ai.dailyTokenBudget',?,CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP`, [t(String(n))])])

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Setting WHERE key = 'ai.dailyTokenBudget'`),
    exec(`DELETE FROM AiUsage WHERE date = ?`, [t(today)]),
  ])
}

try {
  await cleanup()

  // ── auth ──
  // Asserted as "a stranger gets no data", not as a specific status: proxy.ts
  // redirects unauthenticated traffic to /login before the route's own 401 is
  // reached, so either outcome is correct — following the redirect would land on
  // the login page and look like a 200.
  const denied = async res => {
    if (res.status === 401) return true
    if (res.status >= 300 && res.status < 400) return (res.headers.get('location') ?? '').includes('/login')
    return false
  }
  const anonGet = await fetch(`${BASE}/api/ask?path=/customers`, { redirect: 'manual' })
  check('unauthenticated GET gets no data', await denied(anonGet), `status ${anonGet.status}`)
  const anonPost = await fetch(`${BASE}/api/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'hello' }), redirect: 'manual',
  })
  check('unauthenticated POST gets no data', await denied(anonPost), `status ${anonPost.status}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const info = async path =>
    (await (await fetch(`${BASE}/api/ask?path=${encodeURIComponent(path)}`, { headers: { cookie } })).json())

  // ── scope ──
  await setBudget(300000)
  const runsheet = await info('/runsheet')
  check('scope follows the page (run sheet)', runsheet.scope?.label === 'Boarding round', `got ${runsheet.scope?.label}`)
  check('suggestions are about boarding', runsheet.scope.suggestions.some(s => /boarding|occupancy|health/i.test(s)),
    runsheet.scope.suggestions.join(' | '))

  const finance = await info('/finance/income-statement')
  check('nested paths resolve (finance)', finance.scope?.label === 'Finance', `got ${finance.scope?.label}`)

  const marketing = await info('/marketing/groups')
  check('longest prefix wins (marketing)', marketing.scope?.label === 'Marketing', `got ${marketing.scope?.label}`)

  const home = await info('/')
  check('unknown paths fall back', home.scope?.label === 'Anywhere', `got ${home.scope?.label}`)

  check('assistant is offered when in budget', home.available === true, `available=${home.available} reason=${home.reason}`)

  // ── budget ──
  await pipe([exec(
    `INSERT INTO AiUsage (id,date,inputTokens,outputTokens,calls,updatedAt)
     VALUES (?,?,200000,150000,3,CURRENT_TIMESTAMP)`, [t(crypto.randomUUID()), t(today)])])
  const spent = await info('/')
  check('exhausted budget withdraws the assistant', spent.available === false && spent.reason === 'budget',
    `available=${spent.available} reason=${spent.reason}`)

  // ── kill switch ──
  await setBudget(0)
  const off = await info('/')
  check('zero budget disables it entirely', off.available === false && off.reason === 'disabled',
    `available=${off.available} reason=${off.reason}`)

  const blocked = await fetch(`${BASE}/api/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ question: 'what is revenue this month?', path: '/' }),
  })
  const blockedBody = await blocked.json()
  check('a disabled assistant refuses before spending', blocked.status === 503 && blockedBody.error === 'disabled',
    `status ${blocked.status} ${JSON.stringify(blockedBody)}`)

  // ── erasure (static) ──
  // The tools only run inside a model call, so this is asserted against the
  // source: every customer- or cat-reading query must carry the filter. Track A
  // anonymised these people; the assistant must not hand them back.
  const src = await import('node:fs').then(fs => fs.readFileSync('lib/ai/ask.ts', 'utf8'))
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const customerReads = [...code.matchAll(/db\.(customer|cat|membership)\.find\w+\(\{[\s\S]{0,400}?\}\)/g)].map(m => m[0])
  const unguarded = customerReads.filter(q => !q.includes('LIVE_CUSTOMER'))
  check('every customer/cat tool query filters erased records', unguarded.length === 0,
    `${unguarded.length} unguarded of ${customerReads.length}`)
  // Asserted on the DEFINITION wherever it lives, not on a literal line in this
  // file. `LIVE_CUSTOMER` moved to lib/cat-stock.ts and grew `isHouse: false`
  // when the shop's own cats became stock; a string match on the old text broke
  // while the guarantee it protects was intact and in fact stronger, since there
  // is now one shared constant instead of a per-file copy.
  const stock = await import('node:fs').then(fs => fs.readFileSync('lib/cat-stock.ts', 'utf8'))
  const def = stock.match(/export const LIVE_CUSTOMER = \{[^}]*\}/)?.[0] ?? ''
  check('the filter is a where clause, not a prompt instruction',
    /erasedAt:\s*null/.test(def), def || 'LIVE_CUSTOMER definition not found')
  check('…and ask.ts uses that shared constant rather than its own copy',
    /import \{[^}]*LIVE_CUSTOMER[^}]*\} from '\.\.\/cat-stock'/.test(src) && !/const LIVE_CUSTOMER/.test(code))

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
