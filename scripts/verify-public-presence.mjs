import 'dotenv/config'

// M6 — public presence page, booking requests and the funnel.
//
// No model call. This is the first surface in the OS a stranger can reach, so
// the assertions are mostly about the boundary:
//
//   • unpublished means GONE — page, form endpoint, sitemap and robots
//   • a stranger writes a REQUEST, never an Appointment
//   • the demo is never indexable, published or not
//   • robots defaults to disallow-all and allows three pages back in
//   • structured data carries no aggregateRating, because a thumbs-up is not
//     a star rating and inventing one is a lie that ranks
//   • the funnel joins view → request → booked → showed
//
// The public page is toggled on and off during the run and restored afterwards.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYM6'
const t = v => ({ type: 'text', value: String(v) })
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

const PUBLIC_KEYS = ['publicPage.enabled', 'publicPage.headline', 'publicPage.about', 'publicPage.closedDays']
let before = []

const setSetting = (key, value) => pipe([exec(
  `INSERT INTO "Setting" (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP`, [t(key), t(value)])])

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "BookingRequest" WHERE name LIKE '${MARK}%' OR notes LIKE '%${MARK}%'`),
    exec(`DELETE FROM "AuditLog" WHERE summary LIKE '%${MARK}%'`),
  ])
  const snapshot = new Map(before)
  for (const key of PUBLIC_KEYS) {
    const value = snapshot.get(key)
    await pipe([value == null
      ? exec(`DELETE FROM "Setting" WHERE key = ?`, [t(key)])
      : exec(`INSERT INTO "Setting" (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [t(key), t(value)])])
  }
}

const post = (path, fields) => {
  const body = new URLSearchParams(fields)
  return fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body, redirect: 'manual',
  })
}

try {
  before = await one(
    `SELECT key, value FROM "Setting" WHERE key IN ('publicPage.enabled','publicPage.headline','publicPage.about','publicPage.closedDays')`)
  await cleanup()

  // ══ 1. Unpublished means gone ══
  await setSetting('publicPage.enabled', 'no')

  // Asserted as "the page is not served", not as a status code: notFound()
  // renders its body with a 200 across this whole app (a signed-out
  // /review/<bogus> does the same), which is a pre-existing soft-404 and not
  // something this feature introduced. What must hold is that no page content
  // reaches the visitor.
  const hidden = await fetch(`${BASE}/visit`, { redirect: 'manual' })
  const hiddenBody = await hidden.text()
  check('an unpublished page serves no content',
    !hiddenBody.includes('Request a booking') && !hiddenBody.includes('application/ld+json'),
    `status ${hidden.status}, ${hiddenBody.length} bytes`)

  const hiddenPost = await post('/api/visit', { name: `${MARK} Ghost`, phone: '+60100000001' })
  check('…and its form endpoint is gone too', hiddenPost.status === 404, `status ${hiddenPost.status}`)
  const ghost = await one(`SELECT COUNT(*) FROM "BookingRequest" WHERE name = ?`, [t(`${MARK} Ghost`)])
  check('…so nothing can be written through it', Number(ghost[0][0]) === 0, `${ghost[0][0]} rows`)

  const shutRobots = await (await fetch(`${BASE}/robots.txt`)).text()
  check('robots disallows everything while unpublished',
    /Disallow:\s*\/\s*$/m.test(shutRobots) && !/Allow:/.test(shutRobots), shutRobots.slice(0, 120))

  const shutSitemap = await (await fetch(`${BASE}/sitemap.xml`)).text()
  check('the sitemap is empty while unpublished', !shutSitemap.includes('/visit'), shutSitemap.slice(0, 160))

  // ══ 2. Published ══
  await setSetting('publicPage.enabled', 'yes')
  await setSetting('publicPage.headline', `${MARK} headline`)
  await setSetting('publicPage.closedDays', 'Monday')

  const page = await fetch(`${BASE}/visit`)
  const html = await page.text()
  check('the published page is served to a stranger, with no cookie',
    page.status === 200, `status ${page.status}`)
  check('a bool setting round-trips through the config seam',
    html.includes(`${MARK} headline`), 'publicPage.enabled=yes did not take effect')
  // React splits adjacent text nodes ("Closed " + {value} → `Closed <!-- -->Monday`),
  // so match the two parts rather than the joined string.
  check('closed days are shown', /Closed\b[\s\S]{0,20}Monday/.test(html), 'closed days missing')
  check('the booking form is present', html.includes('name="phone"') && html.includes('/api/visit'))
  check('a honeypot field is present', html.includes('name="company"'), 'no bot trap')

  // ══ 3. Structured data ══
  const ld = (html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/) ?? [])[1]
  check('LocalBusiness structured data is emitted', !!ld, 'no JSON-LD block')
  let schema = {}
  try { schema = JSON.parse(ld ?? '{}') } catch { /* reported below */ }
  check('…and it is valid JSON', Object.keys(schema).length > 0, String(ld ?? '').slice(0, 120))
  check('…typed as a LocalBusiness', schema['@type'] === 'LocalBusiness', String(schema['@type']))
  check('…carrying the tenant\'s own name', typeof schema.name === 'string' && schema.name.length > 0, String(schema.name))
  check('…and its service catalogue', !!schema.hasOfferCatalog, 'no offer catalogue')
  check('NO aggregateRating is claimed', !('aggregateRating' in schema) && !/aggregateRating/.test(ld ?? ''),
    'a rating is being asserted from thumbs-up data')
  check('no key is emitted undefined', !/:\s*undefined/.test(ld ?? ''), 'undefined leaked into the JSON-LD')

  // ══ 4. The demo is never indexable ══
  // This deployment is not production, so both must stay shut even when published.
  const openRobots = await (await fetch(`${BASE}/robots.txt`)).text()
  check('a non-production deployment still disallows crawlers',
    !/Allow:/.test(openRobots), openRobots.slice(0, 120))
  const openSitemap = await (await fetch(`${BASE}/sitemap.xml`)).text()
  check('…and still publishes no sitemap', !openSitemap.includes('/visit'), openSitemap.slice(0, 160))
  check('…and the page itself is marked noindex', /noindex/i.test(html), 'no robots meta on a demo page')

  // ══ 5. A stranger creates a request, never an appointment ══
  const apptsBefore = Number((await one(`SELECT COUNT(*) FROM "Appointment"`))[0][0])

  const sent = await post('/api/visit', {
    name: `${MARK} Visitor`, phone: '012-345 6789', catName: 'Mochi',
    serviceName: 'Full Groom', preferredDate: '2099-01-15', notes: `${MARK} please call after 6`,
  })
  check('a request is accepted', sent.status === 303, `status ${sent.status}`)

  const made = await one(
    `SELECT status, appointmentId, catName, preferredDate, phone FROM "BookingRequest" WHERE name = ?`,
    [t(`${MARK} Visitor`)])
  check('it is stored', made.length === 1, `${made.length} rows`)
  check('…as New and unbooked', made[0]?.[0] === 'New' && made[0]?.[1] == null, JSON.stringify(made[0]))
  check('…with the details given', made[0]?.[2] === 'Mochi' && made[0]?.[3] === '2099-01-15', JSON.stringify(made[0]))
  check('…and a phone number normalised to the same shape the CRM stores',
    String(made[0]?.[4]) === '60123456789', String(made[0]?.[4]))

  const apptsAfter = Number((await one(`SELECT COUNT(*) FROM "Appointment"`))[0][0])
  check('NO appointment was created by a stranger', apptsAfter === apptsBefore,
    `${apptsBefore} → ${apptsAfter}`)

  // ══ 6. Abuse guards ══
  const honeypot = await post('/api/visit', {
    name: `${MARK} Bot`, phone: '+60100000002', company: 'Acme Spam Ltd',
  })
  check('a honeypot submission looks like success', honeypot.status === 303, `status ${honeypot.status}`)
  const botRow = await one(`SELECT COUNT(*) FROM "BookingRequest" WHERE name = ?`, [t(`${MARK} Bot`)])
  check('…but writes nothing', Number(botRow[0][0]) === 0, `${botRow[0][0]} rows`)

  const missing = await post('/api/visit', { name: '', phone: '' })
  check('a request without a name or phone is refused',
    missing.status === 303 && (missing.headers.get('location') ?? '').includes('error=1'),
    missing.headers.get('location') ?? String(missing.status))

  for (let i = 0; i < 6; i++) {
    await post('/api/visit', { name: `${MARK} Flood`, phone: '012-345 6789' })
  }
  const flooded = await one(`SELECT COUNT(*) FROM "BookingRequest" WHERE phone LIKE '%3456789'`)
  check('repeat submissions from one number are capped', Number(flooded[0][0]) <= 5, `${flooded[0][0]} rows in a day`)

  // ══ 7. Views are counted, bots are not ══
  // Summed across every day rather than assuming which local day the counter
  // lands on — the tenant timezone decides that, and the test should not need
  // to re-derive it to be meaningful.
  const totalViews = async () =>
    Number((await one(`SELECT COALESCE(SUM(views),0) FROM "PublicPageView"`))[0][0])

  // The body must be consumed before reading the counter: fetch() resolves as
  // soon as the headers arrive, while the page is still streaming, so the write
  // inside the render has not necessarily landed yet.
  const visitAs = async ua => {
    const r = await fetch(`${BASE}/visit`, ua ? { headers: { 'user-agent': ua } } : undefined)
    await r.text()
  }

  const viewsBefore = await totalViews()
  await visitAs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')
  const viewsAfter = await totalViews()
  check('a human view is counted', viewsAfter === viewsBefore + 1, `${viewsBefore} → ${viewsAfter}`)

  await visitAs('Googlebot/2.1 (+http://www.google.com/bot.html)')
  const afterBot = await totalViews()
  check('a crawler is not', afterBot === viewsAfter, `${viewsAfter} → ${afterBot}`)

  // Node's own fetch sends a user agent of exactly "node", so this is also the
  // regression test for server-to-server traffic inflating the funnel.
  await visitAs(null)
  const afterScript = await totalViews()
  check('a scripted request is not counted either', afterScript === afterBot, `${afterBot} → ${afterScript}`)

  // ══ 8. Staff side ══
  const anonRequests = await fetch(`${BASE}/requests`, { redirect: 'manual' })
  check('the requests list is behind the login gate',
    anonRequests.status >= 300 && anonRequests.status < 400
    && (anonRequests.headers.get('location') ?? '').includes('/login'), `status ${anonRequests.status}`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const staffPage = await fetch(`${BASE}/requests`, { headers: { cookie } })
  const staffHtml = await staffPage.text()
  check('the request appears for staff', staffPage.status === 200 && staffHtml.includes(`${MARK} Visitor`),
    `status ${staffPage.status}`)
  check('the funnel is shown', staffHtml.includes('page views') && staffHtml.includes('showed up'),
    'no funnel on the requests page')
  check('the page is honest about bot noise in the view count',
    /crawlers|trend, not a headcount/i.test(staffHtml), 'no caveat on the view number')

  // ══ 9. Source guarantees ══
  const fs = await import('node:fs')
  const apiSrc = fs.readFileSync('app/api/visit/route.ts', 'utf8')
  check('the public endpoint never touches the appointment table',
    !/db\.appointment\./.test(apiSrc), 'the public form can reach appointments')
  check('…and refuses outright when unpublished', /publicPage\.enabled/.test(apiSrc))
  const schemaSrc = fs.readFileSync('lib/public/schema.ts', 'utf8')
  const schemaCode = schemaSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('the omission of aggregateRating is enforced in code, not just prose',
    !/aggregateRating/.test(schemaCode), 'aggregateRating appears outside the comment')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
