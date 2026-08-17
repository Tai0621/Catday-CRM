import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 4 health & feeding (boarding SOPs). Seeds three cats in
// different states and asserts the cat page's Health & Care card + boarding
// gate, meal derivation, feeding profile, and the Action Inbox treatment
// reminder:
//  • ready      — vax valid, deworm/deflea current → "Boarding-ready"
//  • charge     — vax valid, deworm overdue → "RM 50 on check-in" (auto-charge)
//  • blocked    — vax expired → "Not boarding-ready · Vaccination"
// Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYHEALTH'
const DAY = 24 * 60 * 60 * 1000
const iso = daysFromNow => new Date(Date.now() + daysFromNow * DAY).toISOString()

const t = v => ({ type: 'text', value: String(v) })
const i = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
const nul = { type: 'null' }
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

const custId = crypto.randomUUID()
const ready = crypto.randomUUID(), charge = crypto.randomUUID(), blocked = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Cat WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

const seedCat = (id, name, lifeStage, vaxDays, dewormDays, defleaDays, mealsPerDay, dietType, portion) => exec(
  `INSERT INTO Cat (id,customerId,name,lifeStage,vaccinationExpiry,lastDewormAt,lastDefleaAt,mealsPerDay,dietType,portion,createdAt,updatedAt)
   VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  [t(id), t(custId), t(name), t(lifeStage),
   vaxDays == null ? nul : t(iso(vaxDays)),
   dewormDays == null ? nul : t(iso(dewormDays)),
   defleaDays == null ? nul : t(iso(defleaDays)),
   mealsPerDay == null ? nul : i(mealsPerDay),
   dietType == null ? nul : t(dietType),
   portion == null ? nul : t(portion)])

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60125550001')]),
    seedCat(ready, `${MARK}Ready`, 'Adult', 200, -5, -5, null, 'Commercial', '60g'),
    seedCat(charge, `${MARK}Charge`, 'Kitten', 200, -40, -5, 4, 'Prescription', null),
    seedCat(blocked, `${MARK}Blocked`, 'Senior', -5, -5, -5, null, null, null),
  ])
  console.log('seeded ready / charge / blocked cats')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Ready cat ──
  const rHtml = await getHtml(`/cats/${ready}`)
  check('ready: shows "Boarding-ready"', rHtml.includes('Boarding-ready'))
  check('ready: vaccination Current', /Vaccination[\s\S]{0,80}Current|Current[\s\S]{0,120}Vaccination/.test(rHtml) || rHtml.includes('Current'))
  check('ready: meals derived from life stage (2, Adult)', rHtml.includes('2 meal') && rHtml.includes('by life stage'))
  check('ready: feeding profile shows diet + portion', rHtml.includes('Commercial') && rHtml.includes('60g'))

  // ── Charge cat ──
  const cHtml = await getHtml(`/cats/${charge}`)
  check('charge: shows RM 50 auto-charge on check-in', cHtml.includes('RM 50') && /Deworm/i.test(cHtml))
  check('charge: deworm chip Overdue', cHtml.includes('Overdue'))
  check('charge: explicit meals override (4, not "by life stage")', cHtml.includes('4 meal'))

  // ── Blocked cat ──
  const bHtml = await getHtml(`/cats/${blocked}`)
  check('blocked: shows "Not boarding-ready"', bHtml.includes('Not boarding-ready'))
  check('blocked: names Vaccination as the blocker', /Vaccination needed/.test(bHtml))

  // ── Action Inbox treatment reminder ──
  const inbox = await getHtml('/actions')
  check('inbox surfaces deworming-due for the charge cat', inbox.includes(`Deworming due — ${MARK}Charge`))
  check('inbox does NOT nag the ready cat', !inbox.includes(`${MARK}Ready`))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
