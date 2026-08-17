import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// The four facts the Action Inbox derives about a customer.
//
// These used to come from loading every customer WITH their whole appointment
// history and a year of transactions, then counting the rows in JavaScript.
// They now come from aggregates. The rows are gone, so nothing would tell us if
// a boundary moved — a win-back that fires for someone who has a booking next
// week, or a Gold invite triggered by spend from two years ago, is a message
// sent to a real customer, and neither the type checker nor the page would
// complain.
//
// So this seeds households sitting exactly on each boundary and asserts which
// cards the real /actions page produces for them.
//
//   last visit          → WinBack (90+ days quiet)
//   a booking ahead     → suppresses WinBack, however long the gap
//   12-month spend      → GoldEligible (RM3000), and spend older than
//                         12 months must NOT count
//   past visit count    → PrivateClubEligible (3 visits), and a FUTURE
//                         booking must NOT count as a visit

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYFACTS'
const DAY = 24 * 60 * 60 * 1000

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
const iso = ms => new Date(ms).toISOString()

const now = Date.now()
const ids = {}
const mkId = k => (ids[k] = crypto.randomUUID())

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "Transaction" WHERE reference LIKE '${MARK}%'`),
    exec(`DELETE FROM Appointment WHERE customerId IN (SELECT id FROM Customer WHERE name LIKE '${MARK}%')`),
    exec(`DELETE FROM Cat WHERE customerId IN (SELECT id FROM Customer WHERE name LIKE '${MARK}%')`),
    exec(`DELETE FROM Customer WHERE name LIKE '${MARK}%'`),
  ])
}

/** A household with one cat. */
function household(key, label) {
  const cid = mkId(key)
  return [
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,?,CURRENT_TIMESTAMP)`,
      [t(cid), t(`${MARK} ${label}`), t(`+6019${String(Math.floor(Math.random() * 9000000) + 1000000)}`), t(iso(now - 800 * DAY))]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(cid), t(`${MARK}cat`)]),
  ]
}
const visit = (cid, whenMs, status = 'Completed') =>
  exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,paid,usedCredit,createdAt,updatedAt)
        VALUES (?,?,(SELECT id FROM Cat WHERE customerId = ? LIMIT 1),'Grooming',?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(crypto.randomUUID()), t(cid), t(cid), t(iso(whenMs)), t(status)])
const spend = (cid, whenMs, amount) =>
  exec(`INSERT INTO "Transaction" (id,customerId,date,category,total,method,reference,createdAt)
        VALUES (?,?,?,'Grooming',?,'Cash',?,CURRENT_TIMESTAMP)`,
    [t(crypto.randomUUID()), t(cid), t(iso(whenMs)), t(amount), t(`${MARK}-${crypto.randomUUID().slice(0, 8)}`)])

try {
  await cleanup()

  await pipe([
    // ── quiet: last visit 120 days ago, nothing booked → WinBack
    ...household('quiet', 'Quiet'),
    // ── booked: equally quiet, but has an appointment next week → NO WinBack
    ...household('booked', 'Booked'),
    // ── gold: RM3200 inside the last twelve months → GoldEligible
    ...household('gold', 'Gold'),
    // ── stale: RM5000, but all of it fourteen months ago → NOT gold
    ...household('stale', 'Stale'),
    // ── loyal: three completed visits → PrivateClubEligible
    ...household('loyal', 'Loyal'),
    // ── nearly: two past visits and one booked ahead → NOT yet (a booking is
    //    not a visit; counting it would invite someone a visit early)
    ...household('nearly', 'Nearly'),
  ])

  await pipe([
    visit(ids.quiet, now - 120 * DAY),

    visit(ids.booked, now - 120 * DAY),
    visit(ids.booked, now + 7 * DAY, 'Scheduled'),

    visit(ids.gold, now - 10 * DAY),
    spend(ids.gold, now - 60 * DAY, 1600),
    spend(ids.gold, now - 200 * DAY, 1600),

    visit(ids.stale, now - 10 * DAY),
    spend(ids.stale, now - 420 * DAY, 5000),

    visit(ids.loyal, now - 10 * DAY),
    visit(ids.loyal, now - 40 * DAY),
    visit(ids.loyal, now - 70 * DAY),

    visit(ids.nearly, now - 10 * DAY),
    visit(ids.nearly, now - 40 * DAY),
    visit(ids.nearly, now + 5 * DAY, 'Scheduled'),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  if (!cookie.startsWith('auth=')) throw new Error(`login failed (${login.status})`)

  const res = await fetch(`${BASE}/actions`, { headers: { Cookie: cookie } })
  const html = await res.text()
  check('the Action Inbox renders', res.status === 200, `status ${res.status}`)

  // The card titles carry the household name, so presence of a title is the
  // assertion. Read the rendered document; the RSC payload repeats it, which is
  // harmless here because we are asking whether a name appears at all.
  const card = (label, type) => {
    // Titles are "Win back <name>", "Gold-eligible — <name>", "Private Club invite — <name>"
    const name = `${MARK} ${label}`
    const idx = html.indexOf(name)
    if (idx < 0) return null
    // Look backwards a little for the card type wording that precedes the name.
    return html.slice(Math.max(0, idx - 120), idx).includes(type)
  }

  check('a household quiet for 120 days gets a win-back', card('Quiet', 'Win back') === true,
    'no WinBack card for the quiet household')
  check('…but one with a booking ahead does NOT', card('Booked', 'Win back') !== true,
    'win-back fired for someone who is already coming back')

  check('RM3200 inside twelve months is Gold-eligible', card('Gold', 'Gold-eligible') === true,
    'no GoldEligible card')
  check('…and RM5000 from fourteen months ago is not', card('Stale', 'Gold-eligible') !== true,
    'spend outside the twelve-month window still counted')

  check('three completed visits earns a Private Club invite', card('Loyal', 'Private Club') === true,
    'no PrivateClubEligible card')
  check('…and a future booking does not count as a visit', card('Nearly', 'Private Club') !== true,
    'an appointment that has not happened yet was counted as a visit')

  // The dashboard preview reads the same queue; if the aggregates broke it, this
  // is where a 500 would show.
  const dash = await fetch(`${BASE}/`, { headers: { Cookie: cookie } })
  const dashHtml = await dash.text()
  check('the dashboard still renders its action preview',
    dash.status === 200 && dashHtml.includes('Open inbox'), `status ${dash.status}`)

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
