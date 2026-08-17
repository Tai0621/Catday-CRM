import 'dotenv/config'
import './_guard.mjs'

// C5 — the nightly analyst brief.
//
// No model call. The narration is one Haiku round; everything that can be
// WRONG is on either side of it:
//
//   • the day boundary — the cron fires at 16:30 UTC, which is 00:30 in Kuala
//     Lumpur. UTC date arithmetic would push eight hours of one trading day
//     into the previous one, and every figure in the brief would be off by a
//     slice of evening takings. This is the assertion that matters most.
//   • the facts — computed by the OS, never asked of the model
//   • fail-closed — no key means no brief, not a faked one
//   • idempotence — a cron retry must not pay for a second call
//   • the link list — a recommendation pointing at a 404 lands in the one
//     place the owner is most likely to click
//
// Run the server WITHOUT ANTHROPIC_API_KEY so the no-key path is reachable and
// nothing here can reach Anthropic.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYC5'
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

// ── the day under test ──
// Two days back, so it is unambiguously finished in every timezone involved and
// cannot collide with the day the scheduled run would pick.
const MYT = 8 * 3600000
const nowMyt = new Date(Date.now() + MYT)
const shift = n => new Date(nowMyt.getTime() + n * 86400000).toISOString().slice(0, 10)
const DAY = shift(-2)
const PRIOR_WEEK = shift(-9) // same weekday, one week earlier — feeds the baseline

const txnId = k => `${MARK}-txn-${k}`
const apptId = k => `${MARK}-appt-${k}`
const custId = `${MARK}-cust`
const catId = `${MARK}-cat`
const productId = `${MARK}-product`

/** An instant on `dayKey` at a given Kuala Lumpur wall-clock hour. */
const atMyt = (dayKey, hour) => new Date(Date.parse(`${dayKey}T00:00:00Z`) + hour * 3600000 - MYT)

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "DailyBrief" WHERE date IN (?,?)`, [t(DAY), t(PRIOR_WEEK)]),
    exec(`DELETE FROM "Transaction" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Appointment" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Cat" WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM "Customer" WHERE id = ?`, [t(custId)]),
    exec(`DELETE FROM "Product" WHERE id = ?`, [t(productId)]),
  ])
}

try {
  await cleanup()

  const seededAt = iso(new Date())
  await pipe([
    exec(`INSERT INTO "Customer" (id,phone,name,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 1, ?, ?)`,
      [t(custId), t('+60119000001'), t(`${MARK} Owner`), t(seededAt), t(seededAt)]),
    exec(`INSERT INTO "Cat" (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`,
      [t(catId), t(custId), t(`${MARK} Cat`), t(seededAt), t(seededAt)]),
    exec(`INSERT INTO "Product" (id,name,price,costPrice,stockQty,reorderLevel,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?,?,?,2,10,1,999,?,?)`,
      [t(productId), t(`${MARK} Widget`), f(20), f(8), t(seededAt), t(seededAt)]),
  ])

  // ── the boundary ──
  // 23:30 MYT on DAY is 15:30 UTC on DAY — same UTC date, so both conventions
  // agree. 00:30 MYT on DAY is 16:30 UTC the PREVIOUS day: UTC arithmetic would
  // file it under the wrong day. Seed one of each, plus one just after DAY ends.
  await pipe([
    exec(`INSERT INTO "Transaction" (id,date,total,category,createdAt) VALUES (?,?,?, 'Grooming', ?)`,
      [t(txnId('early')), t(iso(atMyt(DAY, 0.5))), f(100), t(seededAt)]),
    exec(`INSERT INTO "Transaction" (id,date,total,category,createdAt) VALUES (?,?,?, 'Boarding', ?)`,
      [t(txnId('late')), t(iso(atMyt(DAY, 23.5))), f(200), t(seededAt)]),
    exec(`INSERT INTO "Transaction" (id,date,total,category,createdAt) VALUES (?,?,?, 'Retail', ?)`,
      [t(txnId('next')), t(iso(atMyt(DAY, 24.5))), f(999), t(seededAt)]),
    // Baseline: same weekday a week earlier.
    exec(`INSERT INTO "Transaction" (id,date,total,category,createdAt) VALUES (?,?,?, 'Grooming', ?)`,
      [t(txnId('base')), t(iso(atMyt(PRIOR_WEEK, 12))), f(120), t(seededAt)]),
  ])

  await pipe([
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Completed', ?, 1, ?, ?)`,
      [t(apptId('done')), t(custId), t(catId), t(iso(atMyt(DAY, 10))), f(100), t(seededAt), t(seededAt)]),
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'NoShow', ?, 0, ?, ?)`,
      [t(apptId('noshow')), t(custId), t(catId), t(iso(atMyt(DAY, 14))), f(80), t(seededAt), t(seededAt)]),
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Cancelled', ?, 0, ?, ?)`,
      [t(apptId('cx')), t(custId), t(catId), t(iso(atMyt(DAY, 16))), f(80), t(seededAt), t(seededAt)]),
  ])

  // ── auth ──
  const denied = res => res.status === 401 ||
    (res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').includes('/login'))

  const anon = await fetch(`${BASE}/api/cron/daily-brief`, { method: 'POST', redirect: 'manual' })
  check('a stranger cannot trigger the brief', denied(anon), `status ${anon.status}`)

  const badBearer = await fetch(`${BASE}/api/cron/daily-brief`, {
    headers: { authorization: 'Bearer not-the-cron-secret' }, redirect: 'manual',
  })
  check('a wrong bearer token is rejected', denied(badBearer), `status ${badBearer.status}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const call = async qs => {
    const r = await fetch(`${BASE}/api/cron/daily-brief${qs}`, { method: 'POST', headers: { cookie } })
    return { status: r.status, body: await r.json() }
  }

  // ── facts ──
  const dry = await call(`?date=${DAY}&dryRun=1`)
  check('a manager can inspect the facts without spending', dry.status === 200 && dry.body.dryRun === true,
    `${dry.status} ${JSON.stringify(dry.body).slice(0, 160)}`)
  const facts = dry.body.facts ?? {}

  check('the brief is for the requested day', facts.date === DAY, String(facts.date))
  check('revenue counts the whole local day, both ends',
    facts.revenue?.total === 300,
    `got ${facts.revenue?.total} (expected 100 + 200; a UTC boundary would drop the 00:30 sale)`)
  check('…and stops at local midnight', !JSON.stringify(facts.revenue?.byStream ?? []).includes('Retail'),
    JSON.stringify(facts.revenue?.byStream))
  check('streams are split by category',
    (facts.revenue?.byStream ?? []).some(s => s.category === 'Grooming' && s.total === 100) &&
    (facts.revenue?.byStream ?? []).some(s => s.category === 'Boarding' && s.total === 200),
    JSON.stringify(facts.revenue?.byStream))

  check('the baseline is the same weekday, not the day before',
    facts.revenue?.baselineWeeks === 4 && facts.revenue?.baseline > 0,
    `baseline ${facts.revenue?.baseline} over ${facts.revenue?.baselineWeeks} weeks`)
  check('a delta against the baseline is computed', typeof facts.revenue?.deltaPct === 'number',
    String(facts.revenue?.deltaPct))

  check('completed visits are counted', facts.visits?.completed >= 1, JSON.stringify(facts.visits))
  check('no-shows are counted separately', facts.visits?.noShows >= 1, JSON.stringify(facts.visits))
  check('cancellations are counted separately', facts.visits?.cancelled >= 1, JSON.stringify(facts.visits))
  check('low stock is surfaced', (facts.lowStock ?? []).some(p => p.name === `${MARK} Widget`),
    JSON.stringify(facts.lowStock))
  check('room occupancy is a percentage of active rooms',
    typeof facts.boarding?.occupancyPct === 'number' && facts.boarding.occupancyPct >= 0 && facts.boarding.occupancyPct <= 100,
    String(facts.boarding?.occupancyPct))
  check('only the urgent action band is carried', Array.isArray(facts.openActions) && facts.openActions.length <= 8,
    `${facts.openActions?.length} actions`)

  const afterDry = await one(`SELECT COUNT(*) FROM "DailyBrief" WHERE date = ?`, [t(DAY)])
  check('a dry run writes nothing', Number(afterDry[0][0]) === 0, `${afterDry[0][0]} rows`)

  // ── fail closed ──
  // The server under test runs without ANTHROPIC_API_KEY.
  const noKey = await call(`?date=${DAY}`)
  check('without a key the brief is skipped, not faked',
    noKey.status === 200 && noKey.body.written === false && noKey.body.reason === 'no-key',
    JSON.stringify(noKey.body))
  const afterSkip = await one(`SELECT COUNT(*) FROM "DailyBrief" WHERE date = ?`, [t(DAY)])
  check('…and no row is written', Number(afterSkip[0][0]) === 0, `${afterSkip[0][0]} rows`)
  check('a skipped brief is not reported as a cron failure', noKey.status === 200, `status ${noKey.status}`)

  // ── idempotence ──
  // Simulated by planting a finished brief: a retry must return it rather than
  // pay for a second narration.
  await pipe([exec(
    `INSERT INTO "DailyBrief" (id,date,createdAt,facts,observations,actions,model,inputTokens,outputTokens)
     VALUES (?,?,?,?,?,?,?,0,0)`,
    [t(`${MARK}-brief`), t(DAY), t(seededAt), t(JSON.stringify(facts)),
      t(JSON.stringify([`${MARK} observation`])), t(JSON.stringify([{ title: 'x', why: 'y', href: '/actions' }])), t('seeded')])])

  const retry = await call(`?date=${DAY}`)
  check('a second run reuses the stored brief', retry.status === 200 && retry.body.reused === true,
    JSON.stringify(retry.body))
  const count = await one(`SELECT COUNT(*) FROM "DailyBrief" WHERE date = ?`, [t(DAY)])
  check('…and does not write a second row', Number(count[0][0]) === 1, `${count[0][0]} rows`)

  // ── day guards ──
  const todayMyt = shift(0)
  const future = await call(`?date=${todayMyt}`)
  check('a day still in progress is refused', future.status === 400, `${future.status} ${JSON.stringify(future.body)}`)
  const malformed = await call('?date=yesterday')
  check('a malformed date is refused', malformed.status === 400, String(malformed.status))

  // ── the brief is readable ──
  const page = await fetch(`${BASE}/brief`, { headers: { cookie } })
  const html = await page.text()
  check('the archive page renders the brief', page.status === 200 && html.includes(`${MARK} observation`),
    `status ${page.status}`)

  // ── every link the model may suggest must exist ──
  const src = await import('node:fs').then(fs => fs.readFileSync('lib/brief/narrate.ts', 'utf8'))
  const block = (src.match(/export const BRIEF_LINKS[^{]*\{([\s\S]*?)\n\}/) ?? ['', ''])[1]
  const links = [...block.matchAll(/^\s*'([^']+)':/gm)].map(m => m[1])
  check('there is a closed list of link destinations', links.length >= 8, `${links.length} links`)

  const broken = []
  for (const href of links) {
    const r = await fetch(`${BASE}${href}`, { headers: { cookie }, redirect: 'manual' })
    if (r.status >= 400) broken.push(`${href} → ${r.status}`)
  }
  check('every suggestible link resolves to a real page', broken.length === 0, broken.join(', '))
  check('the href allow-list is enforced, not just described',
    /a\.href in BRIEF_LINKS/.test(src), 'narrate.ts does not filter hrefs against BRIEF_LINKS')

  // ── the model narrates; it does not compute ──
  const factsSrc = await import('node:fs').then(fs => fs.readFileSync('lib/brief/facts.ts', 'utf8'))
  check('the facts builder makes no model call',
    !/anthropic|messages\.create/i.test(factsSrc), 'facts.ts reaches for the model')
  check('usage is recorded against the AI budget', /recordUsage/.test(src), 'narrate.ts does not record usage')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
