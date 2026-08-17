import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for the room calendar: a stay must render as ONE bar spanning its days
// (colSpan), and the ?free=1 toggle must hide rooms with any stay in the window.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYCAL'

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

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const roomBusy = crypto.randomUUID(), roomFree = crypto.randomUUID()
const stayId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Appointment WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Room WHERE id IN (?, ?)`, [t(roomBusy), t(roomFree)]),
  ])
}

const now = new Date()
const day = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12, 0, 0)

let pass = 0, total = 0
const check = (label, ok) => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}`) }

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60119998888')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(custId), t(`${MARK}Kitty`)]),
    exec(`INSERT INTO Room (id,name,type,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,'Available',980,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomBusy), t(`${MARK} Busy Room`), t('Suite')]),
    exec(`INSERT INTO Room (id,name,type,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,'Available',981,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomFree), t(`${MARK} Free Room`), t('Standard')]),
    // 4-night stay: day+1 -> day+5 (covers 4 shown columns)
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,'CheckedIn',?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(stayId), t(custId), t(catId), t('Boarding'), t(day(1).toISOString()), t(day(5).toISOString()), t(roomBusy)]),
  ])
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

  // ── all-rooms view: one bar, spanning, name appears once ──
  // Warm the route (Turbopack may serve a stale compile on the first hit),
  // then strip React's SSR comment separators so text regexes match.
  await fetch(`${BASE}/rooms/calendar`, { headers: { Cookie: cookie } })
  const all = (await (await fetch(`${BASE}/rooms/calendar`, { headers: { Cookie: cookie } })).text())
    .replace(/<!--[\s\S]*?-->/g, '')
  // Anchor on the RENDERED row (`name<span`), not the escaped RSC flight payload
  // that appears earlier in the stream.
  const rowStart = all.indexOf(`${MARK} Busy Room<span`)
  const rowEnd = all.indexOf('</tr>', rowStart)
  const row = all.slice(rowStart, rowEnd)
  check('busy room row renders', rowStart > 0)
  // 4 nights occupy 5 columns: the check-out day is busy until pickup
  check('stay is ONE bar spanning its days (colSpan=5)', /colspan="5"/i.test(row))
  // Visible text occurrences only (each bar also carries the name in its title tooltip)
  check('cat name appears once in the row (not per-day)', (row.match(new RegExp(`>${MARK}Kitty<`, 'g')) ?? []).length === 1)
  check('toggle shows free count', /Free next 14 days \(\d+\)/.test(all))

  // ── free-only view: busy room hidden, free room shown ──
  const fr = await (await fetch(`${BASE}/rooms/calendar?free=1`, { headers: { Cookie: cookie } })).text()
  check('free view hides the busy room', !fr.includes(`${MARK} Busy Room`))
  check('free view keeps the free room', fr.includes(`${MARK} Free Room`))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
