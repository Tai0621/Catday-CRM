import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 1 visual foundation:
//  • Service board renders a distinct colour per stage (all 5 stage colours present)
//  • Room calendar flags a boarding stay whose cat also has grooming in the
//    window (✂ + grooming accent), and marks today / weekend structure
// Seeds a customer/cat/room + a grooming appt today + a boarding stay covering
// today. Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYVIS'
const DAY = 24 * 60 * 60 * 1000

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
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

const custId = crypto.randomUUID(), catId = crypto.randomUUID(), roomId = crypto.randomUUID()
const groomId = crypto.randomUUID(), boardId = crypto.randomUUID()
const now = new Date()
const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString()
const plus4 = new Date(now.getTime() + 4 * DAY).toISOString()

// stage colours from lib/constants.ts BOARD_STAGE_COLORS
const STAGE_COLORS = ['#8A7A5E', '#729094', '#B14919', '#B8902B', '#5F7A3F']
const SEG_GROOM = '#B14919' // lib/segments.ts SEGMENTS.grooming.color

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Appointment WHERE id IN (?,?)`, [t(groomId), t(boardId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Room WHERE id = ?`, [t(roomId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60129990001')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catId), t(custId), t(`${MARK}Mochi`)]),
    exec(`INSERT INTO Room (id,name,type,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,?,999,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomId), t(`${MARK} Suite`), t('Suite'), t('Available')]),
    // grooming appt today → shows on the board
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?, 'Scheduled', ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(groomId), t(custId), t(catId), t(todayNoon), f(180)]),
    // boarding stay today → +4 days, room assigned → shows on the calendar
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?, 'CheckedIn', ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(boardId), t(custId), t(catId), t(todayNoon), t(plus4), t(roomId), f(400)]),
  ])
  console.log('seeded a grooming appt (today) + a boarding stay (today→+4) for the same cat')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Service board: per-stage colours ──
  const board = await getHtml('/board')
  check('board shows the seeded grooming cat', board.includes(`${MARK}Mochi`))
  for (const c of STAGE_COLORS) check(`board uses stage colour ${c}`, board.includes(c), 'colour missing')
  check('board colours are distinct (5 unique)', new Set(STAGE_COLORS).size === 5)

  // ── Room calendar: grooming link + week structure ──
  const cal = await getHtml('/rooms/calendar')
  check('calendar shows the boarding stay', cal.includes(`${MARK}Mochi`))
  check('calendar flags the grooming cross-over (✂)', cal.includes('✂'))
  check('calendar uses the grooming accent colour', cal.includes(SEG_GROOM))
  check('calendar marks Today', cal.includes('Today'))
  check('calendar tints the today column', cal.includes('rgba(177,73,25,0.10)'))
  check('calendar has a legend (boarding / grooming / today)', cal.includes('grooming') && cal.includes('boarding'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
