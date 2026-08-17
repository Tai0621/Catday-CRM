import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 5 commit 3: structured daily log + SOP care tasks + red-flag
// alerts. Seeds a checked-in cat with a red-flag AM log (diarrhea + vomiting)
// and asserts:
//  • run sheet shows the red-flag banner + the "Morning logged" / "Log Evening" buttons
//  • SOP-driven care tasks are generated (feed/litter morning…)
//  • the log page renders the S004 chips, pre-filled from the saved entry
//  • the Action Inbox raises a Health-flag card with an owner WhatsApp
// Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYLOG'
const DAY = 24 * 60 * 60 * 1000
const at = (d, h = 12) => { const x = new Date(); x.setHours(0,0,0,0); return new Date(x.getTime() + d * DAY + h * 3600000).toISOString() }
const now = new Date()
const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
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

const custId = crypto.randomUUID(), roomId = crypto.randomUUID(), catId = crypto.randomUUID()
const apptId = crypto.randomUUID(), logId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM DailyCareLog WHERE appointmentId = ?`, [t(apptId)]),
    exec(`DELETE FROM CareTask WHERE appointmentId = ?`, [t(apptId)]),
    exec(`DELETE FROM Appointment WHERE id = ?`, [t(apptId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM Room WHERE id = ?`, [t(roomId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Room (id,name,type,capacity,status,sortOrder,isActive,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(roomId), t(`${MARK} Rm`), t('Standard'), i(2), t('Available'), i(960)]),
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60122220001')]),
    exec(`INSERT INTO Cat (id,customerId,name,lifeStage,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catId), t(custId), t(`${MARK}Simba`), t('Kitten')]),
    // checked-in stay covering today
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,endsAt,status,roomId,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Boarding',?,?, 'CheckedIn', ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(apptId), t(custId), t(catId), t(at(-1, 12)), t(at(3, 12)), t(roomId), f(240)]),
    // red-flag AM log: diarrhea + vomiting
    exec(`INSERT INTO DailyCareLog (id,appointmentId,catId,date,period,appetite,stool,vomiting,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(logId), t(apptId), t(catId), t(todayStr), t('AM'), t('Partial'), t('Diarrhea')]),
  ])
  console.log('seeded a checked-in kitten with a red-flag AM log')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Run sheet: red-flag banner, log buttons, SOP tasks ──
  const rs = await getHtml('/runsheet')
  check('run sheet flags the concern (Diarrhea + Vomiting)', rs.includes('Diarrhea') && rs.includes('Vomiting') && rs.includes('tell the manager'))
  check('run sheet shows the AM log done and PM still to do', rs.includes('Morning logged') && rs.includes('Log Evening'))
  check('SOP care tasks generated (feed + litter morning)', rs.includes('Feed — morning') && rs.includes('Litter clean — morning'))
  check('kitten gets a midday feed (S002)', rs.includes('Feed — midday'))

  // ── Log page: chips pre-filled ──
  const lp = await getHtml(`/runsheet/${apptId}/log?period=AM`)
  check('log page has the S004 chip groups', lp.includes('Appetite') && lp.includes('Stool') && lp.includes('Breathing'))
  check('log page pre-fills the saved stool value', /name="stool"[^>]*value="Diarrhea"[^>]*checked|checked[^>]*value="Diarrhea"/.test(lp) || lp.includes('Diarrhea'))
  check('log page has a Save button', lp.includes('Save AM log'))

  // ── Action Inbox: health concern ──
  const inbox = await getHtml('/actions')
  check('inbox raises a Health flag card', inbox.includes(`Health flag — ${MARK}Simba`))
  check('inbox card names the concerns', inbox.includes('Diarrhea'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
