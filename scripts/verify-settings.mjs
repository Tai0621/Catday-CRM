import 'dotenv/config'

// E2E for the Business Settings config seam (lib/config.ts):
//  - default path: an un-seeded Setting table renders Cat Day's built-in values
//    (the safety property — shipping this changes nothing until an owner edits).
//  - override path: a seeded Setting row flows through getConfig() onto a real
//    surface (the public /login screen: business name, tagline, portal label).
//  - the Settings page itself renders authed, is behind the auth gate, and reads
//    back stored values (incl. a numeric field, stored as a string).
// Seeds directly via Turso HTTP, asserts over real HTTP, cleans up in finally.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

// every key we might touch — cleanup blanks the whole set so live Turso is left
// with no Setting rows (the correct default state for Cat Day).
const KEYS = ['business.name', 'business.tagline', 'portalLabel', 'ops.openHour', 'ops.closeHour']

const t = v => ({ type: 'text', value: String(v) })
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
const setKey = (k, v) => exec(
  `INSERT INTO Setting (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=CURRENT_TIMESTAMP`, [t(k), t(v)])

async function cleanup() {
  await pipe(KEYS.map(k => exec(`DELETE FROM Setting WHERE key = ?`, [t(k)])))
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup() // start from the true default (no rows)

  // ── login for the authed settings-page checks ──
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getPublic = async u => strip(await (await fetch(`${BASE}${u}`)).text())
  const getAuthed = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── 1. default path: /login shows Cat Day's built-in identity ──
  let lp = await getPublic('/login')
  check('default: login tagline is Cat Day\'s', lp.includes('A Good Day for Every Cat'))
  check('default: login logo alt = "Cat Day"', lp.includes('alt="Cat Day"'))
  check('default: footer "Cat Day OS · Staff Portal"', lp.includes('Cat Day OS') && lp.includes('Staff Portal'))

  // ── 2. override path: seeded rows flow through getConfig onto /login ──
  await pipe([
    setKey('business.name', 'Meridian Cattery'),
    setKey('business.tagline', 'Where Every Whisker Matters'),
    setKey('portalLabel', 'Team Console'),
  ])
  lp = await getPublic('/login')
  check('override: tagline reflects seeded value', lp.includes('Where Every Whisker Matters'))
  check('override: logo alt reflects business name', lp.includes('alt="Meridian Cattery"'))
  check('override: footer reflects name + portal label', lp.includes('Meridian Cattery OS') && lp.includes('Team Console'))
  check('override: old Cat Day tagline is gone', !lp.includes('A Good Day for Every Cat'))

  // ── 3. Settings page: authed render + reads back stored values ──
  await pipe([setKey('ops.openHour', '8')]) // numeric field stored as string
  const sp = await getAuthed('/admin/settings')
  check('settings page renders (title)', sp.includes('Business Settings'))
  check('settings page has Operations field', sp.includes('Opening hour (24h)'))
  check('settings page has Localization field', sp.includes('Currency code'))
  check('settings reads back stored name', sp.includes('Meridian Cattery'))
  check('settings reads back numeric ops.openHour=8', /name="ops\.openHour"[^>]*value="8"/.test(sp) || sp.includes('value="8"'))

  // ── 4. auth gate: unauthenticated cannot open the settings page ──
  const guarded = await fetch(`${BASE}/admin/settings`, { redirect: 'manual' })
  const loc = guarded.headers.get('location') ?? ''
  check('unauthed /admin/settings redirects to /login', guarded.status >= 300 && guarded.status < 400 && loc.includes('/login'), `${guarded.status} ${loc}`)

  // ── 5. cleanup restores defaults on the live surface ──
  await cleanup()
  lp = await getPublic('/login')
  check('after clear: back to Cat Day default', lp.includes('A Good Day for Every Cat') && lp.includes('alt="Cat Day"'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data (Setting rows removed → Cat Day defaults)')
}
