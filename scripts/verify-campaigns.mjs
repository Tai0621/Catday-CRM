import 'dotenv/config'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// M1 — Campaign Studio.
//
// No model call. The model picks the SHAPE of an offer; everything that decides
// whether the offer is a good idea is computed, and that is what is proved:
//
//   • the economics — contribution after commission, campaign cost, break-even
//   • cannibalisation — an offer aimed at days that are already busy is flagged
//   • no forecast — nothing here predicts uptake or revenue, because no
//     conversion rate has been measured
//   • the send is gated — approval first, then the SAME consent floor and
//     frequency cap M10 enforces, per customer at send time
//   • a send writes a GroupSend too, or a campaign would be invisible to the cap
//
// Run the server WITHOUT ANTHROPIC_API_KEY: no offer can be generated, which is
// why campaigns are seeded directly.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYM1'
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
const campaignId = `${MARK}-camp`
const custId = `${MARK}-cust`
const cappedId = `${MARK}-capped`
const catId = `${MARK}-cat`

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
    exec(`DELETE FROM "CampaignRecipient" WHERE campaignId LIKE '${MARK}%'`),
    exec(`DELETE FROM "Campaign" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "GroupSend" WHERE customerId IN (?,?)`, [t(custId), t(cappedId)]),
    exec(`DELETE FROM "AuditLog" WHERE entityId LIKE '${MARK}%'`),
    exec(`DELETE FROM "Appointment" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Cat" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Customer" WHERE id LIKE '${MARK}%'`),
  ])
}

try {
  await cleanup()

  // ══ 1. The economics, exercised directly ══
  const outDir = mkdtempSync(join(tmpdir(), 'm1-'))
  execSync(`npx tsc lib/campaigns/economics.ts --outDir "${outDir}" --module es2022 --target es2022 --moduleResolution bundler`,
    { stdio: 'pipe' })
  const F = await import(pathToFileURL(join(outDir, 'economics.js')).href)

  const service = {
    id: 's', name: 'Full Groom', category: 'Grooming',
    price: 200, commissionPct: 20, contributionRM: 160, contributionPct: 80,
  }
  const slack = [{ weekday: 'Tuesday', groomUtilisationPct: 20, occupancyPct: 15 }]
  const busy = [{ weekday: 'Saturday', groomUtilisationPct: 92, occupancyPct: 80 }]

  const e = F.offerEconomics(service, 25, 100, 0.35, slack)
  check('the discounted price is computed from the real price',
    e.discountedPrice === 150, String(e.discountedPrice))
  check('commission is charged on the FULL price, not the discounted one',
    e.contributionPerBookingRM === 110, `${e.contributionPerBookingRM} (150 − 20% of 200)`)
  check('the campaign cost is the audience times the message cost',
    e.campaignCostRM === 35, String(e.campaignCostRM))
  check('break-even is bookings needed to cover the messages',
    e.breakEvenBookings === 1, String(e.breakEvenBookings))
  check('a slack target is not flagged', e.cannibalisationRisk === false, JSON.stringify(e))

  const risky = F.offerEconomics(service, 25, 100, 0.35, busy)
  check('an offer aimed at busy days IS flagged', risky.cannibalisationRisk === true,
    `utilisation ${risky.targetedUtilisationPct}`)

  const deep = F.offerEconomics({ ...service, commissionPct: 50 }, 40, 500, 0.35, slack)
  check('a thin-margin deep discount needs many more bookings',
    deep.breakEvenBookings > e.breakEvenBookings, `${deep.breakEvenBookings} vs ${e.breakEvenBookings}`)

  const free = F.offerEconomics(service, 0, 10, 0.35, slack)
  check('a zero-discount offer keeps its full contribution',
    free.contributionPerBookingRM === 160, String(free.contributionPerBookingRM))

  const worthless = F.offerEconomics({ ...service, commissionPct: 100 }, 50, 10, 0.35, slack)
  check('an offer that cannot pay for itself reports no break-even, not a divide by zero',
    worthless.breakEvenBookings === null, String(worthless.breakEvenBookings))

  // ══ 2. No forecast anywhere ══
  const factsSrc = readFileSync('lib/campaigns/facts.ts', 'utf8')
  // Strip comments AND string literals: this module explains in prose that it
  // produces no forecast, and the word "forecast" in that sentence would fail
  // the check it exists to describe.
  const factsCode = factsSrc
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``')
  check('no uptake or conversion rate is invented',
    !/expectedUptake|conversionRate|projectedRevenue|forecast/i.test(factsCode),
    'a forecast crept in')
  check('…and the omission is stated', /no revenue forecast|would be invented/i.test(factsSrc))

  const genSrc = readFileSync('lib/campaigns/generate.ts', 'utf8')
  check('the model is forbidden from predicting uptake', /do not predict uptake or revenue/i.test(genSrc))
  check('every offer is re-costed rather than trusting the model\'s arithmetic',
    /offerEconomics\(service/.test(genSrc), 'the model\'s own numbers reach the screen')
  check('a discount is capped', /MAX_PROPOSED_DISCOUNT_PCT/.test(genSrc))
  check('an offer naming an unknown service is dropped',
    /filter\(o => o\.name && o\.message && o\.serviceName\)/.test(genSrc))
  check('generation fails closed without a key', /no-key/.test(genSrc) && /budget\.limit === 0/.test(genSrc))

  // ══ 3. Seed a campaign and drive the gate ══
  const now = iso(new Date())
  await pipe([
    exec(`INSERT INTO "Customer" (id,phone,name,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 1, ?, ?)`,
      [t(custId), t('60155000001'), t(`${MARK} Reachable`), t(iso(new Date(Date.now() - 400 * DAY))), t(now)]),
    exec(`INSERT INTO "Customer" (id,phone,name,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 1, ?, ?)`,
      [t(cappedId), t('60155000002'), t(`${MARK} Capped`), t(iso(new Date(Date.now() - 400 * DAY))), t(now)]),
    exec(`INSERT INTO "Cat" (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`,
      [t(catId), t(custId), t(`${MARK}Cat`), t(now), t(now)]),
    exec(`INSERT INTO "Cat" (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`,
      [t(`${catId}-2`), t(cappedId), t(`${MARK}Cat2`), t(now), t(now)]),
    // BOTH lapsed the same way — one old completed visit, nothing since — so
    // the only thing separating them in the worklist is the recent message.
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Completed', 1, ?, ?)`,
      [t(`${MARK}-a1`), t(custId), t(catId), t(iso(new Date(Date.now() - 200 * DAY))), t(now), t(now)]),
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Completed', 1, ?, ?)`,
      [t(`${MARK}-a2`), t(cappedId), t(`${catId}-2`), t(iso(new Date(Date.now() - 200 * DAY))), t(now), t(now)]),
    // Messaged yesterday under a DIFFERENT audience key — the cap is global, so
    // it must still hold for a campaign targeting another group.
    exec(`INSERT INTO "GroupSend" (id,groupKey,customerId,channel,sentAt)
          VALUES (?, 'at-risk', ?, 'WhatsApp', ?)`,
      [t(`${MARK}-gs`), t(cappedId), t(iso(new Date(Date.now() - DAY)))]),
  ])

  await pipe([exec(
    `INSERT INTO "Campaign" (id,name,intent,offerType,discountPct,validFrom,validTo,targetGroupKey,message,rationale,facts,status,createdAt,updatedAt)
     VALUES (?,?,?, 'Discount', ?, ?, ?, 'lapsed-90', ?, ?, ?, 'Draft', ?, ?)`,
    [t(campaignId), t(`${MARK} Midweek fill`), t(`${MARK} fill midweek`), f(20),
      t(now), t(iso(new Date(Date.now() + 30 * DAY))),
      t(`${MARK}-COPY Hi {customer}, {cat} is due a groom.`), t('Tuesdays run at 20%'),
      t(JSON.stringify({ economics: { contributionPerBookingRM: 110, campaignCostRM: 35, breakEvenBookings: 1, cannibalisationRisk: false, targetedUtilisationPct: 20 } })),
      t(now), t(now)])])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const listUrl = `${BASE}/marketing/campaigns`
  const sendUrl = `${BASE}/marketing/campaigns/${campaignId}`
  let html = await (await fetch(listUrl, { headers: { cookie } })).text()
  check('the studio lists the draft', html.includes(`${MARK} Midweek fill`), 'draft missing')
  check('the break-even is shown, not a projected profit',
    /break even/i.test(html) && !/projected revenue/i.test(html), 'no break-even on screen')

  // ══ 4. A draft cannot be sent ══
  let send = await (await fetch(sendUrl, { headers: { cookie } })).text()
  check('an unapproved campaign has no send list',
    /has not been approved/.test(send), 'a draft is sendable')
  const before = await one(`SELECT COUNT(*) FROM "CampaignRecipient" WHERE campaignId = ?`, [t(campaignId)])
  check('…and nothing has been recorded', Number(before[0][0]) === 0, String(before[0][0]))

  // ══ 5. Approve, then send ══
  const approveForm = findForm(html, `value="${campaignId}"`)
  check('approval is a real form', !!approveForm, 'no approve form')
  await submit(listUrl, approveForm, [['id', campaignId]], cookie)

  const status = await one(`SELECT status, ownerApprovedAt FROM "Campaign" WHERE id = ?`, [t(campaignId)])
  check('approving records who and when', status[0]?.[0] === 'Approved' && !!status[0]?.[1],
    JSON.stringify(status[0]))
  const audit = await one(`SELECT summary FROM "AuditLog" WHERE entityId = ?`, [t(campaignId)])
  check('…and is audited', audit.length === 1 && /Approved campaign/.test(String(audit[0][0])), JSON.stringify(audit))

  send = await (await fetch(sendUrl, { headers: { cookie } })).text()
  check('the reachable customer is on the send list', send.includes(`${MARK} Reachable`), 'missing from worklist')
  check('the recently-messaged customer is NOT', !send.includes(`${MARK} Capped`),
    'the frequency cap was bypassed')
  check('the worklist explains why it is one at a time',
    /inbound-only/.test(send) && /pre-approved templates/.test(send), 'the scope limit is unstated')

  const sendForm = findForm(send, `value="${custId}"`)
  check('marking a send is a real form', !!sendForm, 'no send form')
  await submit(sendUrl, sendForm, [['campaignId', campaignId], ['customerId', custId]], cookie)

  const recipient = await one(
    `SELECT sentAt FROM "CampaignRecipient" WHERE campaignId = ? AND customerId = ?`, [t(campaignId), t(custId)])
  check('the send is recorded against the campaign', recipient.length === 1 && !!recipient[0][0],
    JSON.stringify(recipient))

  const groupSend = await one(
    `SELECT groupKey FROM "GroupSend" WHERE customerId = ? AND groupKey = 'lapsed-90'`, [t(custId)])
  check('…and ALSO as a GroupSend, so the global cap can see it', groupSend.length === 1,
    'a campaign send is invisible to the frequency cap')

  const running = await one(`SELECT status FROM "Campaign" WHERE id = ?`, [t(campaignId)])
  check('the campaign moves to Running on its first send', running[0][0] === 'Running', String(running[0][0]))

  send = await (await fetch(sendUrl, { headers: { cookie } })).text()
  check('a customer already sent to drops off the list', !send.includes(`${MARK} Reachable`),
    'the same person can be messaged twice')

  // ══ 6. Source guarantees ══
  const indexSrc = readFileSync('lib/campaigns/index.ts', 'utf8')
  check('every send goes through the same consent gate as M10',
    /canMessage\(customerId\)/.test(indexSrc), 'a campaign can bypass the consent floor')
  check('the worklist re-checks consent at send time, not at approval',
    /await canMessage\(m\.id\)/.test(indexSrc))
  check('only an approved campaign can be sent', /Only an approved campaign can be sent/.test(indexSrc))
  const indexCode = indexSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('there is no bulk-send path', !/sendAll|bulkSend|broadcast/i.test(indexCode), 'a blast path exists')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
