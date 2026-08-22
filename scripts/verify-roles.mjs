import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 2 role-based views & navigation. Seeds one staff account per
// role (unique long PINs so they can't collide with real 4-digit PINs), then
// asserts, for each role:
//  • login lands on the role's home screen
//  • the role can open its allowed pages and is bounced from the rest
//  • the sidebar shows only that role's links
// Manager (owner password) keeps full access. Cleans up seeded staff.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYROLE'
const pinHash = pin => crypto.createHash('sha256').update(`catday:${pin}`).digest('hex')

const t = v => ({ type: 'text', value: String(v) })
const mk = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

const staff = {
  FrontDesk: { id: crypto.randomUUID(), pin: `${MARK}-frontdesk-8801` },
  Groomer:   { id: crypto.randomUUID(), pin: `${MARK}-groomer-8802` },
  Boarding:  { id: crypto.randomUUID(), pin: `${MARK}-boarding-8803` },
}

async function cleanup() { await pipe([exec(`DELETE FROM Staff WHERE name LIKE '${MARK}%'`)]) }

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

async function loginPin(pin) {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: pin }).toString(), redirect: 'manual',
  })
  const cookie = (r.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const loc = r.headers.get('location') ?? ''
  return { cookie, landing: new URL(loc, BASE).pathname }
}
async function visit(cookie, path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' })
  const loc = r.headers.get('location')
  return { code: r.status, to: loc ? new URL(loc, BASE).pathname : null }
}
async function navHtml(cookie, path) {
  return strip(await (await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } })).text())
}

try {
  await cleanup()
  await pipe(Object.entries(staff).map(([role, s]) =>
    exec(`INSERT INTO Staff (id,name,role,pinHash,active,createdAt,updatedAt)
          VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(s.id), t(`${MARK} ${role}`), t(role), t(pinHash(s.pin))])))
  console.log('seeded FrontDesk / Groomer / Boarding staff')

  // ── Groomer ──
  const g = await loginPin(staff.Groomer.pin)
  check('Groomer lands on /board', g.landing === '/board', g.landing)
  check('Groomer opens /board', (await visit(g.cookie, '/board')).code === 200)
  check('Groomer opens /cats', (await visit(g.cookie, '/cats')).code === 200)
  check('Groomer blocked from /pos → /board', (await visit(g.cookie, '/pos')).to === '/board')
  check('Groomer blocked from /customers → /board', (await visit(g.cookie, '/customers')).to === '/board')
  check('Groomer blocked from /runsheet → /board', (await visit(g.cookie, '/runsheet')).to === '/board')
  check('Groomer blocked from /finance → /board', (await visit(g.cookie, '/finance/income-statement')).to === '/board')
  check('Groomer root / → /board', (await visit(g.cookie, '/')).to === '/board')
  const gNav = await navHtml(g.cookie, '/board')
  // Labels now come from the tab catalogue rather than a per-role label map.
  // That second map was the thing that had to 'mirror lib/roles.ts' by hand, and
  // it is what drifted; one canonical name per tab is the point of removing it.
  check('Groomer nav shows the board and cats', gNav.includes('Service Board') && gNav.includes('Cats'))
  check('…and nothing it was not granted', !gNav.includes('POS Checkout') && !gNav.includes('Expenses'))
  check('Groomer nav hides POS & Customers & Inbox', !gNav.includes('POS Checkout') && !gNav.includes('Customers') && !gNav.includes('Action Inbox'))

  // ── Boarding ──
  const b = await loginPin(staff.Boarding.pin)
  check('Boarding lands on /runsheet', b.landing === '/runsheet', b.landing)
  check('Boarding opens /runsheet', (await visit(b.cookie, '/runsheet')).code === 200)
  check('Boarding opens /rooms', (await visit(b.cookie, '/rooms')).code === 200)
  check('Boarding blocked from /board → /runsheet', (await visit(b.cookie, '/board')).to === '/runsheet')
  check('Boarding blocked from /pos → /runsheet', (await visit(b.cookie, '/pos')).to === '/runsheet')
  check('Boarding blocked from /customers → /runsheet', (await visit(b.cookie, '/customers')).to === '/runsheet')
  const bNav = await navHtml(b.cookie, '/runsheet')
  // Asserted on HREFS, not labels. The old form looked for the words "Run Sheet"
  // and "Rooms" in the stripped page — but "Run Sheet" also matches the run
  // sheet's own heading, so only half of it was really testing the nav, and the
  // other half broke the moment /rooms was renamed to the Boarding Wall. The
  // claim is which tabs the role gets, and an href is what says that.
  const bRaw = await (await fetch(`${BASE}/runsheet`, { headers: { Cookie: b.cookie } })).text()
  const bAside = bRaw.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? ''
  check('Boarding nav shows the run sheet and the boarding wall',
    bAside.includes('href="/runsheet"') && bAside.includes('href="/rooms"'),
    bAside.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160))
  check('Boarding nav hides POS & Service Board', !bNav.includes('POS Checkout') && !bNav.includes('Service Board'))

  // ── Front Desk ──
  const f = await loginPin(staff.FrontDesk.pin)
  check('FrontDesk lands on /actions', f.landing === '/actions', f.landing)
  check('FrontDesk opens /pos', (await visit(f.cookie, '/pos')).code === 200)
  check('FrontDesk opens /customers', (await visit(f.cookie, '/customers')).code === 200)
  check('FrontDesk blocked from /memberships/tiers → /actions', (await visit(f.cookie, '/memberships/tiers')).to === '/actions')
  check('FrontDesk blocked from /finance → /actions', (await visit(f.cookie, '/finance/income-statement')).to === '/actions')
  check('FrontDesk blocked from /staff → /actions', (await visit(f.cookie, '/staff')).to === '/actions')
  const fNav = await navHtml(f.cookie, '/actions')
  check('FrontDesk nav shows POS + Customers + Inbox', fNav.includes('POS Checkout') && fNav.includes('Customers') && fNav.includes('Action Inbox'))

  // ── Manager (owner password) keeps full access ──
  const m = await loginPin(process.env.APP_PASSWORD ?? '')
  // The owner lands on the brief, not the dashboard. The dashboard cost ~5.9s
  // and 63 queries and was the first thing seen after signing in; the brief
  // costs ~400ms. Asserted as "not the dashboard, and a page the owner can
  // actually open", so re-pointing the landing later is a one-line change here
  // rather than a puzzle.
  check('Manager lands on the brief, not the 6-second dashboard',
    m.landing === '/brief', m.landing)
  check('…and that landing actually opens for them',
    (await visit(m.cookie, m.landing)).code === 200)
  check('the dashboard is still reachable, just not the landing',
    (await visit(m.cookie, '/')).code === 200)
  check('Manager opens /finance', (await visit(m.cookie, '/finance/income-statement')).code === 200)
  check('Manager opens /staff', (await visit(m.cookie, '/staff')).code === 200)
  check('Manager opens /admin/settings', (await visit(m.cookie, '/admin/settings')).code === 200)

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up seeded staff')
}
