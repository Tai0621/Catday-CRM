import 'dotenv/config'
import { readFileSync } from 'node:fs'

// Round-trip counter.
//
// This app's latency is not CPU — it is sequential queries to Turso. Run the
// server with DB_TRACE=1 writing to a log, then this walks the pages a person
// actually clicks and reports, for each: wall time, how many queries ran, and
// how long the database was busy summed across them. DB time far ABOVE wall
// time means those queries overlapped (good); DB time tracking wall time means
// they ran one after another (the thing to fix).
//
//   source .env.demo.sh && DB_TRACE=1 npx next start -p 3100 > .tmp-perf.log &
//   source .env.demo.sh && node scripts/perf-probe.mjs
//   source .env.demo.sh && node scripts/perf-probe.mjs /            # one page, per-table
//
// `dotenv/config` is load-bearing: APP_PASSWORD lives in .env, and the server
// reads it the same way. A probe without it logs in with an empty password,
// gets a 307 to /login on every page, and reports one query per page — which
// looks like a beautifully optimised app rather than a broken probe.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const LOG = process.env.PERF_LOG ?? '.tmp-perf.log'
// Via env, not argv: Git Bash rewrites a bare "/" argument into a Windows path.
const only = process.env.PERF_ONLY ?? null

const PAGES = [
  '/', '/board', '/runsheet', '/appointments', '/cats', '/customers', '/pos',
  '/rooms', '/revenue', '/finance/income-statement', '/staff', '/memberships',
  '/inventory/products', '/incidents', '/leave', '/timeclock', '/ai', '/hr/roles',
]

// The child's stdout reaches the file a beat after the response reaches us;
// without this, one page's queries get counted against the next.
const FLUSH_MS = 400
const sleep = ms => new Promise(r => setTimeout(r, ms))
const qlines = () => readFileSync(LOG, 'utf8').split('\n').filter(l => l.startsWith('[q]'))
const dbMsOf = ls => ls.reduce((sum, l) => sum + Number(l.match(/\[q\]\s+(\d+)ms/)?.[1] ?? 0), 0)

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
if (!cookie.startsWith('auth=')) throw new Error(`login failed (${login.status}) — check APP_PASSWORD`)

async function measure(path) {
  // Warm first so this is a steady-state click, not a cold route compile.
  await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } }).then(r => r.text())
  await sleep(FLUSH_MS)
  const before = qlines().length
  const t0 = Date.now()
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' })
  if (res.status !== 200) throw new Error(`${path} returned ${res.status} — not measuring a rendered page`)
  // A streamed page sends its shell before the suspended parts resolve, so the
  // first chunk is what the reader actually sees. Total is still reported: a
  // page that paints fast and finishes slowly is a real improvement, and a page
  // where the two are equal is not streaming anything.
  let paint = null, bytes = 0
  for await (const chunk of res.body) {
    paint ??= Date.now() - t0
    bytes += chunk.length
  }
  const wall = Date.now() - t0
  await sleep(FLUSH_MS)
  const fresh = qlines().slice(before)
  return { path, wall, paint, queries: fresh.length, dbMs: dbMsOf(fresh), bytes, fresh }
}

if (only) {
  const r = await measure(only)
  console.log(`${only} — ${r.wall}ms wall · ${r.queries} queries · ${r.dbMs}ms summed`)
  const byTable = {}
  for (const l of r.fresh) {
    const m = l.match(/(?:FROM|INTO|UPDATE)\s+[`"]?(?:main[`"]?\.)?[`"]?(\w+)/i)
    byTable[m?.[1] ?? l.slice(24, 70)] = (byTable[m?.[1] ?? l.slice(24, 70)] ?? 0) + 1
  }
  for (const [t, n] of Object.entries(byTable).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(4)}  ${t}`)
  }
} else {
  const rows = []
  for (const path of PAGES) rows.push(await measure(path))
  rows.sort((a, b) => b.wall - a.wall)
  console.log('page                           paint     full    queries')
  for (const r of rows) {
    console.log(r.path.padEnd(30) + `${r.paint}ms`.padStart(7) + `${r.wall}ms`.padStart(9) + String(r.queries).padStart(10))
  }
  const tot = rows.reduce((a, r) => ({ wall: a.wall + r.wall, q: a.q + r.queries }), { wall: 0, q: 0 })
  console.log(`\n${rows.length} pages · ${tot.q} queries · ${tot.wall}ms total wall`)
}
