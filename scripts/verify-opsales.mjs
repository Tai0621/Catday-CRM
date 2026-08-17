// End-to-end verification for the Operations & Sales round.
// Inserts temp staff / appointment / boarding rows via Turso, exercises the new
// pages over HTTP (manager + staff sessions), then removes every temp row.
// Usage: node scripts/verify-opsales.mjs [baseUrl]   (default http://localhost:3100)
import 'dotenv/config'
import './_guard.mjs'

// These two suites report with inline ✓/✗ rather than a check() helper, so they
// had no score line and the release runner graded them as crashes. Tally the
// marks as they are printed and emit one — cheaper and less risky than
// rewriting two working suites, and it makes them countable like the rest.
let __ticks = 0, __crosses = 0
const __log = console.log
console.log = (...a) => {
  const s = a.map(String).join(' ')
  __ticks += (s.match(/✓/g) ?? []).length
  __crosses += (s.match(/✗/g) ?? []).length
  __log(...a)
}
process.on('exit', () => {
  const total = __ticks + __crosses
  if (total > 0) __log(`\n${__ticks}/${total} checks passed`)
  if (__crosses > 0) process.exitCode = 1
})

import { createHash } from 'crypto'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function sql(stmt) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] }),
  })
  const json = await res.json()
  const r = json.results?.[0]
  if (r?.type === 'error') throw new Error(r.error?.message)
  return r?.response?.result
}

const hash = s => createHash('sha256').update(`catday:${s}`).digest('hex') // legacy PIN hash for seeding (verifyPassword upgrades it on login)
const mgrLogin = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
})
const managerCookie = (mgrLogin.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0] ?? ''

async function get(path, cookie) {
  const r = await fetch(BASE + path, { headers: { Cookie: cookie }, redirect: 'manual' })
  // See verify-ops: React's SSR comment markers break literal matches.
  const body = r.status === 200 ? (await r.text()).replace(/<!--[\s\S]*?-->/g, '') : ''
  return { status: r.status, loc: r.headers.get('location') ?? '', text: body }
}
const mark = (ok) => ok ? '✓' : '✗'

const stamp = Date.now().toString(36)
const ids = {
  staff: 'vstaff' + stamp, cat: 'vcat' + stamp, cat2: 'vcat2' + stamp,
  appt: 'vappt' + stamp, board: 'vboard' + stamp, room: 'vroom' + stamp,
  carer: 'vcarer' + stamp,
}
const PIN = 'vp' + stamp // unique throwaway PIN (Groomer)
// A second carer, because roles are narrow now: a Groomer holds /board and
// /cats, a Boarding carer holds /runsheet. One staff member cannot exercise
// both, and asserting they can was testing a permission model that no longer
// exists — the 307 it produced was the app being right.
const CARER_PIN = 'vc' + stamp

const cust = await sql({ sql: 'SELECT id, phone FROM Customer LIMIT 1' })
const customerId = cust?.rows?.[0]?.[0]?.value
if (!customerId) { console.log('No customer in DB — cannot verify'); process.exit(1) }

const nowIso = new Date().toISOString()
const in2h = new Date(Date.now() + 2 * 3600e3).toISOString()
const tmrw = new Date(Date.now() + 26 * 3600e3).toISOString()

try {
  // temp rows
  await sql({ sql: `INSERT INTO Staff (id,name,role,pinHash,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.staff },{ type:'text',value:'Verify Groomer' },{ type:'text',value:'Groomer' },{ type:'text',value:hash(PIN) }] })
  await sql({ sql: `INSERT INTO Staff (id,name,role,pinHash,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.carer },{ type:'text',value:'Verify Carer' },{ type:'text',value:'Boarding' },{ type:'text',value:hash(CARER_PIN) }] })
  await sql({ sql: `INSERT INTO Cat (id,name,customerId,coatType,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.cat },{ type:'text',value:'Verify GroomCat' },{ type:'text',value:customerId },{ type:'text',value:'Long' }] })
  // `medication` is seeded because the run sheet only generates a Medication
  // task for a cat that actually has one — careTasksForStay reads the field.
  // Asserting the task existed on a cat with no medication was asking the app
  // to invent one.
  await sql({ sql: `INSERT INTO Cat (id,name,customerId,careNotes,medication,createdAt,updatedAt) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.cat2 },{ type:'text',value:'Verify BoardCat' },{ type:'text',value:customerId },{ type:'text',value:'Feed twice daily' },{ type:'text',value:'Amoxicillin 0.5ml' }] })
  await sql({ sql: `INSERT INTO Room (id,name,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.room },{ type:'text',value:'Verify Room ' + stamp }] })
  await sql({ sql: `INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,updatedAt) VALUES (?,?,?,?,?,?,'Scheduled',CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.appt },{ type:'text',value:customerId },{ type:'text',value:ids.cat },{ type:'text',value:'Grooming' },{ type:'text',value:nowIso },{ type:'text',value:in2h }] })
  await sql({ sql: `INSERT INTO Appointment (id,customerId,catId,type,roomId,scheduledAt,endsAt,status,updatedAt) VALUES (?,?,?,?,?,?,?,'CheckedIn',CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.board },{ type:'text',value:customerId },{ type:'text',value:ids.cat2 },{ type:'text',value:'Boarding' },{ type:'text',value:ids.room },{ type:'text',value:nowIso },{ type:'text',value:tmrw }] })

  // 1) staff PIN login
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: PIN }).toString(),
    redirect: 'manual',
  })
  const staffLoc = (login.headers.get('location') ?? '').replace(BASE, '')
  const setCookie = login.headers.get('set-cookie') ?? ''
  const staffCookie = setCookie.split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0] ?? ''
  console.log(`Staff PIN login -> ${login.status} to ${staffLoc || '(none)'} ${mark(login.status === 307 && staffLoc === '/board' && !!staffCookie)}`)

  // 2) staff blocked from manager pages
  const dash = await get('/', staffCookie)
  const rev = await get('/revenue', staffCookie)
  console.log(`Staff / -> ${dash.status} ${dash.loc.replace(BASE,'')} ${mark(dash.status === 307 && dash.loc.includes('/board'))} · /revenue -> ${rev.status} ${mark(rev.status === 307 && rev.loc.includes('/board'))}`)

  // 3) each role reaches its OWN screen, and only its own
  const board = await get('/board', staffCookie)
  console.log(`Groomer /board -> ${board.status} card:${mark(board.text.includes('Verify GroomCat'))} loggedInAs:${mark(board.text.includes('Verify Groomer'))}`)

  // A groomer holds /board and /cats — not the run sheet. That refusal is the
  // roles model working, so assert it rather than treating it as a failure.
  const groomerRun = await get('/runsheet', staffCookie)
  console.log(`Groomer /runsheet -> ${groomerRun.status} refused:${mark(groomerRun.status === 307)}`)

  const carerLogin = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: CARER_PIN }).toString(),
    redirect: 'manual',
  })
  const carerCookie = (carerLogin.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0] ?? ''
  console.log(`Carer PIN login -> ${carerLogin.status} ${mark(!!carerCookie)}`)

  const run = await get('/runsheet', carerCookie)
  console.log(`Carer /runsheet -> ${run.status} room:${mark(run.text.includes('Verify Room'))} careNotes:${mark(run.text.includes('Feed twice daily'))} tasks:${mark(run.text.includes('Feed — morning') && run.text.includes('Medication: Amoxicillin'))}`)

  // 4) manager pages
  for (const [path, marker] of [
    ['/staff', 'Verify Groomer'], ['/services', 'Full Groom'], ['/cashup', 'Expected money in'],
    ['/pos', 'POS Checkout'], ['/rooms/calendar', 'Verify Room'], ['/board', 'Verify GroomCat'],
  ]) {
    const r = await get(path, managerCookie)
    console.log(`Manager ${path} -> ${r.status} ${mark(r.status === 200 && r.text.includes(marker))}`)
  }

  // 5) the booking screen loads with the fields a booking needs
  //
  // It used to assert the copy "open start times" / "No open slots" against a
  // ?slotDate= query. Neither exists any more: open times are fetched by the
  // client after a service and date are chosen, so the server-rendered page
  // never contains them and the check could only fail. What the slot ENGINE
  // does is proven properly by verify-booking-lanes, which drives fetchSlots
  // through the real action — duplicating it here as a copy match added no
  // coverage and one permanent red mark.
  const booking = await get('/appointments/new', managerCookie)
  console.log(`Booking screen -> ${booking.status} ${mark(booking.status === 200
    && booking.text.includes('Customer') && booking.text.includes('Service') && booking.text.includes('Date'))}`)
} finally {
  await sql({ sql: `DELETE FROM CareTask WHERE appointmentId IN (?,?)`, args: [{ type:'text',value:ids.appt },{ type:'text',value:ids.board }] })
  await sql({ sql: `DELETE FROM Appointment WHERE id IN (?,?)`, args: [{ type:'text',value:ids.appt },{ type:'text',value:ids.board }] })
  await sql({ sql: `DELETE FROM Cat WHERE id IN (?,?)`, args: [{ type:'text',value:ids.cat },{ type:'text',value:ids.cat2 }] })
  await sql({ sql: `DELETE FROM Room WHERE id = ?`, args: [{ type:'text',value:ids.room }] })
  await sql({ sql: `DELETE FROM Staff WHERE id IN (?,?)`, args: [{ type:'text',value:ids.staff },{ type:'text',value:ids.carer }] })
  console.log('Temp rows removed.')
}
