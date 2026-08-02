import 'dotenv/config'

// C4 — Action Inbox message variants.
// What has to hold:
//   1. assignment is deterministic — the same customer sees the same arm every
//      render, or the comparison is meaningless;
//   2. different customers actually get spread across arms;
//   3. placeholders are filled from live record, not left as {cat};
//   4. the arm is carried on the card so the outcome log can record it;
//   5. a type with no variants keeps its built-in message untouched;
//   6. the manager page scores arms and only calls a winner on real evidence.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYC4'
const DAY = 24 * 60 * 60 * 1000

const t = v => ({ type: 'text', value: String(v) })
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

// Enough customers that random assignment would almost certainly hit both arms.
const CUSTOMERS = Array.from({ length: 12 }, () => ({ id: crypto.randomUUID(), cat: crypto.randomUUID() }))

async function cleanup() {
  await pipe([
    exec(`DELETE FROM ActionVariant WHERE label LIKE '${MARK}%'`),
    exec(`DELETE FROM ActionLog WHERE actionKey LIKE '${MARK}%'`),
    exec(`DELETE FROM Appointment WHERE customerId IN (${CUSTOMERS.map(() => '?').join(',')})`, CUSTOMERS.map(c => t(c.id))),
    exec(`DELETE FROM Cat WHERE id IN (${CUSTOMERS.map(() => '?').join(',')})`, CUSTOMERS.map(c => t(c.cat))),
    exec(`DELETE FROM Customer WHERE id IN (${CUSTOMERS.map(() => '?').join(',')})`, CUSTOMERS.map(c => t(c.id))),
  ])
}

const armOf = html => {
  // The WhatsApp deep link carries the rendered message; the arm is identifiable
  // by the distinctive token each seeded body contains.
  const a = html.includes(`${MARK}-ARM-A`), b = html.includes(`${MARK}-ARM-B`)
  return a && b ? 'both' : a ? 'A' : b ? 'B' : 'none'
}

try {
  await cleanup()
  const now = Date.now()

  // Two arms whose bodies are trivially distinguishable, and which exercise the
  // {cat} placeholder so a failure to substitute is visible.
  await pipe([
    exec(`INSERT INTO ActionVariant (id,type,label,body,isActive,isDefault,createdAt,updatedAt)
          VALUES (?,'WinBack',?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(`${MARK}-A`), t(`${MARK}-ARM-A hello {cat}`)]),
    exec(`INSERT INTO ActionVariant (id,type,label,body,isActive,isDefault,createdAt,updatedAt)
          VALUES (?,'WinBack',?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(`${MARK}-B`), t(`${MARK}-ARM-B hello {cat}`)]),
  ])

  // Customers inactive long enough to trigger WinBack, each with one named cat
  // and one old completed visit (paid, no price → no payment card noise).
  const seed = []
  for (const [i, c] of CUSTOMERS.entries()) {
    seed.push(exec(
      `INSERT INTO Customer (id,phone,name,source,createdAt,updatedAt) VALUES (?,?,?,'WalkIn',?,CURRENT_TIMESTAMP)`,
      [t(c.id), t(`+60${MARK}${i}`), t(`${MARK} Owner ${i}`), t(iso(now - 400 * DAY))]))
    seed.push(exec(
      `INSERT INTO Cat (id,name,customerId,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(c.cat), t(`${MARK}Cat${i}`), t(c.id)]))
    seed.push(exec(
      `INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,paid,usedCredit,createdAt,updatedAt)
       VALUES (?,?,?,'Grooming',?,'Completed',1,0,?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(c.id), t(c.cat), t(iso(now - 200 * DAY)), t(iso(now - 200 * DAY))]))
  }
  await pipe(seed)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const get = async path => strip(await (await fetch(`${BASE}${path}`, { headers: { cookie } })).text())

  const first = await get('/actions')
  check('/actions renders with seeded win-backs', first.includes(`${MARK} Owner`), 'seeded customers should surface')

  // 2 · both arms in play across the cohort
  check('both arms are being served', armOf(first) === 'both', `saw ${armOf(first)}`)

  // 3 · placeholders resolved against the real record
  check('{cat} substituted from the record', first.includes(`${MARK}Cat`), 'placeholder should be filled')
  check('no raw placeholder leaks to the message', !first.includes('%7Bcat%7D') && !first.includes('{cat}'))

  // 1 · determinism — same customer, same arm, across independent renders
  const second = await get('/actions')
  const armFor = (html, i) => {
    const idx = html.indexOf(`${MARK}Cat${i}`)
    if (idx === -1) return 'missing'
    const near = html.slice(Math.max(0, idx - 4000), idx + 4000)
    return near.includes(`${MARK}-ARM-A`) ? 'A' : near.includes(`${MARK}-ARM-B`) ? 'B' : 'none'
  }
  const stable = CUSTOMERS.every((_, i) => armFor(first, i) === armFor(second, i))
  check('assignment is stable across renders', stable, 'a customer must never switch voice')

  const spread = new Set(CUSTOMERS.map((_, i) => armFor(first, i)))
  check('assignment spreads across the cohort', spread.has('A') && spread.has('B'), `arms seen: ${[...spread].join(',')}`)

  // 4 · the arm is carried into the outcome form
  check('variant recorded on the action form', /name="variant" value="VERIFYC4-[AB]"/.test(first))

  // 5 · a type with no variants is untouched
  await pipe([exec(`UPDATE ActionVariant SET isActive = 0 WHERE label LIKE '${MARK}%'`)])
  const noVariants = await get('/actions')
  // The message rides in the WhatsApp deep link, so it is URL-encoded — match on
  // a token with no spaces rather than a phrase.
  check('retired arms stop being served', !noVariants.includes(`${MARK}-ARM`))
  check('falls back to the built-in message', noVariants.includes('misses'),
    'with no active arms the original template should return')

  // 6 · the manager page scores arms and refuses to call a winner without evidence
  await pipe([exec(`UPDATE ActionVariant SET isActive = 1 WHERE label LIKE '${MARK}%'`)])
  const page = await get('/admin/variants')
  check('/admin/variants renders', page.includes('Message variants'))
  check('seeded arms listed', page.includes(`${MARK}-A`) && page.includes(`${MARK}-B`))
  check('no winner called without outcomes', page.includes('Still running') || !page.includes('best converting'),
    'a winner must not be declared on zero evidence')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
