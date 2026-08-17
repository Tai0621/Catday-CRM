import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// Where the groomer lands after saving an assessment.
//
// The groomer works the SERVICE BOARD — a queue they are clearing. Saving an
// assessment used to drop them on the cat's profile page, one screen away from
// the queue, every single time. The claim here is not "a link changed": it is
// that the real form submission's 303 points back at the board, and that
// arriving from anywhere else still goes to the cat file.
//
// The destination is chosen from a query parameter, so the last check is that
// the parameter cannot NAME the destination — only match a known origin.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYASSESS'

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
const rowsOf = res => (res.response?.result?.rows ?? []).map(row => row.map(c => (c.type === 'null' ? null : c.value)))
const one = async (sql, args = []) => rowsOf((await pipe([exec(sql, args)]))[0])[0]

// ── Server-action driver (AGENTS.md technique A) ────────────────────────────
// The assessment form is a plain no-JS form, so submitting it is an ordinary
// multipart POST back to the same URL.
//
// This action is a CLOSURE over the page's scope (it reads `id` and the origin),
// so Next does not encode it as the `$ACTION_ID_<hex>` field the other verify
// scripts look for — it ships `$ACTION_REF_n` plus one `$ACTION_n:m` field per
// bound value. Rather than special-case either encoding, replay every hidden
// input the page rendered: that is exactly what a browser submits.
const decode = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function formsIn(html) {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => {
    const body = m[1]
    const fields = {}
    for (const tag of body.matchAll(/<input\b[^>]*>/g)) {
      const name = tag[0].match(/\bname="([^"]*)"/)?.[1]
      if (!name) continue
      // `value` is genuinely absent on the action reference field, and dropping
      // it costs the whole submission ("Failed to find Server Action") — so a
      // missing attribute means empty string, not "skip this input".
      fields[decode(name)] = decode(tag[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '')
    }
    const isAction = Object.keys(fields).some(k => k.startsWith('$ACTION_'))
    return { isAction, fields, body }
  })
}
const findForm = (html, marker) => formsIn(html).find(f => f.isAction && f.body.includes(marker)) ?? null

// Returns the whole response — the redirect target is the thing under test.
async function submitForm(pageUrl, form, overrides, cookie) {
  const fd = new FormData()
  for (const [k, v] of Object.entries({ ...form.fields, ...overrides })) fd.append(k, v)
  return fetch(pageUrl, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' })
}

const custId = crypto.randomUUID(), catId = crypto.randomUUID(), apptId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM CatAssessment WHERE catId = ?`, [t(catId)]),
    exec(`DELETE FROM Appointment WHERE customerId = ?`, [t(custId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

const now = new Date()
const todayAt = h => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0)

try {
  await cleanup()

  // A cat mid-groom on the board — the exact state whose card shows "Photos & assess".
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60117775555')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(custId), t(`${MARK}Kitty`)]),
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?,'InService',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(apptId), t(custId), t(catId), t(todayAt(10).toISOString())]),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  if (!cookie.startsWith('auth=')) throw new Error(`no auth cookie (status ${login.status})`)

  // ══ 1. The board's own link declares where it came from ══
  const board = await (await fetch(`${BASE}/board`, { headers: { Cookie: cookie } })).text()
  check('the in-service card links to the assessment', board.includes(`/cats/${catId}/assess`), 'card missing from the board')
  check('…and that link marks the board as the origin',
    new RegExp(`/cats/${catId}/assess\\?appt=${apptId}&(?:amp;)?from=board`).test(board),
    'the board is not tagging its own link')

  const assessUrl = q => `${BASE}/cats/${catId}/assess${q}`
  const openForm = async q => {
    const html = await (await fetch(assessUrl(q), { headers: { Cookie: cookie } })).text()
    const form = findForm(html, 'name="rebookDays"')
    if (!form) throw new Error(`assessment form not found on ${q || '(no query)'}`)
    return form
  }
  const countAssessments = async () =>
    Number((await one(`SELECT COUNT(*) FROM CatAssessment WHERE catId = ?`, [t(catId)]))[0])

  // ══ 2. From the board: save lands back on the board ══
  const fromBoard = `?appt=${apptId}&from=board`
  const r1 = await submitForm(assessUrl(fromBoard), await openForm(fromBoard),
    { skinCondition: 'Healthy', coatCondition: 'Healthy', findings: `${MARK} first`, rebookDays: '35' }, cookie)
  check('saving from the board redirects', r1.status === 303, `status ${r1.status}`)
  check('…back to the SERVICE BOARD, not the cat file',
    (r1.headers.get('location') ?? '').endsWith('/board'), r1.headers.get('location') ?? '(none)')
  check('…and the assessment was actually written', (await countAssessments()) === 1)
  check('…and the rebook cycle reached the cat',
    Number((await one(`SELECT groomingInterval FROM Cat WHERE id = ?`, [t(catId)]))[0]) === 35)

  // ══ 3. Opened from the cat file: unchanged ══
  const r2 = await submitForm(assessUrl(''), await openForm(''),
    { skinCondition: 'Dry', findings: `${MARK} second`, rebookDays: '28' }, cookie)
  check('saving from the cat file still returns to the cat file',
    (r2.headers.get('location') ?? '').endsWith(`/cats/${catId}`), r2.headers.get('location') ?? '(none)')
  check('…and it saved too', (await countAssessments()) === 2)

  // ══ 4. The parameter picks a known origin — it does not NAME a destination ══
  const evil = `?from=${encodeURIComponent('https://evil.example/phish')}`
  const r3 = await submitForm(assessUrl(evil), await openForm(evil),
    { skinCondition: 'Healthy', findings: `${MARK} third`, rebookDays: '30' }, cookie)
  const dest = r3.headers.get('location') ?? ''
  check('an off-site "from" cannot steer the redirect',
    dest.endsWith(`/cats/${catId}`) && !dest.includes('evil.example'), dest || '(none)')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
