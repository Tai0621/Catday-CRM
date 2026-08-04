import 'dotenv/config'

// C3 — Action Inbox learning.
// Seeds two synthetic action histories with opposite records and proves the
// inbox reacts to them: a type staff always act on (and that produces bookings)
// is reported as converting, and a type staff always dismiss is held back and
// its live card disappears from the queue.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYC3'
const DAY = 24 * 60 * 60 * 1000

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
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)

const winnerCust = crypto.randomUUID(), winnerCat = crypto.randomUUID()
const loserCust = crypto.randomUUID(), loserCat = crypto.randomUUID()
const apptIds = Array.from({ length: 10 }, () => crypto.randomUUID())

async function cleanup() {
  await pipe([
    exec(`DELETE FROM ActionLog WHERE actionKey LIKE '${MARK}%'`),
    exec(`DELETE FROM Appointment WHERE customerId IN (?,?)`, [t(winnerCust), t(loserCust)]),
    exec(`DELETE FROM Cat WHERE id IN (?,?)`, [t(winnerCat), t(loserCat)]),
    exec(`DELETE FROM Customer WHERE id IN (?,?)`, [t(winnerCust), t(loserCust)]),
  ])
}

try {
  await cleanup()
  const now = Date.now()
  const today = new Date(now)
  // A birthday today guarantees the Birthday generator emits a live card, which
  // is what suppression then has to remove.
  const bday = `2021-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} 00:00:00`

  await pipe([
    exec(`INSERT INTO Customer (id,phone,name,source,createdAt,updatedAt) VALUES (?,?,?,'WalkIn',?,CURRENT_TIMESTAMP)`,
      [t(winnerCust), t(`+60${MARK}1`), t(`${MARK} Winner`), t(iso(now - 300 * DAY))]),
    exec(`INSERT INTO Customer (id,phone,name,source,createdAt,updatedAt) VALUES (?,?,?,'WalkIn',?,CURRENT_TIMESTAMP)`,
      [t(loserCust), t(`+60${MARK}2`), t(`${MARK} Loser`), t(iso(now - 300 * DAY))]),
    exec(`INSERT INTO Cat (id,name,customerId,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(winnerCat), t(`${MARK} Mochi`), t(winnerCust)]),
    exec(`INSERT INTO Cat (id,name,customerId,dateOfBirth,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(loserCat), t(`${MARK} Tofu`), t(loserCust), t(bday)]),
  ])

  // GroomingDue: 10 logged outcomes, all actioned, each followed by a booking
  // inside the 21-day window → high acceptance AND high conversion.
  // Birthday: 10 logged outcomes, all dismissed, no bookings → dead type.
  // Synthetic actionKeys so these never collide with (and hide) a real card.
  const logs = []
  for (let i = 0; i < 10; i++) {
    logs.push(exec(
      `INSERT INTO ActionLog (id,actionKey,type,customerId,status,createdAt) VALUES (?,?,'GroomingDue',?,'Done',?)`,
      [t(crypto.randomUUID()), t(`${MARK}-groom-${i}`), t(winnerCust), t(iso(now - 60 * DAY))]))
    logs.push(exec(
      `INSERT INTO ActionLog (id,actionKey,type,customerId,status,createdAt) VALUES (?,?,'Birthday',?,'Dismissed',?)`,
      [t(crypto.randomUUID()), t(`${MARK}-bday-${i}`), t(loserCust), t(iso(now - 60 * DAY))]))
    // paid + no price keeps these out of the OutstandingPayment generator
    logs.push(exec(
      `INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,paid,usedCredit,createdAt,updatedAt)
       VALUES (?,?,?,'Grooming',?,'Completed',1,0,?,CURRENT_TIMESTAMP)`,
      [t(apptIds[i]), t(winnerCust), t(winnerCat), t(iso(now - 55 * DAY)), t(iso(now - 55 * DAY))]))
  }
  // Sample counts are read as a BEFORE/AFTER delta, not an absolute. The demo
  // database already carries seeded action history, so asserting a literal
  // "n=10" only passes against an empty database — and this script has to be
  // runnable against demo and production alike.
  const preLogin = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const preCookie = (preLogin.headers.get('set-cookie') ?? '').split(';')[0]
  // React renders `n={s.sample}` as two adjacent nodes, so the payload carries
  // "n=","38" rather than "n=38" — allow separators between the label and the
  // digits. Returns null when the row is absent, so a missing row cannot look
  // like a real zero.
  const sampleFor = (h, label) => {
    const i = h.indexOf(label)
    // No row at all is a genuine zero: the type has not reached the minimum
    // sample to be reported. Only a row we cannot read is an error worth
    // surfacing, so those return null and fail the check loudly.
    if (i === -1) return 0
    const m = h.slice(i + label.length, i + label.length + 600).match(/n=[^\d]{0,8}(\d+)/)
    return m ? Number(m[1]) : null
  }
  const beforeHtml = strip(await (await fetch(`${BASE}/actions`, { headers: { cookie: preCookie } })).text())
  const groomBefore = sampleFor(beforeHtml, 'Grooming due')

  await pipe(logs)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const res = await fetch(`${BASE}/actions`, { headers: { cookie } })
  const html = strip(await res.text())
  check('/actions renders', res.status === 200, `status ${res.status}`)
  check('What\'s working panel present', html.includes('What') && html.includes('ranking is tuned by these results'))

  // The winning type is measured, reported as converting, and NOT held back.
  check('Grooming due appears in the panel', /Grooming due/.test(html))
  const booked = html.match(/(\d+)% booked/g) ?? []
  check('a conversion rate is reported', booked.length > 0, `found ${booked.join(', ') || 'none'}`)
  const groomAfter = sampleFor(html, 'Grooming due')
  check('seeded outcomes counted (+10)',
    groomBefore !== null && groomAfter !== null && groomAfter - groomBefore === 10,
    `sample went ${groomBefore} → ${groomAfter}, expected +10`)

  // The dead type is held back, and its live card is gone from the queue.
  const heldIdx = html.indexOf('Held back')
  check('Birthday held back', heldIdx > -1 && /Held back[\s\S]{0,200}Birthday/.test(html))
  check('held-back card removed from queue', !html.includes(`${MARK} Tofu`), 'the birthday card should not render')
  check('urgent types never suppressed', html.includes('Urgent actions are never held back'))

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
