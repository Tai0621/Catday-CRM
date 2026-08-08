import 'dotenv/config'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// C9 — monthly department reports.
//
// No model call. What is being proved:
//
//   • the grounding check — the guarantee the whole design rests on. It is
//     pure and import-free, so it is compiled and exercised DIRECTLY here
//     rather than asserted about from a distance.
//   • facts survive the AI — no key must mean figures without prose, never a
//     missing report
//   • finance reconciles — the report's revenue must be the income statement's
//     revenue, or the two documents disagree in front of an accountant
//   • segment migration — Regular → At-risk, engineered deterministically,
//     because it is the one number here nothing else in the OS produces
//   • a flagged report still shows its figures and names what it could not verify
//
// Run the server WITHOUT ANTHROPIC_API_KEY.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYC9'
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
const DAY = 86400000

// ── the month under test: two months back, unambiguously closed ──
const now = new Date()
const target = new Date(now.getFullYear(), now.getMonth() - 2, 1)
const MONTH = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`
const mStart = new Date(target.getFullYear(), target.getMonth(), 1)
const mEnd = new Date(target.getFullYear(), target.getMonth() + 1, 1)
const CURRENT = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

const custId = `${MARK}-cust`
const catId = `${MARK}-cat`
const SEED_REVENUE = 777.77

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "MonthlyReport" WHERE month = ?`, [t(MONTH)]),
    exec(`DELETE FROM "Transaction" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Appointment" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Cat" WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM "Customer" WHERE id = ?`, [t(custId)]),
  ])
}

try {
  await cleanup()

  // ══ 1. The grounding check, exercised directly ══
  // grounding.ts imports nothing, so it compiles to a standalone module. This
  // is the one piece where a subtle bug would be invisible end-to-end: a check
  // that silently passes everything looks exactly like a check that works.
  const outDir = mkdtempSync(join(tmpdir(), 'c9-'))
  execSync(`npx tsc lib/reports/grounding.ts --outDir "${outDir}" --module es2022 --target es2022 --moduleResolution bundler`,
    { stdio: 'pipe' })
  const { checkGrounding, factNumbers } = await import(pathToFileURL(join(outDir, 'grounding.js')).href)

  const facts = { revenueRM: 12437.5, visits: 42, marginPct: 31.4, ratio: 0.32, nested: [{ n: 8 }] }
  const g = (text) => checkGrounding(text, facts, MONTH)

  check('every numeric leaf is collected, including nested ones',
    factNumbers(facts).has(8) && factNumbers(facts).has(12437.5), [...factNumbers(facts)].join(','))
  check('a figure taken straight from the data passes', g('We saw 42 visits.').ok)
  check('a fabricated figure is caught', !g('We saw 57 visits.').ok)
  check('…and is named', g('We saw 57 visits.').unsupported.includes('57'), JSON.stringify(g('We saw 57 visits.')))
  check('thousands separators are understood', g('Revenue was RM 12,437.50.').ok, JSON.stringify(g('Revenue was RM 12,437.50.')))
  check('rounding to the precision written is allowed', g('Revenue was RM 12,438.').ok,
    JSON.stringify(g('Revenue was RM 12,438.')))
  check('rounding further than the data supports is not', !g('Revenue was RM 12,700.').ok)
  check('a stored fraction may be written as a percentage', g('A 32% share.').ok, JSON.stringify(g('A 32% share.')))
  check('a percentage already computed passes', g('Margin was 31.4%.').ok)
  check('arithmetic the model did itself is caught',
    !g('That is 296 visits per week.').ok, 'a derived figure slipped through')
  check('the reported year and month are structural, not measurements',
    g(`In ${MONTH.slice(0, 4)} this was true.`).ok)
  check('prose with no figures at all is grounded', g('A quiet month overall.').ok)
  check('the count of checked figures is reported', g('42 and 8.').checked === 2, String(g('42 and 8.').checked))

  // ══ 2. Seed a known month ══
  const seededAt = iso(now)
  // Two visits 30 days apart, the last 40 days before the month starts. Cadence
  // becomes 30, so the at-risk threshold is 45 days: Regular on the 1st,
  // At-risk by the 31st, and still short of the 90-day Lost line.
  const lastVisit = new Date(mStart.getTime() - 40 * DAY)
  const priorVisit = new Date(mStart.getTime() - 70 * DAY)

  await pipe([
    exec(`INSERT INTO "Customer" (id,phone,name,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 1, ?, ?)`,
      [t(custId), t('+60117000001'), t(`${MARK} Owner`), t(iso(new Date(mStart.getTime() - 400 * DAY))), t(seededAt)]),
    exec(`INSERT INTO "Cat" (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`,
      [t(catId), t(custId), t(`${MARK} Cat`), t(seededAt), t(seededAt)]),
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Completed', ?, 1, ?, ?)`,
      [t(`${MARK}-a1`), t(custId), t(catId), t(iso(priorVisit)), f(100), t(seededAt), t(seededAt)]),
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Completed', ?, 1, ?, ?)`,
      [t(`${MARK}-a2`), t(custId), t(catId), t(iso(lastVisit)), f(100), t(seededAt), t(seededAt)]),
  ])

  // ── auth ──
  const denied = res => res.status === 401 ||
    (res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').includes('/login'))
  const anon = await fetch(`${BASE}/api/cron/monthly-report`, { method: 'POST', redirect: 'manual' })
  check('a stranger cannot generate reports', denied(anon), `status ${anon.status}`)
  const badBearer = await fetch(`${BASE}/api/cron/monthly-report`, {
    headers: { authorization: 'Bearer wrong' }, redirect: 'manual',
  })
  check('a wrong bearer token is rejected', denied(badBearer), `status ${badBearer.status}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const call = async qs => {
    const r = await fetch(`${BASE}/api/cron/monthly-report${qs}`, { method: 'POST', headers: { cookie } })
    return { status: r.status, body: await r.json() }
  }

  // ══ 3. Finance reconciles with the income statement ══
  const before = await call(`?month=${MONTH}&department=finance&dryRun=1`)
  check('finance facts can be inspected without spending', before.status === 200 && before.body.dryRun === true,
    `${before.status} ${JSON.stringify(before.body).slice(0, 140)}`)
  const revenueBefore = before.body.facts?.revenue?.totalRM ?? 0

  await pipe([exec(
    `INSERT INTO "Transaction" (id,date,total,category,method,createdAt) VALUES (?,?,?, 'Grooming', 'Cash', ?)`,
    [t(`${MARK}-txn`), t(iso(new Date(mStart.getTime() + 5 * DAY))), f(SEED_REVENUE), t(seededAt)])])

  const after = await call(`?month=${MONTH}&department=finance&dryRun=1`)
  const revenueAfter = after.body.facts?.revenue?.totalRM ?? 0
  check('revenue moves by exactly what was recorded',
    Math.abs((revenueAfter - revenueBefore) - SEED_REVENUE) < 0.01,
    `${revenueBefore} → ${revenueAfter} (expected +${SEED_REVENUE})`)

  const financeSrc = readFileSync('lib/reports/facts/finance.ts', 'utf8')
  check('the figure comes from the income statement, not a second sum over transactions',
    /buildIncomeStatement/.test(financeSrc) && !/db\.transaction\.(groupBy|aggregate)[\s\S]{0,200}total/.test(
      financeSrc.replace(/by: \['method'\][\s\S]{0,120}/g, '')),
    'financeFacts recomputes revenue independently of the statement')
  check('margin, plan variance and aging are all precomputed',
    ['grossMarginPct', 'netMarginPct', 'achievedPct', 'receivableOver90RM']
      .every(k => financeSrc.includes(k)), 'a ratio the narrative may want is missing')

  // ══ 4. Segment migration ══
  const crm = await call(`?month=${MONTH}&department=crm&dryRun=1`)
  const segments = crm.body.facts?.segments
  check('crm facts include segment migration', !!segments?.migration, JSON.stringify(crm.body.facts ?? {}).slice(0, 120))
  const regularToRisk = (segments?.migration ?? []).find(m => m.from === 'Regular' && m.to === 'At-risk')
  check('a customer who went quiet is caught moving Regular → At-risk',
    !!regularToRisk && regularToRisk.count >= 1, JSON.stringify(segments?.migration))
  check('deterioration is counted separately from improvement',
    typeof segments?.deteriorated === 'number' && segments.deteriorated >= 1,
    `deteriorated ${segments?.deteriorated}`)
  check('newly at-risk is its own figure', segments?.newlyAtRisk >= 1, String(segments?.newlyAtRisk))

  // ══ 5. Facts survive the AI being unavailable ══
  const generated = await call(`?month=${MONTH}`)
  check('all six departments generate', generated.status === 200 && generated.body.generated === 6,
    `${generated.status} ${JSON.stringify(generated.body).slice(0, 200)}`)
  check('…with no key, every one is figures-only',
    (generated.body.reports ?? []).every(r => r.status === 'Facts'),
    JSON.stringify(generated.body.reports))

  const stored = await one(`SELECT department, status, length(facts) FROM "MonthlyReport" WHERE month = ?`, [t(MONTH)])
  check('six rows are written', stored.length === 6, `${stored.length} rows`)
  check('every one carries real figures', stored.every(r => Number(r[2]) > 50),
    stored.map(r => `${r[0]}:${r[2]}`).join(' '))

  const departments = stored.map(r => r[0]).sort()
  check('the six are the six business segments',
    JSON.stringify(departments) === JSON.stringify(['admin', 'crm', 'finance', 'hr', 'marketing', 'operations']),
    departments.join(','))

  // ── regeneration replaces rather than duplicates ──
  await call(`?month=${MONTH}`)
  const again = await one(`SELECT COUNT(*) FROM "MonthlyReport" WHERE month = ?`, [t(MONTH)])
  check('regenerating does not duplicate a month', Number(again[0][0]) === 6, `${again[0][0]} rows`)

  // ══ 6. Month guards ══
  const openMonth = await call(`?month=${CURRENT}`)
  check('a month still running is refused', openMonth.status === 400,
    `${openMonth.status} ${JSON.stringify(openMonth.body)}`)
  const malformed = await call('?month=last-month')
  check('a malformed month is refused', malformed.status === 400, String(malformed.status))
  const unknownDept = await call(`?month=${MONTH}&department=canteen`)
  check('an unknown department is refused', unknownDept.status === 400, String(unknownDept.status))

  // ══ 7. A flagged report keeps its figures and names what it could not verify ══
  await pipe([exec(
    `UPDATE "MonthlyReport" SET status = 'Flagged', headline = ?, observations = ?, actions = ?, unsupported = ?
     WHERE month = ? AND department = 'operations'`,
    [t(`${MARK} headline`), t(JSON.stringify([`${MARK} claim of 9999 visits`])), t(JSON.stringify([])),
      t(JSON.stringify(['9999'])), t(MONTH)])])

  const page = await fetch(`${BASE}/reports?month=${MONTH}`, { headers: { cookie } })
  const html = await page.text()
  check('the reports page renders', page.status === 200, `status ${page.status}`)
  check('a flagged report is marked unverified', html.includes('unverified figures'), 'no flag shown')
  check('…names the figure it could not trace', html.includes('9999'), 'the unsupported figure is not shown')
  check('…and still shows the computed figures', html.includes('The figures'), 'facts hidden behind the flag')
  check('…and offers a rewrite from the same figures', html.includes('Rewrite from the same figures'),
    'no way to recover a flagged report')

  // ══ 8. Links ══
  const registry = readFileSync('lib/reports/facts/index.ts', 'utf8')
  const links = [...new Set([...registry.matchAll(/'(\/[a-z0-9/[\]-]+)'/g)].map(m => m[1]))]
  check('departments declare link destinations', links.length >= 15, `${links.length} links`)
  const broken = []
  for (const href of links) {
    const r = await fetch(`${BASE}${href}`, { headers: { cookie }, redirect: 'manual' })
    if (r.status >= 400) broken.push(`${href} → ${r.status}`)
  }
  check('every link a report may suggest resolves', broken.length === 0, broken.join(', '))

  // ══ 9. The model computes nothing ══
  const narrateSrc = readFileSync('lib/reports/narrate.ts', 'utf8')
  const indexSrc = readFileSync('lib/reports/index.ts', 'utf8')
  check('narration is grounded before it is published',
    /checkGrounding/.test(indexSrc) && /grounding\.ok \? 'Published' : 'Flagged'/.test(indexSrc),
    'status is not derived from the grounding result')
  check('the unsupported figures are stored, not just counted', /unsupported: .*JSON\.stringify/.test(indexSrc))
  check('facts are written even when narration fails', /catch \(e\)[\s\S]{0,200}console\.error/.test(indexSrc),
    'a narration failure loses the report')
  for (const [name, src] of [['operations', 'lib/reports/facts/operations.ts'], ['crm', 'lib/reports/facts/crm.ts']]) {
    const s = readFileSync(src, 'utf8')
    check(`${name} facts make no model call`, !/anthropic|messages\.create/i.test(s), `${src} reaches for the model`)
  }
  check('the narration prompt forbids arithmetic', /Do not add, subtract, average/.test(narrateSrc))

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
