import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for Licenses & Renewals feeding the Action Inbox. Seeds three licences —
// due soon, overdue, and far off — then asserts:
//  • the soon one surfaces as a "Renew" action, the overdue one as "Overdue"
//  • the far-off one (beyond its reminder lead time) does NOT surface
//  • the register page lists all three with the right status pills
//  • the page is behind the manager auth gate
// Cleans up fully in a finally block.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYLIC'
const DAY = 24 * 60 * 60 * 1000

const t = v => ({ type: 'text', value: String(v) })
const i = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
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
const iso = ms => new Date(ms).toISOString()

const soonId = crypto.randomUUID(), overdueId = crypto.randomUUID(), farId = crypto.randomUUID()
const NAME_SOON = `${MARK} Premise Licence`, NAME_OVERDUE = `${MARK} Fire Cert`, NAME_FAR = `${MARK} Signboard`
const now = Date.now()

async function cleanup() {
  await pipe([exec(`DELETE FROM License WHERE notes = ?`, [t(MARK)])])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

const seed = (id, name, category, renewalMs, reminderDays) => exec(
  `INSERT INTO License (id,name,category,authority,renewalDate,reminderDays,notes,archived,createdAt,updatedAt)
   VALUES (?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  [t(id), t(name), t(category), t('DBKL'), t(iso(renewalMs)), i(reminderDays), t(MARK)])

try {
  await cleanup()
  await pipe([
    seed(soonId, NAME_SOON, 'Business Licence', now + 10 * DAY, 30),   // due in 10d → alerts (Do now, ≤14)
    seed(overdueId, NAME_OVERDUE, 'Fire Safety', now - 5 * DAY, 30),   // overdue 5d → alerts
    seed(farId, NAME_FAR, 'Signboard Licence', now + 200 * DAY, 30),   // 200d out, 30d lead → silent
  ])
  console.log('seeded 3 licences (soon / overdue / far)')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Action Inbox ──
  const inbox = await getHtml('/actions')
  check('inbox surfaces the soon licence', inbox.includes(NAME_SOON))
  check('soon licence shows as "Renew"', inbox.includes(`Renew — ${NAME_SOON}`))
  check('inbox surfaces the overdue licence', inbox.includes(NAME_OVERDUE))
  check('overdue licence shows as "Overdue renewal"', inbox.includes(`Overdue renewal — ${NAME_OVERDUE}`))
  check('inbox links renewal card to /admin/licenses', inbox.includes('/admin/licenses'))
  check('far-off licence does NOT surface in inbox', !inbox.includes(NAME_FAR))

  // ── Register page ──
  const reg = await getHtml('/admin/licenses')
  check('register lists soon licence', reg.includes(NAME_SOON))
  check('register lists overdue licence', reg.includes(NAME_OVERDUE))
  check('register lists far-off licence (active, just not alerting)', reg.includes(NAME_FAR))
  check('register shows an Overdue status pill', /Overdue\s*5d/.test(reg))
  check('register shows a Due-in status pill', /Due in\s*10d/.test(reg))

  // ── auth guard ──
  const anon = await fetch(`${BASE}/admin/licenses`, { redirect: 'manual' })
  check('register requires sign-in', [302, 307].includes(anon.status) && (anon.headers.get('location') ?? '').includes('/login'), String(anon.status))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data (licences removed)')
}
