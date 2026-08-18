import 'dotenv/config'
import './_guard.mjs'

// The diary: an agenda that does not need hunting, registering a walk-in
// without leaving the booking, and cancelling or moving from the row.
//
// Everything is driven through the running app over real HTTP. The three
// interesting claims are the ones a screenshot cannot make:
//
//   • a boarding stay that MOVES is REPRICED — nights change, so the bill does
//   • a move re-checks room capacity while excluding the booking being moved,
//     or every roomed stay would clash with itself
//   • a phone number already on file selects that household instead of failing
//
// Run against a dev server (the action-id scrape reads Turbopack dev chunks).

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYAPPT'
const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
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
const rows = res => (res.response?.result?.rows ?? []).map(r => r.map(c => c.value))
const one = async (sql, args = []) => rows((await pipe([exec(sql, args)]))[0])

const iso = d => d.toISOString().replace('Z', '+00:00')
/** `days` from now at `hour` local (UTC+8), as an instant. */
// A wall-clock time in the business's own day (UTC+8), `days` from today.
//
// This used to take the UTC calendar date and set the hour to `hour - 8`. Between
// 16:00 and 24:00 UTC — i.e. any time between midnight and 8am where the shop
// actually is — the UTC date is still yesterday, so `at(0, 11)` produced
// "yesterday 11:00" and the diary's upcoming view correctly excluded it. The
// suite then reported the Today heading as missing, which read as a broken diary
// rather than a test that only worked in the afternoon.
const at = (days, hour) => {
  const shifted = new Date(Date.now() + 8 * 3600_000) // wall clock in UTC+8
  return new Date(Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + days,
    hour - 8, 0, 0, 0,
  ))
}

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "AuditLog" WHERE entityId LIKE '${MARK}%'`),
    exec(`DELETE FROM "Appointment" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Cat" WHERE customerId IN (SELECT id FROM "Customer" WHERE phone LIKE '60177%')`),
    exec(`DELETE FROM "Customer" WHERE phone LIKE '60177%'`),
    exec(`DELETE FROM "Cat" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Customer" WHERE id LIKE '${MARK}%'`),
  ])
}
class SkipRest extends Error {}

try {
  await cleanup()
  const now = iso(new Date())

  // ── Seed: one household, one cat, a groom and a 3-night stay ──
  const [[groomSvc]] = [await one(`SELECT id, price, durationMin FROM "Service" WHERE category = 'Grooming' LIMIT 1`)]
  const [[boardSvc]] = [await one(`SELECT id, price FROM "Service" WHERE name LIKE 'Boarding — Standard%' LIMIT 1`)]
  const [[room]] = [await one(`SELECT id, name, capacity FROM "Room" WHERE type = 'Standard' LIMIT 1`)]
  const nightly = Number(boardSvc[1])

  await pipe([
    exec(`INSERT INTO "Customer" (id,phone,name,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 1, ?, ?)`, [t(`${MARK}-c`), t('60165551234'), t(`${MARK} Household`), t(now), t(now)]),
    exec(`INSERT INTO "Cat" (id,customerId,name,breed,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?)`, [t(`${MARK}-cat`), t(`${MARK}-c`), t(`${MARK}Cat`), t('Persian'), t(now), t(now)]),
    // A groom TODAY and one in three days — two different day groups.
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?,?,?, 'Scheduled', ?, 0, ?, ?)`,
      [t(`${MARK}-a1`), t(`${MARK}-c`), t(`${MARK}-cat`), t(groomSvc[0]),
       t(iso(at(0, 11))), t(iso(new Date(at(0, 11).getTime() + 90 * 60000))), f(groomSvc[1]), t(now), t(now)]),
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?,?,?, 'Scheduled', ?, 0, ?, ?)`,
      [t(`${MARK}-a2`), t(`${MARK}-c`), t(`${MARK}-cat`), t(groomSvc[0]),
       t(iso(at(3, 14))), t(iso(new Date(at(3, 14).getTime() + 90 * 60000))), f(groomSvc[1]), t(now), t(now)]),
    // A 3-night stay starting in two days, in a room.
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,paid,roomId,depositRM,createdAt,updatedAt)
          VALUES (?,?,?, 'Boarding', ?,?,?, 'Scheduled', ?, 0, ?, 50, ?, ?)`,
      [t(`${MARK}-b1`), t(`${MARK}-c`), t(`${MARK}-cat`), t(boardSvc[0]),
       t(iso(at(2, 12))), t(iso(at(5, 12))), f(nightly * 3), t(room[0]), t(now), t(now)]),
    // One left alone, so the detail page can be inspected with its controls on.
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?,?,?, 'Scheduled', ?, 0, ?, ?)`,
      [t(`${MARK}-a3`), t(`${MARK}-c`), t(`${MARK}-cat`), t(groomSvc[0]),
       t(iso(at(6, 10))), t(iso(new Date(at(6, 10).getTime() + 90 * 60000))), f(groomSvc[1]), t(now), t(now)]),
    // Something already finished — must be immovable.
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?,?,?, 'Completed', ?, 1, ?, ?)`,
      [t(`${MARK}-done`), t(`${MARK}-c`), t(`${MARK}-cat`), t(groomSvc[0]),
       t(iso(at(-6, 11))), t(iso(at(-6, 12))), f(groomSvc[1]), t(now), t(now)]),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const get = async path => (await fetch(`${BASE}${path}`, { headers: { cookie } })).text()

  // ══ 1. The agenda — no date hunting ══
  let html = await get('/appointments')
  check('the diary opens without a date in the URL', html.includes('Appointments'))
  check('today\'s booking is there', html.includes(`${MARK}Cat`))
  check('days are labelled relatively, not just as dates', /Today/.test(html))
  check('…and a later day is named too', /Tomorrow|[A-Z][a-z]+day/.test(html))
  check('several days are shown at once, not one', (html.match(/booking(s)? *<\/span>|bookings</g) ?? []).length > 1
    || /Today[\s\S]{0,4000}?booking/.test(html))
  check('the future stay appears alongside today', html.includes('Boarding'))
  check('past bookings are NOT in the upcoming view',
    !html.includes(`${MARK}-done`), 'a completed booking leaked into upcoming')

  const past = await get('/appointments?view=past')
  check('the past view exists and is separate', past.includes('Appointments'))

  const day = await get(`/appointments?date=${iso(at(3, 14)).slice(0, 10)}`)
  check('a single day can still be asked for', day.includes(`${MARK}Cat`))

  // A filter must survive switching view, or narrowing then navigating lies.
  const filtered = await get('/appointments?view=upcoming&type=Boarding')
  check('filtering to Boarding hides the grooms',
    filtered.includes('Boarding') && !/Grooming<\/span>/.test(filtered), 'type filter not applied')

  // ══ 2. Action ids (Turbopack dev chunks) ══
  const listHtml = await get('/appointments')
  const srcs = [...listHtml.matchAll(/src="(\/_next\/[^"]+\.js[^"]*)"/g)].map(m => m[1])
  const ids = {}
  for (const src of srcs) {
    const js = await (await fetch(`${BASE}${src.replace(/&amp;/g, '&')}`)).text()
    if (!js.includes('$$RSC_SERVER_ACTION')) continue
    const nameToVar = {}
    for (const m of js.matchAll(/"(cancelAppointment|rescheduleAppointment|freeRoomsForMove)",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/g)) nameToVar[m[1]] = m[2]
    const varToHex = {}
    for (const m of js.matchAll(/const (\$\$RSC_SERVER_ACTION_\d+)[\s\S]{0,2000}?"([0-9a-f]{40,})"/g)) varToHex[m[1]] ??= m[2]
    for (const [name, v] of Object.entries(nameToVar)) if (varToHex[v]) ids[name] = varToHex[v]
  }
  check('found the cancel and move action ids',
    !!(ids.cancelAppointment && ids.rescheduleAppointment), JSON.stringify(Object.keys(ids)))

  // A server-action POST replies with the action's return value AND a re-render
  // of the page. Searching the whole body for a word finds it in the markup —
  // the cancel dialog contains the string "deposit" on every response — so the
  // returned value is pulled out and asserted on by itself.
  const resultOf = text => {
    const m = text.match(/\{"ok":(?:true|false)(?:[^\n]*?)\}/)
    return m ? m[0] : ''
  }

  const call = async (name, args) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${BASE}/appointments`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Next-Action': ids[name], 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(args),
      })
      const text = await r.text()
      if (r.status !== 404 || attempt >= 5) return { status: r.status, text, result: resultOf(text) }
      await new Promise(res => setTimeout(res, 900))
    }
  }

  // ══ 3. Moving a boarding stay REPRICES it ══
  const priceBefore = Number((await one(`SELECT price FROM "Appointment" WHERE id = ?`, [t(`${MARK}-b1`)]))[0][0])
  check(`the 3-night stay is RM ${nightly * 3}`, priceBefore === nightly * 3, String(priceBefore))

  const extend = await call('rescheduleAppointment', [{
    id: `${MARK}-b1`,
    startISO: at(2, 12).toISOString(),
    endISO: at(7, 12).toISOString(),   // 3 nights → 5
    roomId: room[0],
  }])
  check('the move is accepted', extend.status === 200, `status ${extend.status}`)

  const after = await one(`SELECT price, endsAt, rescheduledAt, rescheduledFrom FROM "Appointment" WHERE id = ?`, [t(`${MARK}-b1`)])
  check(`extending 3 nights → 5 REPRICES to RM ${nightly * 5}`,
    Number(after[0][0]) === nightly * 5, `price is ${after[0][0]}`)
  check('the new check-out is stored', String(after[0][1]).startsWith(at(7, 12).toISOString().slice(0, 10)), String(after[0][1]))
  check('the move is stamped', !!after[0][2])
  check('…and the ORIGINAL date is kept, for the dispute later', !!after[0][3], String(after[0][3]))

  const moveAudit = await one(`SELECT summary FROM "AuditLog" WHERE entityId = ? AND action = 'appointment.reschedule'`, [t(`${MARK}-b1`)])
  check('the move is audited from BOTH sides', moveAudit.length === 1 && /→/.test(String(moveAudit[0][0])), JSON.stringify(moveAudit))

  // Moving again must not overwrite the original date.
  const originalFrom = String(after[0][3])
  await call('rescheduleAppointment', [{
    id: `${MARK}-b1`, startISO: at(3, 12).toISOString(), endISO: at(6, 12).toISOString(), roomId: room[0],
  }])
  const twice = await one(`SELECT rescheduledFrom, price FROM "Appointment" WHERE id = ?`, [t(`${MARK}-b1`)])
  check('a second move keeps the FIRST original date',
    String(twice[0][0]) === originalFrom, `${twice[0][0]} vs ${originalFrom}`)
  check(`…and reprices again (3 nights → RM ${nightly * 3})`, Number(twice[0][1]) === nightly * 3, String(twice[0][1]))

  // ══ 4. A stay must not clash with ITSELF ══
  //
  // A room at capacity 2 holding only our own stay cannot tell the two
  // implementations apart. Putting exactly ONE other cat in it can: excluding
  // ourselves the room holds 1 of 2 and the move is fine; counting ourselves it
  // reads 2 of 2 and a broken version refuses. Then a second cat genuinely
  // fills it and the move must be refused for real.
  const capacity = Number(room[2])
  check('the test room holds 2', capacity === 2, String(capacity))

  // Far enough out that the seeded demo diary has nothing in this room: the
  // first attempt at this test used next week and failed because a real seeded
  // stay was already occupying the room, which reads exactly like a bug in the
  // capacity check. An occupancy test has to own the window it asserts on.
  const [WIN_IN, WIN_OUT] = [200, 203]
  const preexisting = await one(
    `SELECT COUNT(*) FROM "Appointment" WHERE roomId = ? AND status NOT IN ('Cancelled','NoShow','Completed')
       AND scheduledAt < ? AND (endsAt > ? OR endsAt IS NULL)`,
    [t(room[0]), t(iso(at(WIN_OUT, 12))), t(iso(at(WIN_IN, 12)))])
  check('the test window is empty to begin with', Number(preexisting[0][0]) === 0, String(preexisting[0][0]))

  const otherCat = async n => {
    await pipe([exec(
      `INSERT INTO "Appointment" (id,customerId,catId,type,serviceId,scheduledAt,endsAt,status,price,paid,roomId,createdAt,updatedAt)
       VALUES (?,?,?, 'Boarding', ?,?,?, 'Scheduled', ?, 0, ?, ?, ?)`,
      [t(`${MARK}-o${n}`), t(`${MARK}-c`), t(`${MARK}-cat`), t(boardSvc[0]),
       t(iso(at(WIN_IN, 12))), t(iso(at(WIN_OUT, 12))), f(nightly * 3), t(room[0]), t(now), t(now)])])
  }
  const moveIntoWindow = () => call('rescheduleAppointment', [{
    id: `${MARK}-b1`,
    startISO: at(WIN_IN, 12).toISOString(),
    endISO: at(WIN_OUT, 12).toISOString(),
    roomId: room[0],
  }])

  await otherCat(1)
  const withOne = await moveIntoWindow()
  check('with one other cat in a 2-cat room, the stay can still be moved — it does not clash with itself',
    withOne.status === 200 && !/full/i.test(withOne.result), withOne.result)

  await otherCat(2)
  const withTwo = await moveIntoWindow()
  check('…but a genuinely full room IS refused', /full/i.test(withTwo.result), withTwo.result)

  await pipe([exec(`DELETE FROM "Appointment" WHERE id IN ('${MARK}-o1','${MARK}-o2')`)])

  // ══ 5. Terminal bookings cannot be changed ══
  const moveDone = await call('rescheduleAppointment', [{
    id: `${MARK}-done`, startISO: at(9, 11).toISOString(),
  }])
  const doneRow = await one(`SELECT scheduledAt FROM "Appointment" WHERE id = ?`, [t(`${MARK}-done`)])
  check('a completed booking is refused, not moved',
    String(doneRow[0][0]).startsWith(at(-6, 11).toISOString().slice(0, 10)),
    `completed booking moved to ${doneRow[0][0]}`)
  check('…and the refusal is reported rather than silent', /cannot be moved|completed/i.test(moveDone.result))

  // ══ 6. Cancelling ══
  const badReason = await call('cancelAppointment', [`${MARK}-a1`, 'not a real reason', ''])
  const stillThere = await one(`SELECT status FROM "Appointment" WHERE id = ?`, [t(`${MARK}-a1`)])
  check('an unlisted cancellation reason is refused',
    String(stillThere[0][0]) === 'Scheduled', `status became ${stillThere[0][0]}`)
  check('…and says so', /reason/i.test(badReason.result))

  const cancelled = await call('cancelAppointment', [`${MARK}-a1`, 'Cat unwell', 'Sneezing since Tuesday'])
  check('a listed reason is accepted', cancelled.status === 200)
  const cRow = await one(`SELECT status, cancelReason, cancelNote, cancelledAt FROM "Appointment" WHERE id = ?`, [t(`${MARK}-a1`)])
  check('the booking is cancelled', String(cRow[0][0]) === 'Cancelled', String(cRow[0][0]))
  check('the reason is stored ON THE ROW, so it can be grouped later',
    String(cRow[0][1]) === 'Cat unwell', String(cRow[0][1]))
  check('the note is kept', String(cRow[0][2]) === 'Sneezing since Tuesday', String(cRow[0][2]))
  check('the time is stamped', !!cRow[0][3])

  const cancelAudit = await one(`SELECT summary FROM "AuditLog" WHERE entityId = ? AND action = 'appointment.cancel'`, [t(`${MARK}-a1`)])
  check('the cancellation is audited', cancelAudit.length === 1, JSON.stringify(cancelAudit))

  // The deposit is money already received — cancelling must not reverse it,
  // and must not stay quiet about it either.
  const depositRow = await one(`SELECT depositRM FROM "Appointment" WHERE id = ?`, [t(`${MARK}-b1`)])
  check('the stay carries a deposit', Number(depositRow[0][0]) === 50, String(depositRow[0][0]))

  const depositCancel = await call('cancelAppointment', [`${MARK}-b1`, 'Customer cancelled', ''])
  const afterCancel = await one(`SELECT status, depositRM FROM "Appointment" WHERE id = ?`, [t(`${MARK}-b1`)])
  check('cancelling a stay with a deposit does NOT silently reverse the money',
    Number(afterCancel[0][1]) === 50, `deposit changed to ${afterCancel[0][1]}`)
  const depositTxn = await one(
    `SELECT COUNT(*) FROM "Transaction" WHERE reference = ?`, [t(`DEP-${`${MARK}-b1`.slice(-8).toUpperCase()}`)])
  check('…and no reversing transaction is invented', Number(depositTxn[0][0]) === 0, String(depositTxn[0][0]))
  check('…while the reply tells staff the deposit still needs settling',
    /deposit/i.test(depositCancel.result), depositCancel.result)

  // A cancellation with no deposit must NOT mention one.
  const plainCancel = await call('cancelAppointment', [`${MARK}-a2`, 'Customer cancelled', ''])
  check('a cancellation without a deposit says nothing about deposits',
    !/deposit/i.test(plainCancel.result), plainCancel.result)

  const reCancel = await call('cancelAppointment', [`${MARK}-b1`, 'Customer cancelled', ''])
  check('an already-cancelled booking cannot be cancelled twice', /already/i.test(reCancel.result), reCancel.result)

  // A cancelled booking disappears from the upcoming diary's actionable rows.
  html = await get('/appointments')
  check('a cancelled booking still shows, marked, rather than vanishing',
    html.includes('Cancelled'), 'cancelled bookings vanished from the diary')

  // ══ 6b. One way to cancel, not two ══
  // The detail page used to offer Cancelled as a one-click status button, which
  // would set the status with no reason at all — a second cancel path that
  // quietly skips everything section 6 just proved.
  const detail = await get(`/appointments/${MARK}-a3`)
  check('the detail page offers Move and Cancel', /Change this booking/.test(detail), 'no change controls on the detail page')
  check('…and no longer has a reasonless Cancelled status button',
    !/name="status" value="Cancelled"/.test(detail), 'the bypass status button is still there')

  const cancelledDetail = await get(`/appointments/${MARK}-a1`)
  check('a cancelled booking shows why it was cancelled',
    /Cat unwell/.test(cancelledDetail), 'the reason is not shown back to the reader')

  // ══ 7. Registering a walk-in without leaving the booking ══
  const newHtml = await get('/appointments/new')
  check('the booking page offers a new customer', /New customer/.test(newHtml), 'no new-customer affordance')

  const bookSrcs = [...newHtml.matchAll(/src="(\/_next\/[^"]+\.js[^"]*)"/g)].map(m => m[1])
  let createId = null
  for (const src of bookSrcs) {
    const js = await (await fetch(`${BASE}${src.replace(/&amp;/g, '&')}`)).text()
    if (!js.includes('$$RSC_SERVER_ACTION')) continue
    const nameToVar = {}
    for (const m of js.matchAll(/"(createCustomerWithCat)",\s*\(\)=>(\$\$RSC_SERVER_ACTION_\d+)/g)) nameToVar[m[1]] = m[2]
    const varToHex = {}
    for (const m of js.matchAll(/const (\$\$RSC_SERVER_ACTION_\d+)[\s\S]{0,2000}?"([0-9a-f]{40,})"/g)) varToHex[m[1]] ??= m[2]
    if (nameToVar.createCustomerWithCat && varToHex[nameToVar.createCustomerWithCat]) {
      createId = varToHex[nameToVar.createCustomerWithCat]
    }
  }
  check('found the register action', !!createId)

  // Stop here rather than firing the registrations at a null action id.
  //
  // `$$RSC_SERVER_ACTION` symbols only exist in a Turbopack DEV build
  // (AGENTS.md technique B), so against `next start` this id is always null,
  // every register() call is a no-op, and the first assertion that reads the
  // customer back died on `madeCust[0]` being undefined — a TypeError twenty
  // lines from the real cause, which also skipped the remaining checks and made
  // an environment mismatch look like a broken booking flow. It cost a release
  // review to diagnose. Fail as a sentence instead.
  if (!createId) {
    console.log('\n  ! The registration checks need `node scripts/dev-turso-demo.mjs`.')
    console.log('    They drive a server action by its dev-build symbol, which a')
    console.log('    production build does not ship. Skipped, not passed.')
    console.log(`\n${pass}/${total} passed (registration section skipped)`)
    process.exitCode = 1
    throw new SkipRest()
  }

  const register = async payload => {
    const r = await fetch(`${BASE}/appointments/new`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Next-Action': createId, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify([JSON.stringify(payload)]),
    })
    return { status: r.status, text: await r.text() }
  }

  const noCat = await register({ phone: '0177000001', name: 'No Cat', catName: '', marketingConsent: false })
  check('a household with no cat is refused — a booking is for a cat', /cat/i.test(noCat.text.match(/"error":"[^"]*"/)?.[0] ?? noCat.text))

  const created = await register({
    phone: '017-700 0001', name: 'Walk In Wong', catName: 'Pepper', breed: 'Ragdoll', marketingConsent: true,
  })
  check('a walk-in can be registered mid-booking', created.status === 200)
  const madeCust = await one(`SELECT id, name, marketingConsent FROM "Customer" WHERE phone = '60177000001'`)
  check('the phone number is normalised to 60…', madeCust.length === 1, JSON.stringify(madeCust))
  check('consent is recorded when given', String(madeCust[0][2]) === '1', String(madeCust[0][2]))
  const madeCat = await one(`SELECT name, breed FROM "Cat" WHERE customerId = ?`, [t(madeCust[0][0])])
  check('the first cat is created with them', madeCat.length === 1 && String(madeCat[0][0]) === 'Pepper', JSON.stringify(madeCat))

  // The realistic failure: a returning customer nobody recognised.
  const again = await register({ phone: '0177000001', name: 'Different Name', catName: 'Pepper', marketingConsent: false })
  check('a number already on file is NOT an error', again.status === 200)
  const dupCust = await one(`SELECT COUNT(*) FROM "Customer" WHERE phone = '60177000001'`)
  check('…no duplicate household is created', Number(dupCust[0][0]) === 1, String(dupCust[0][0]))
  const dupCat = await one(`SELECT COUNT(*) FROM "Cat" WHERE customerId = ?`, [t(madeCust[0][0])])
  check('…and the same cat name is reused, not duplicated', Number(dupCat[0][0]) === 1, String(dupCat[0][0]))
  check('…and the existing household is flagged as existing', /"existing":true/.test(again.text.replace(/\\/g, '')),
    again.text.slice(0, 200))

  const consentAfter = await one(`SELECT marketingConsent FROM "Customer" WHERE phone = '60177000001'`)
  check('re-registering does NOT quietly revoke their marketing consent',
    String(consentAfter[0][0]) === '1', `consent became ${consentAfter[0][0]}`)

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} catch (e) {
  // A deliberate early stop is not a crash. Anything else still is.
  if (!(e instanceof SkipRest)) throw e
} finally {
  await cleanup()
  console.log('cleaned up')
}
