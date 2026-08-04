import 'dotenv/config'

// M2 — marketing attribution.
// The claim under test is not "revenue appears" but "revenue appears ONCE".
//
// Seeds one customer with two nudges of different types before a single sale.
// Both windows still cover the sale, so both are candidates and exactly one must
// be credited — crediting both would let one RM 200 groom show up as RM 400 of
// marketing revenue, which is how a report stops being believed.
//
// Measured as a BEFORE/AFTER delta rather than by looking for the literal
// amount: the target database already carries thousands of ringgit of
// attributed revenue, so an absolute assertion would prove nothing.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYATTR'
const DAY = 24 * 60 * 60 * 1000
const SALE = 200

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

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
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)

const custId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM ActionLog WHERE actionKey LIKE '${MARK}%'`),
    exec(`DELETE FROM "Transaction" WHERE reference = ?`, [t(MARK)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

const num = s => Number(String(s).replace(/,/g, ''))

/** Headline "RM n attributed to these nudges…" */
function headline(html) {
  const i = html.indexOf('attributed to these nudges')
  if (i === -1) return null
  const before = html.slice(Math.max(0, i - 400), i)
  const all = [...before.matchAll(/RM\s*([\d,]+)/g)]
  return all.length ? num(all[all.length - 1][1]) : null
}

/**
 * Attributed RM on one action type's row.
 *
 * Matches the bare label rather than `>label<`: this content arrives inside the
 * RSC flight payload as `\"children\":\"Grooming due\"`, not as plain HTML, so an
 * angle-bracket anchor silently finds nothing — and `null - null` is 0, which
 * reads exactly like a real "did not move" result. Returns null when the row is
 * genuinely absent so a missing row cannot masquerade as a passing delta.
 */
function rowAmount(html, label) {
  const start = html.indexOf('ranking is tuned')
  const panel = start === -1 ? html : html.slice(start, start + 20000)
  const i = panel.indexOf(label)
  if (i === -1) return null
  const m = panel.slice(i + label.length, i + label.length + 500).match(/RM\s*([\d,]+)/)
  return m ? num(m[1]) : 0
}

try {
  await cleanup()
  const now = Date.now()

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const get = async () => strip(await (await fetch(`${BASE}/actions`, { headers: { cookie } })).text())

  const before = await get()
  check('/actions renders the panel', before.includes('ranking is tuned'))
  const beforeTotal = headline(before)
  check('attribution headline present', beforeTotal !== null, 'expected "attributed to these nudges"')
  const beforeGroom = rowAmount(before, 'Grooming due')
  const beforeWin = rowAmount(before, 'Win back')
  check('both type rows are readable', beforeGroom !== null && beforeWin !== null,
    `grooming=${beforeGroom} winback=${beforeWin} — a missing row would fake a zero delta`)

  // Two nudges (40d and 35d ago) then one sale (30d ago). WinBack and
  // GroomingDue both use a 21-day window, so both still cover the sale.
  await pipe([
    exec(`INSERT INTO Customer (id,phone,name,source,createdAt,updatedAt) VALUES (?,?,?,'WalkIn',?,CURRENT_TIMESTAMP)`,
      [t(custId), t(`+60${MARK}`), t(`${MARK} Owner`), t(iso(now - 400 * DAY))]),
    exec(`INSERT INTO ActionLog (id,actionKey,type,customerId,status,createdAt) VALUES (?,?,'WinBack',?,'Done',?)`,
      [t(crypto.randomUUID()), t(`${MARK}-old`), t(custId), t(iso(now - 40 * DAY))]),
    exec(`INSERT INTO ActionLog (id,actionKey,type,customerId,status,createdAt) VALUES (?,?,'GroomingDue',?,'Done',?)`,
      [t(crypto.randomUUID()), t(`${MARK}-recent`), t(custId), t(iso(now - 35 * DAY))]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,category,total,method,reference,createdAt)
          VALUES (?,?,?,'Grooming',?,'Cash',?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(custId), t(iso(now - 30 * DAY)), f(SALE), t(MARK)]),
  ])

  const after = await get()
  const afterTotal = headline(after)
  const delta = afterTotal - beforeTotal

  // Rounding: money renders at 0 decimals, so allow a ringgit either way.
  check('the sale is attributed exactly once', Math.abs(delta - SALE) <= 1,
    `total moved by RM ${delta}, expected RM ${SALE}${Math.abs(delta - SALE * 2) <= 1 ? ' — DOUBLE COUNTED' : ''}`)

  const groomDelta = rowAmount(after, 'Grooming due') - beforeGroom
  const winDelta = rowAmount(after, 'Win back') - beforeWin
  check('last touch is credited (Grooming due)', Math.abs(groomDelta - SALE) <= 1, `moved RM ${groomDelta}`)
  check('earlier nudge is not credited (Win back)', Math.abs(winDelta) <= 1, `moved RM ${winDelta}`)

  check('labelled attributed, not incremental', after.includes('attributed, not incremental') && after.includes('upper bound'),
    'the figure must be qualified in the UI')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
