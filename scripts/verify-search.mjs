import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// The command palette's search endpoint.
//
// WRITTEN BEFORE THE FEATURE, deliberately. Every other suite in this repo was
// written alongside the thing it tests; this one was not, because search is the
// one part of the UI/UX round that can LEAK. A palette that returns a customer's
// name and phone number to a groomer has handed over data the groomer cannot
// open a page for — and it would look like it was working perfectly.
//
// The rule under test: a result is returned only if the session could open the
// page that result links to. Not "the row exists", not "the query matched" —
// `canAccess` on the destination, which already applies MANAGER_ONLY_PATHS
// before a role's own prefix list.
//
// The claims, in the order they matter:
//  • a groomer searching a customer's name gets NOTHING back
//  • …and nothing from any manager-only area (sales, inventory, finance)
//  • …but still gets the cats they are supposed to work with
//  • the manager gets all of it
//  • no session gets anything at all
//  • a blank query does not dump the database
//  • every result carries a href its holder can actually open

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYSEARCH'

const t = v => ({ type: 'text', value: String(v) })
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`)
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const pinHash = pin => crypto.createHash('sha256').update(`catday:${pin}`).digest('hex')

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
const groomerId = crypto.randomUUID(), frontId = crypto.randomUUID()
const GROOMER_PIN = `${MARK}-groomer-4471`
const FRONT_PIN = `${MARK}-front-4472`

// One distinctive string, present on a customer AND a cat, so a single query
// proves the difference between what each role is allowed to see.
const NEEDLE = `${MARK}Zephyr`

async function cleanup() {
  await pipe([
    exec(`DELETE FROM Staff WHERE name LIKE '${MARK}%'`),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

async function loginPin(pin) {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: pin }).toString(), redirect: 'manual',
  })
  return (r.headers.get('set-cookie') ?? '').split(';')[0]
}

async function search(cookie, q) {
  const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`, {
    headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual',
  })
  if (r.status !== 200) return { status: r.status, groups: [] }
  const body = await r.json()
  return { status: r.status, groups: body.groups ?? [] }
}
const allItems = groups => groups.flatMap(g => g.items ?? [])
const titles = groups => allItems(groups).map(i => `${i.title} ${i.subtitle ?? ''}`).join(' | ')

try {
  await cleanup()

  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,pointsBalance,walletBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(custId), t(`${NEEDLE} Tan`), t('+60102223344')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt)
          VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(custId), t(`${NEEDLE} Cat`)]),
    exec(`INSERT INTO Staff (id,name,role,pinHash,active,createdAt,updatedAt)
          VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(groomerId), t(`${MARK} Groomer`), t('Groomer'), t(pinHash(GROOMER_PIN))]),
    exec(`INSERT INTO Staff (id,name,role,pinHash,active,createdAt,updatedAt)
          VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(frontId), t(`${MARK} FrontDesk`), t('FrontDesk'), t(pinHash(FRONT_PIN))]),
  ])
  console.log(`seeded a customer and a cat both named "${NEEDLE}", plus a groomer and a front-desk staff`)

  // ══ 0. No session, nothing at all ══
  const anon = await search(null, NEEDLE)
  check('the search endpoint is closed to a request with no session',
    anon.status !== 200, `status ${anon.status}`)

  // ══ 1. The manager sees everything ══
  const mgrCookie = await loginPin(process.env.APP_PASSWORD ?? '')
  const mgr = await search(mgrCookie, NEEDLE)
  check('the manager can search', mgr.status === 200, `status ${mgr.status}`)
  check('…and finds the customer', titles(mgr.groups).includes(`${NEEDLE} Tan`), titles(mgr.groups).slice(0, 200))
  check('…and the cat', titles(mgr.groups).includes(`${NEEDLE} Cat`), titles(mgr.groups).slice(0, 200))

  // ══ 2. THE POINT: a groomer gets the cat and NOT the customer ══
  //
  // Groomer's granted paths are /board and /cats. `/customers` is not among
  // them, so a customer record must not come back — not filtered in the client,
  // not returned at all.
  const gCookie = await loginPin(GROOMER_PIN)
  check('the groomer can sign in', gCookie.startsWith('auth='), gCookie.slice(0, 20))
  const groomer = await search(gCookie, NEEDLE)
  check('the groomer can search', groomer.status === 200, `status ${groomer.status}`)

  const gText = titles(groomer.groups)
  const gJsonEarly = JSON.stringify(groomer.groups)
  check('the groomer DOES find the cat they work with', gText.includes(`${NEEDLE} Cat`), gText.slice(0, 200))

  // Asserted on the RESULT, not on the text.
  //
  // The first version of this check searched every title and subtitle for the
  // owner's name and failed — but what it caught was the owner's name appearing
  // as CONTEXT on a cat ("Milo · Domestic Shorthair · Chong Mei Yee"), which is
  // exactly what /cats and /board already show a groomer on pages they can open.
  // Hiding it only in the palette would be theatre, not access control.
  //
  // The claim that actually matters is narrower and absolute: no customer comes
  // back as a RESULT, and nothing links into /customers.
  check('the groomer gets no Customers group at all',
    !groomer.groups.some(g => g.key === 'customers'),
    groomer.groups.map(g => g.key).join(', '))
  check('…and nothing in the response links to a customer page',
    !gJsonEarly.includes('"href":"/customers'),
    'a /customers link leaked to a role that cannot open it')
  check('…nor the customer phone number, which /cats shows but the palette should not volunteer',
    !gJsonEarly.includes('+60102223344'),
    'a phone number leaked')

  // ══ 3. Every returned href must be openable by its holder ══
  //
  // The strongest form of the claim: rather than trusting the category rules,
  // FOLLOW each link the groomer was given and confirm none of them bounce.
  let bounced = []
  for (const item of allItems(groomer.groups).slice(0, 12)) {
    const res = await fetch(`${BASE}${item.href}`, { headers: { Cookie: gCookie }, redirect: 'manual' })
    if (res.status !== 200) bounced.push(`${item.href} -> ${res.status}`)
  }
  check('every result the groomer was given actually opens for them',
    bounced.length === 0, bounced.slice(0, 4).join(', '))

  // ══ 4. Manager-only areas never appear for staff ══
  const gJson = JSON.stringify(groomer.groups)
  const leaked = ['/revenue', '/finance', '/inventory', '/customers', '/staff', '/hr', '/admin']
    .filter(p => gJson.includes(`"href":"${p}`))
  check('no manager-only destination appears in a groomer’s results',
    leaked.length === 0, leaked.join(', '))

  // ══ 5. Front desk sits between the two ══
  const fCookie = await loginPin(FRONT_PIN)
  const front = await search(fCookie, NEEDLE)
  const fText = titles(front.groups)
  check('front desk DOES get the customer', fText.includes(`${NEEDLE} Tan`), fText.slice(0, 200))
  check('…but still nothing from finance',
    !JSON.stringify(front.groups).includes('"href":"/finance'), 'finance leaked to front desk')

  // ══ 6. A blank query does not dump the database ══
  const blank = await search(mgrCookie, '')
  check('an empty query returns nothing rather than everything',
    allItems(blank.groups).length === 0, `${allItems(blank.groups).length} items`)
  const oneChar = await search(mgrCookie, 'a')
  check('a single character does not return the whole table',
    allItems(oneChar.groups).length === 0, `${allItems(oneChar.groups).length} items`)

  // ══ 7. Pages are searchable, and filtered the same way ══
  const pageHit = await search(mgrCookie, 'income')
  check('pages are searchable by name', titles(pageHit.groups).toLowerCase().includes('income'),
    titles(pageHit.groups).slice(0, 200))
  const gPages = await search(gCookie, 'income')
  check('…and a page the role cannot open is not offered',
    !JSON.stringify(gPages.groups).includes('/finance'), 'a finance page was offered to a groomer')

  // ══ 8. Results say where they came from (the owner asked for this) ══
  check('results are grouped, and each group is labelled',
    mgr.groups.length > 0 && mgr.groups.every(g => typeof g.label === 'string' && g.label.length > 0),
    JSON.stringify(mgr.groups.map(g => g.label)))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up seeded data')
}
