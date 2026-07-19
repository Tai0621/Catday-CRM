import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for the scenario-analysis + smart recommendation. Seeds a plan whose
// budgeted fixed costs sit BELOW the real (keyed) 2026 opex so the model sees
// costs running over plan, and checks the recommendation re-solves the levers.
// Snapshots and fully restores BusinessPlan + PlanDriver.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

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
const q = async sql => (await pipe([exec(sql)]))[0].response.result

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

// ── snapshot ──
const planBefore = await q(`SELECT startMonth, breakevenMonth, avgSaleValue FROM BusinessPlan WHERE id='default'`)
const hadPlan = planBefore.rows.length > 0
const prevPlan = hadPlan ? { s: planBefore.rows[0][0].value, e: planBefore.rows[0][1].value, a: planBefore.rows[0][2].value } : null
const driversBefore = await q(`SELECT key, value FROM PlanDriver`)
const prevDrivers = driversBefore.rows.map(r => ({ key: r[0].value, value: r[1].value }))

async function restore() {
  await pipe([exec(`DELETE FROM PlanDriver`)])
  if (prevDrivers.length) {
    await pipe(prevDrivers.map(d => exec(
      `INSERT INTO PlanDriver (id,key,value,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(d.key), f(d.value)])))
  }
  if (hadPlan && prevPlan) {
    await pipe([exec(`UPDATE BusinessPlan SET startMonth=?, breakevenMonth=?, avgSaleValue=? WHERE id='default'`,
      [t(prevPlan.s), t(prevPlan.e), f(prevPlan.a)])])
  } else {
    await pipe([exec(`DELETE FROM BusinessPlan WHERE id='default'`)])
  }
}

try {
  // ── seed: 3-year horizon, 50 rooms, but fixed costs budgeted LOW so real
  // (keyed 2026 opex ~49k/mo) runs well above plan → "outrunning" branch ──
  await pipe([
    exec(`INSERT INTO BusinessPlan (id,startMonth,breakevenMonth,avgSaleValue,currency,createdAt,updatedAt)
          VALUES ('default','2026-01','2028-12',0,'RM',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET startMonth='2026-01', breakevenMonth='2028-12'`),
    exec(`DELETE FROM PlanDriver`),
    ...[
      ['cap.boardingRooms', 50], ['util.startPct', 5], ['util.endPct', 35],
      ['opex.Rent', 8000], ['opex.Salaries', 10000], ['opex.Cleaning Supplies', 0],
      ['opex.Utilities', 0], ['opex.Marketing', 0], ['opex.Maintenance', 0], ['opex.Other Expense', 0],
    ].map(([k, v]) => exec(`INSERT INTO PlanDriver (id,key,value,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(k), f(v)])),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  await fetch(`${BASE}/plan`, { headers: { Cookie: cookie } })
  const page = (await (await fetch(`${BASE}/plan`, { headers: { Cookie: cookie } })).text()).replace(/<!--[\s\S]*?-->/g, '')

  check('scenario section renders', page.includes('Smart Recommendation') && page.includes('Scenario Analysis'))
  check('lever controls present', page.includes('Start utilization') && page.includes('Boarding price / night'))
  check('multiline chart present (2 series legend)', page.includes('Saved plan') && page.includes('This scenario'))
  check('mode toggle present', page.includes('Cumulative profit') && page.includes('Revenue vs cost'))
  check('outcome tiles present', page.includes('Breakeven month') && page.includes('vs saved plan'))
  // Recommendation reacted to costs above plan
  check('recommendation flags costs above plan',
    page.includes('outrunning the plan') || page.includes('above plan') || page.includes('above budget'))
  check('recommendation re-solves a lever (utilization / price / trim)',
    /ending utilization/.test(page) || /boarding price/.test(page) || /trimming/.test(page))

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await restore()
  console.log('restored prior plan settings')
}
