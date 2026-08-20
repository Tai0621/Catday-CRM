import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for the Boarding Wall.
//
// The claims under test, in the order they matter:
//  • every active room appears exactly once — placed on its bank, or in the
//    Unplaced strip. A room the screen does not draw is the failure mode that
//    could get a cat missed on a round, so it is the first assertion.
//  • a checked-in cat shows on its unit, and the unit links to that room
//  • the date strip repaints: a booking three days out shows on that day and
//    NOT today
//  • a staging cubby is not counted as bookable capacity
//  • the room page opens on the STAY, not the settings form, and settings are
//    manager-only
//  • the arrange screen refuses to put two rooms in one cell

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYWALL'

const t = v => ({ type: 'text', value: String(v) })
const int = v => ({ type: 'integer', value: String(v) })
const mark = ok => (ok ? '✓' : '✗')

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`)
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const rows = async (sql, args = []) => (await pipe([exec(sql, args)]))[0].response.result.rows
const scalar = async (sql, args = []) => (await rows(sql, args))[0]?.[0]?.value

const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const iso = d => d.toISOString()
const dayKey = d => {
  // The wall keys days in the business timezone (UTC+8), so build the key the
  // same way — a UTC date here would be yesterday for half the working day.
  const shifted = new Date(d.getTime() + 8 * 3600_000)
  return shifted.toISOString().slice(0, 10)
}

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const catId2 = crypto.randomUUID()
const zoneId = crypto.randomUUID()
const roomA = crypto.randomUUID(), roomB = crypto.randomUUID(), roomOrphan = crypto.randomUUID()
const stayNow = crypto.randomUUID(), stayLater = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM CareTask WHERE appointmentId IN (?,?)`, [t(stayNow), t(stayLater)]),
    exec(`DELETE FROM DailyCareLog WHERE appointmentId IN (?,?)`, [t(stayNow), t(stayLater)]),
    exec(`DELETE FROM Appointment WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Cat WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Room WHERE name LIKE ?`, [t(`${MARK}%`)]),
    exec(`DELETE FROM RoomZone WHERE code LIKE ?`, [t(`${MARK}%`)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
// Drop <script> bodies before stripping tags. Next serialises the page's props
// into the RSC flight payload inside <script>, so every room name is present a
// second time as data — stripping tags alone leaves that text and makes a
// "drawn exactly once" count read as a duplicate on every single room.
const strip = h => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')

// Technique A — replay every hidden input the real form rendered.
function formsIn(html) {
  const out = []
  for (const m of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
    const raw = m[0]
    const fields = {}
    for (const inp of raw.matchAll(/<(?:input|select)\b[^>]*>/gi)) {
      const tag = inp[0]
      const name = (tag.match(/\bname="([^"]*)"/) ?? [])[1]
      if (!name) continue
      fields[name] = (tag.match(/\bvalue="([^"]*)"/) ?? [, ''])[1]
    }
    out.push({ raw, fields, isAction: Object.keys(fields).some(k => k.startsWith('$ACTION_')) })
  }
  return out
}
const findForm = (html, needle) => formsIn(html).find(f => f.isAction && f.raw.includes(needle))
async function submitForm(url, form, overrides, cookie) {
  const body = new FormData()
  for (const [k, v] of Object.entries(form.fields)) body.append(k, v)
  for (const [k, v] of Object.entries(overrides)) body.set(k, String(v))
  return fetch(url, { method: 'POST', headers: { Cookie: cookie }, body, redirect: 'manual' })
}

try {
  await cleanup()

  const soon = new Date(now.getTime() + 3 * DAY)
  await pipe([
    exec(`INSERT INTO RoomZone (id, code, name, kind, cols, rows, sortOrder, createdAt, updatedAt)
          VALUES (?,?,?,'Boarding',2,1,900,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(zoneId), t(`${MARK}Z`), t(`${MARK} bank`)]),
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,zoneId,gridCol,gridRow,colSpan,rowSpan,unitKind,createdAt,updatedAt)
          VALUES (?,?,'Standard',2,'Available',901,1,?,1,1,1,1,'arch',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(roomA), t(`${MARK} A`), t(zoneId)]),
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,zoneId,gridCol,gridRow,colSpan,rowSpan,unitKind,createdAt,updatedAt)
          VALUES (?,?,'Standard',2,'Available',902,1,?,2,1,1,1,'arch',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(roomB), t(`${MARK} B`), t(zoneId)]),
    // Deliberately unplaced — it must still appear somewhere on the wall.
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,colSpan,rowSpan,unitKind,createdAt,updatedAt)
          VALUES (?,?,'Standard',2,'Available',903,1,1,1,'arch',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(roomOrphan), t(`${MARK} Orphan`)]),

    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,source,marketingConsent,needsDetails,isHouse,createdAt,updatedAt)
          VALUES (?,?,?,0,0,'WalkIn',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(custId), t(`${MARK} Cust`), t('+60100000777')]),
    exec(`INSERT INTO Cat (id,customerId,name,contentOptOut,createdAt,updatedAt) VALUES (?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(custId), t(`${MARK}Today`)]),
    exec(`INSERT INTO Cat (id,customerId,name,contentOptOut,createdAt,updatedAt) VALUES (?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId2), t(custId), t(`${MARK}Later`)]),

    // In room A now.
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?,'CheckedIn',?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(stayNow), t(custId), t(catId), t(iso(new Date(now.getTime() - DAY))), t(iso(new Date(now.getTime() + 2 * DAY))), t(roomA)]),
    // Booked into room B in three days — must NOT show today.
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?,'Scheduled',?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(stayLater), t(custId), t(catId2), t(iso(soon)), t(iso(new Date(soon.getTime() + DAY))), t(roomB)]),
  ])
  console.log('seeded a bank, three rooms and two stays')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const get = async url => (await fetch(`${BASE}${url}`, { headers: { Cookie: cookie } })).text()

  // ── every active room is drawn exactly once ──
  const wallHtml = await get('/rooms')
  const wall = strip(wallHtml)
  const active = await rows(`SELECT name FROM Room WHERE isActive = 1`)
  const names = active.map(r => r[0].value)
  const missing = names.filter(n => !wall.includes(n))
  check('every active room appears on the wall', missing.length === 0,
    `${missing.length} missing: ${missing.slice(0, 5).join(', ')}`)

  const countOf = n => (wall.match(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
  check('no room is drawn twice', names.every(n => countOf(n) === 1),
    names.filter(n => countOf(n) !== 1).slice(0, 4).join(', '))

  check('the seeded bank renders', wall.includes(`${MARK} bank`))
  check('an unplaced room still appears', wall.includes(`${MARK} Orphan`))
  check('…and is called out as unplaced', /Unplaced/.test(wall))

  // ── occupancy for the day being shown ──
  check('today shows the cat in room A', wall.includes(`${MARK}Today`))
  check('today does NOT show the booking three days out', !wall.includes(`${MARK}Later`))
  check('the unit links to its room', wallHtml.includes(`/rooms/${roomA}`))

  const laterKey = dayKey(soon)
  const later = strip(await get(`/rooms?date=${laterKey}`))
  check('the date strip repaints for a future day', later.includes(`${MARK}Later`), `looked for ${laterKey}`)
  check('…and the current stay has ended by then', !later.includes(`${MARK}Today`))

  // ── staging is not bookable capacity ──
  //
  // Measured as MOVEMENT, not as a figure. The wall's "Free" is not the count of
  // rows with status='Available' — a room whose standing status is stale but has
  // no booking today is correctly free — so comparing against a SQL count tests
  // the wrong thing. Adding a cubby and taking it away again tests the claim.
  const freeShown = async () => Number((strip(await get('/rooms')).match(/(\d+) Free/) ?? [])[1] ?? -1)
  const before = await freeShown()

  const stagingZone = crypto.randomUUID(), cubby = crypto.randomUUID()
  await pipe([
    exec(`INSERT INTO RoomZone (id, code, name, kind, cols, rows, sortOrder, createdAt, updatedAt)
          VALUES (?,?,?,'Staging',1,1,905,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(stagingZone), t(`${MARK}S`), t(`${MARK} staging`)]),
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,zoneId,gridCol,gridRow,colSpan,rowSpan,unitKind,createdAt,updatedAt)
          VALUES (?,?,'DayStay',1,'Available',906,1,?,1,1,1,1,'cubby',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(cubby), t(`${MARK} Cubby`), t(stagingZone)]),
  ])
  const withCubby = strip(await get('/rooms'))
  const afterAdd = Number((withCubby.match(/(\d+) Free/) ?? [])[1] ?? -1)

  check('a staging cubby is drawn on the wall', withCubby.includes(`${MARK} Cubby`))
  check('…but adds nothing to bookable capacity', afterAdd === before, `${before} → ${afterAdd}`)

  // A plain boarding room in the same position DOES count — otherwise the check
  // above would pass for a cubby that simply was not rendered at all.
  await pipe([exec(`UPDATE RoomZone SET kind = 'Boarding' WHERE id = ?`, [t(stagingZone)])])
  const asBoarding = await freeShown()
  check('…while the same unit as a boarding room does count', asBoarding === before + 1, `${before} → ${asBoarding}`)
  await pipe([
    exec(`DELETE FROM Room WHERE id = ?`, [t(cubby)]),
    exec(`DELETE FROM RoomZone WHERE id = ?`, [t(stagingZone)]),
  ])

  // ── the room opens on the stay, not the settings form ──
  const roomPage = strip(await get(`/rooms/${roomA}`))
  check('the room page names the cat', roomPage.includes(`${MARK}Today`))
  check('…shows today’s care rather than a settings form', /Today.s care/.test(roomPage))
  check('…and does NOT open on the edit form', !/Sort order|Capacity<\/label>/.test(roomPage))
  check('settings are one click away', (await get(`/rooms/${roomA}`)).includes(`/rooms/${roomA}/settings`))

  const staffTok = 'v3.not-a-real-token.deadbeef'
  const staffRes = await fetch(`${BASE}/rooms/${roomA}/settings`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  check('settings reject an invalid session', [302, 307].includes(staffRes.status))

  // ── arranging refuses to stack two rooms in one cell ──
  const arrangeHtml = await get('/rooms/arrange')
  check('the arrange screen lists the seeded room', strip(arrangeHtml).includes(`${MARK} A`))
  const form = findForm(arrangeHtml, `value="${roomB}"`)
  check('found the placement form for room B', !!form)
  if (form) {
    // Room A already owns cell 1,1 in this bank.
    const res = await submitForm(`${BASE}/rooms/arrange`, form,
      { zoneId, gridCol: 1, gridRow: 1, colSpan: 1, rowSpan: 1, unitKind: 'arch' }, cookie)
    const loc = res.headers.get('location') ?? ''
    check('placing two rooms in one cell is refused', /error=/.test(loc), `HTTP ${res.status} → ${loc.slice(0, 90)}`)
    const stillThere = await scalar(`SELECT gridCol FROM Room WHERE id = ?`, [t(roomB)])
    check('…and room B did not move', String(stillThere) === '2', String(stillThere))
  }

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
