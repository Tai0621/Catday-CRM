// End-to-end verification for the Operations & Sales round.
// Inserts temp staff / appointment / boarding rows via Turso, exercises the new
// pages over HTTP (manager + staff sessions), then removes every temp row.
// Usage: node scripts/verify-opsales.mjs [baseUrl]   (default http://localhost:3100)
import 'dotenv/config'
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

const hash = s => createHash('sha256').update(`catday:${s}`).digest('hex')
const managerCookie = 'auth=' + hash(process.env.APP_PASSWORD)

async function get(path, cookie) {
  const r = await fetch(BASE + path, { headers: { Cookie: cookie }, redirect: 'manual' })
  return { status: r.status, loc: r.headers.get('location') ?? '', text: r.status === 200 ? await r.text() : '' }
}
const mark = (ok) => ok ? '✓' : '✗'

const stamp = Date.now().toString(36)
const ids = {
  staff: 'vstaff' + stamp, cat: 'vcat' + stamp, cat2: 'vcat2' + stamp,
  appt: 'vappt' + stamp, board: 'vboard' + stamp, room: 'vroom' + stamp,
}
const PIN = 'vp' + stamp // unique throwaway PIN

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
  await sql({ sql: `INSERT INTO Cat (id,name,customerId,coatType,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.cat },{ type:'text',value:'Verify GroomCat' },{ type:'text',value:customerId },{ type:'text',value:'Long' }] })
  await sql({ sql: `INSERT INTO Cat (id,name,customerId,careNotes,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    args: [{ type:'text',value:ids.cat2 },{ type:'text',value:'Verify BoardCat' },{ type:'text',value:customerId },{ type:'text',value:'Feed twice daily' }] })
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

  // 3) staff can use the board & runsheet
  const board = await get('/board', staffCookie)
  console.log(`Staff /board -> ${board.status} card:${mark(board.text.includes('Verify GroomCat'))} loggedInAs:${mark(board.text.includes('Verify Groomer'))}`)
  const run = await get('/runsheet', staffCookie)
  console.log(`Staff /runsheet -> ${run.status} room:${mark(run.text.includes('Verify Room'))} careNotes:${mark(run.text.includes('Feed twice daily'))} tasks:${mark(run.text.includes('Morning feeding') && run.text.includes('Medication'))}`)

  // 4) manager pages
  for (const [path, marker] of [
    ['/staff', 'Verify Groomer'], ['/services', 'Full Groom'], ['/cashup', 'Expected money in'],
    ['/pos', 'POS Checkout'], ['/rooms/calendar', 'Verify Room'], ['/board', 'Verify GroomCat'],
  ]) {
    const r = await get(path, managerCookie)
    console.log(`Manager ${path} -> ${r.status} ${mark(r.status === 200 && r.text.includes(marker))}`)
  }

  // 5) slot checker
  const today = new Date().toISOString().slice(0, 10)
  const slots = await get(`/appointments/new?slotDate=${today}`, managerCookie)
  console.log(`Slot checker -> ${slots.status} ${mark(slots.status === 200 && (slots.text.includes('open start times') || slots.text.includes('No open slots')))}`)
} finally {
  await sql({ sql: `DELETE FROM CareTask WHERE appointmentId IN (?,?)`, args: [{ type:'text',value:ids.appt },{ type:'text',value:ids.board }] })
  await sql({ sql: `DELETE FROM Appointment WHERE id IN (?,?)`, args: [{ type:'text',value:ids.appt },{ type:'text',value:ids.board }] })
  await sql({ sql: `DELETE FROM Cat WHERE id IN (?,?)`, args: [{ type:'text',value:ids.cat },{ type:'text',value:ids.cat2 }] })
  await sql({ sql: `DELETE FROM Room WHERE id = ?`, args: [{ type:'text',value:ids.room }] })
  await sql({ sql: `DELETE FROM Staff WHERE id = ?`, args: [{ type:'text',value:ids.staff }] })
  console.log('Temp rows removed.')
}
