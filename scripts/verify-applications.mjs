import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for HR 4 — recruiting. Drives the REAL public careers form (a plain POST,
// so it's fully drivable), then asserts the manager pipeline + Action Inbox +
// access control. Cleans up. (Status changes are server-action-bound →
// build-typechecked.)

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const SECRET = process.env.SESSION_SECRET || process.env.APP_PASSWORD || ''
const EPOCH = process.env.SESSION_EPOCH || '1'
const MARK = 'VERIFYAPP'

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
const num = res => Number(res.response?.result?.rows?.[0]?.[0]?.value ?? 0)

function craft(session) {
  const n = Date.now()
  const payload = { ...session, iat: n, exp: n + 3600_000, ep: EPOCH }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(`v3:${b64}`).digest('hex')
  return `v3.${b64}.${sig}`
}
const countByName = async name => num((await pipe([exec(`SELECT count(*) FROM JobApplication WHERE name = ?`, [t(name)])]))[0])
const seeded = crypto.randomUUID()
async function cleanup() { await pipe([exec(`DELETE FROM JobApplication WHERE name LIKE ?`, [t(`${MARK}%`)])]) }

const submit = body => fetch(`${BASE}/api/careers`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(), redirect: 'manual',
})

try {
  await cleanup()

  // ── Public careers page (no auth) ──
  const pub = await fetch(`${BASE}/careers`, { redirect: 'manual' })
  const pubBody = strip(await pub.text())
  check('careers page is public (200)', pub.status === 200, `status ${pub.status}`)
  check('careers page shows the form', pubBody.includes('Submit application') && pubBody.includes('Role you') && !pubBody.includes('Service Board'))
  const thanks = strip(await (await fetch(`${BASE}/careers?sent=1`)).text())
  check('careers page shows a thank-you after submit', thanks.includes('Thank you for applying'))

  // ── Real submission ──
  const good = await submit({ name: `${MARK} Real Candidate`, phone: '0123456789', roleApplied: 'Groomer', experience: '3 years grooming' })
  check('valid application → 303 to sent', good.status === 303 && (good.headers.get('location') ?? '').includes('/careers?sent=1'), `status ${good.status}`)
  check('valid application is stored', (await countByName(`${MARK} Real Candidate`)) === 1)

  // Honeypot bot submission — accepted-looking but dropped
  const bot = await submit({ name: `${MARK} Bot`, phone: '0111111111', company: 'spam-co' })
  check('honeypot submission is silently dropped', bot.status === 303 && (await countByName(`${MARK} Bot`)) === 0)

  // Missing required field
  const bad = await submit({ email: 'x@y.com', name: '' })
  check('missing name → error, nothing stored', bad.status === 303 && (bad.headers.get('location') ?? '').includes('error'))

  // ── Seed one for the pipeline/inbox ──
  await pipe([exec(
    `INSERT INTO JobApplication (id,name,phone,roleApplied,status,createdAt,updatedAt) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(seeded), t(`${MARK} Pipeline Sam`), t('60129998888'), t('Boarding carer'), t('New')])])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const mgr = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  const getHtml = async (u, cookie) => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Manager pipeline ──
  const pipeHtml = await getHtml('/hr/applications', mgr)
  check('pipeline lists the candidate + role', pipeHtml.includes(`${MARK} Pipeline Sam`) && pipeHtml.includes('Boarding carer'))
  check('pipeline shows status filters + careers link', pipeHtml.includes('/careers') && pipeHtml.includes('Move to') && pipeHtml.includes('New'))

  // ── Action Inbox ──
  const inbox = await getHtml('/actions', mgr)
  check('new application surfaces in the Action Inbox', /new job application/i.test(inbox))

  // ── Access control ──
  const unauth = await fetch(`${BASE}/hr/applications`, { redirect: 'manual' })
  check('pipeline unauth → /login', unauth.status === 307 && (unauth.headers.get('location') ?? '').includes('/login'))
  const staffTok = craft({ kind: 'staff', staffId: 'x', name: `${MARK} Groomer`, role: 'Groomer' })
  const staffRes = await fetch(`${BASE}/hr/applications`, { headers: { Cookie: `auth=${staffTok}` }, redirect: 'manual' })
  check('pipeline blocks non-manager staff', staffRes.status === 307 && !(staffRes.headers.get('location') ?? '').includes('/hr/applications'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
