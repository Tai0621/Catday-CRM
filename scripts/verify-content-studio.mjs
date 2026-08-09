import 'dotenv/config'
import { readFileSync } from 'node:fs'

// M3 — Content Studio.
//
// No model call. The consent gate is the feature, so that is what is proved:
//
//   • a household without marketing consent NEVER appears in the pool
//   • a withdrawn cat never appears, even though the household still consents
//   • the two permissions are separate — withdrawing a cat must not silently
//     revoke the household's marketing consent
//   • a pair needs BOTH photos; a before-only groom is not a post
//   • withdrawing destroys any draft already written for that cat
//   • eligibility is re-checked before spending, not just at render
//
// Run the server WITHOUT ANTHROPIC_API_KEY so the caption path is inert.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYM3'
const t = v => ({ type: 'text', value: String(v) })
const n = v => ({ type: 'integer', value: String(v) })
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
const ago = n => new Date(Date.now() - n * 86400000)

// yes  — consents, both photos          → in the pool
// no   — no marketing consent           → excluded
// out  — consents but cat withdrawn     → excluded
// half — consents but only a before shot → excluded
const CASES = ['yes', 'no', 'out', 'half']
const cust = k => `${MARK}-c-${k}`
const cat = k => `${MARK}-cat-${k}`
const appt = k => `${MARK}-a-${k}`

const formsIn = html => [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => ({
  actionId: (m[1].match(/name="(\$ACTION_ID_[0-9a-f]+)"/) ?? [])[1] ?? null, body: m[1],
}))
const findForm = (html, marker) => formsIn(html).find(f => f.actionId && f.body.includes(marker)) ?? null

async function submit(url, form, fields, cookie) {
  const fd = new FormData()
  fd.append(form.actionId, '')
  for (const [k, v] of fields) fd.append(k, v)
  const r = await fetch(url, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' })
  await r.text()
  return r.status
}

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "ContentDraft" WHERE appointmentId LIKE '${MARK}%'`),
    exec(`DELETE FROM "MediaAsset" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "AuditLog" WHERE entityId LIKE '${MARK}%'`),
    exec(`DELETE FROM "Appointment" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Cat" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Customer" WHERE id LIKE '${MARK}%'`),
  ])
}

try {
  await cleanup()
  const now = iso(new Date())

  for (const [i, k] of CASES.entries()) {
    const consent = k === 'no' ? 0 : 1
    const optOut = k === 'out' ? 1 : 0
    await pipe([
      exec(`INSERT INTO "Customer" (id,phone,name,source,marketingConsent,createdAt,updatedAt)
            VALUES (?,?,?, 'WalkIn', ?, ?, ?)`,
        [t(cust(k)), t(`6016600000${i}`), t(`${MARK} Owner ${k}`), n(consent), t(now), t(now)]),
      exec(`INSERT INTO "Cat" (id,customerId,name,breed,contentOptOut,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?)`,
        [t(cat(k)), t(cust(k)), t(`${MARK}Cat-${k}`), t('Persian'), n(optOut), t(now), t(now)]),
      exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,price,paid,createdAt,updatedAt)
            VALUES (?,?,?, 'Grooming', ?, 'Completed', 120, 1, ?, ?)`,
        [t(appt(k)), t(cust(k)), t(cat(k)), t(iso(ago(10))), t(now), t(now)]),
    ])

    // Both shots, except the 'half' case which has only a before.
    const media = [
      exec(`INSERT INTO "MediaAsset" (id,ownerType,ownerId,tag,url,pathname,kind,contentType,size,createdAt)
            VALUES (?, 'appointment', ?, 'groom-before', ?, ?, 'image', 'image/jpeg', 1024, ?)`,
        [t(`${MARK}-m-${k}-b`), t(appt(k)), t(`https://example.invalid/${k}-b.jpg`), t(`${k}-b.jpg`), t(now)]),
    ]
    if (k !== 'half') {
      media.push(exec(`INSERT INTO "MediaAsset" (id,ownerType,ownerId,tag,url,pathname,kind,contentType,size,createdAt)
            VALUES (?, 'appointment', ?, 'groom-after', ?, ?, 'image', 'image/jpeg', 1024, ?)`,
        [t(`${MARK}-m-${k}-a`), t(appt(k)), t(`https://example.invalid/${k}-a.jpg`), t(`${k}-a.jpg`), t(now)]))
    }
    await pipe(media)
  }

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const url = `${BASE}/marketing/content`
  const load = async () => (await fetch(url, { headers: { cookie } })).text()
  let html = await load()
  check('the studio renders', html.includes('Content Studio'), 'page missing')

  // ══ 1. The gate ══
  check('a consenting household with both photos is offered',
    html.includes(`${MARK}Cat-yes`), 'the eligible pair is missing')
  check('a household without marketing consent is NEVER offered',
    !html.includes(`${MARK}Cat-no`), 'a non-consenting household reached the pool')
  check('a withdrawn cat is not offered, even though the household consents',
    !html.includes(`${MARK}Cat-out`), 'a withdrawn cat reached the pool')
  check('a groom with only a before shot is not a post',
    !html.includes(`${MARK}Cat-half`), 'a half pair reached the pool')
  check('the exclusions are stated rather than silent',
    /excluded for no marketing consent/.test(html), 'the gate is invisible')
  check('every offered pair carries a consent badge', /consented/.test(html), 'no badge')

  // ══ 2. Withdrawing ══
  // Plant a draft first, so its removal can be observed.
  await pipe([exec(
    `INSERT INTO "ContentDraft" (id,appointmentId,caption,hashtags,status,model,createdAt,updatedAt)
     VALUES (?,?,?,?, 'Draft', 'seeded', ?, ?)`,
    [t(`${MARK}-draft`), t(appt('yes')), t(`${MARK} caption`), t('["#a"]'), t(now), t(now)])])

  html = await load()
  check('a drafted caption is shown', html.includes(`${MARK} caption`), 'draft not rendered')

  const withdraw = findForm(html, `value="${cat('yes')}"`)
  check('withdrawing is one click from the same screen', !!withdraw, 'no withdraw form')
  await submit(url, withdraw, [['catId', cat('yes')]], cookie)

  const flag = await one(`SELECT contentOptOut FROM "Cat" WHERE id = ?`, [t(cat('yes'))])
  check('the cat is withdrawn', String(flag[0][0]) === '1', String(flag[0][0]))

  const consentAfter = await one(`SELECT marketingConsent FROM "Customer" WHERE id = ?`, [t(cust('yes'))])
  check('…and the household is STILL contactable — the permissions are separate',
    String(consentAfter[0][0]) === '1', `marketingConsent is now ${consentAfter[0][0]}`)

  const draftAfter = await one(`SELECT COUNT(*) FROM "ContentDraft" WHERE appointmentId = ?`, [t(appt('yes'))])
  check('…and the draft written under that permission is gone', Number(draftAfter[0][0]) === 0,
    `${draftAfter[0][0]} drafts remain`)

  const audit = await one(`SELECT summary FROM "AuditLog" WHERE entityId = ?`, [t(cat('yes'))])
  check('the withdrawal is audited', audit.length === 1 && /withdrawn/i.test(String(audit[0][0])),
    JSON.stringify(audit))

  html = await load()
  check('the pair disappears from the studio', !html.includes(`${MARK}Cat-yes`), 'still offered after withdrawal')

  // ══ 3. Spending is gated on the same check ══
  const captionSrc = readFileSync('lib/content/caption.ts', 'utf8')
  check('eligibility is re-checked before the model call, not just at render',
    captionSrc.indexOf('candidateFor') < captionSrc.indexOf('ANTHROPIC_API_KEY'),
    'consent is checked after deciding to spend')
  check('captions fail closed without a key', /no-key/.test(captionSrc))
  check('…and respect the AI kill switch', /budget\.limit === 0/.test(captionSrc))
  check('usage is recorded against the budget', /recordUsage/.test(captionSrc))

  const studioSrc = readFileSync('lib/content/studio.ts', 'utf8')
  check('both gates are in the QUERY, not applied afterwards',
    /marketingConsent: true, erasedAt: null/.test(studioSrc) && /contentOptOut: false/.test(studioSrc),
    'a gate is missing from the pool query')
  check('an erased customer can never be published', /erasedAt: null/.test(studioSrc))

  const actionsSrc = readFileSync('app/marketing/content/actions.ts', 'utf8')
  // Comments stripped first: this file explains in prose that it must not touch
  // marketing consent, and matching that sentence would fail the check it is
  // there to describe.
  const actionsCode = actionsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('withdrawing never touches marketing consent',
    !/marketingConsent/.test(actionsCode), 'withdrawal has a consent side effect')

  // ══ 4. Nothing is auto-published ══
  const pageSrc = readFileSync('app/marketing/content/page.tsx', 'utf8')
  const exportSrc = readFileSync('app/marketing/content/PairExport.tsx', 'utf8')
  check('the output is a draft the owner posts', /you post it yourself/i.test(pageSrc))
  check('…and the composer says so too', /Nothing is published from here/.test(exportSrc))
  check('no social API is called', !/graph\.facebook|instagram|api\.twitter|oauth/i.test(exportSrc + pageSrc + actionsSrc))

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
