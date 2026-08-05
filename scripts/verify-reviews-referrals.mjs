import 'dotenv/config'

// M4 review engine + M5 referral engine.
//
// Two things must hold, and both are driven through the real server actions:
//
//   M4 — THE SENTIMENT GATE. A negative answer must not offer a public review
//        link, and must raise an Incident, so unhappiness reaches a human
//        instead of a review site.
//   M5 — THE MONEY. Crediting a referral must move BOTH wallet balances and
//        write a matching ledger entry for each (data-integrity rule 2), and
//        must refuse to pay a second time.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYRR'
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
const rowsOf = res => res.response.result.rows.map(row => row.map(c => (c.type === 'null' ? null : c.value)))
const one = async (sql, args = []) => rowsOf((await pipe([exec(sql, args)]))[0])[0]
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)

// ── Server-action driver ────────────────────────────────────────────────────
// A <form action={serverFn}> rendered from a server component ships as a real
// no-JS form: method=POST, multipart, with a hidden "$ACTION_ID_<hex>" field.
// Submitting that form is therefore just a multipart POST back to the same URL —
// no Next-Action header, no scraping chunks for $$RSC_SERVER_ACTION.
//
// This is preferable to the chunk-scraping approach in AGENTS.md for FormData
// actions: it is what a browser without JavaScript does, so it works identically
// against `next dev` and `next start` instead of only the dev server.
function formsIn(html) {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => {
    const body = m[1]
    const actionId = (body.match(/name="(\$ACTION_ID_[0-9a-f]+)"/) ?? [])[1] ?? null
    const fields = {}
    for (const f of body.matchAll(/<input\b[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"/g)) {
      if (!f[1].startsWith('$ACTION_ID')) fields[f[1]] = f[2]
    }
    return { actionId, fields, body }
  })
}

/** The first form on the page whose markup contains `marker`. */
function findForm(html, marker) {
  return formsIn(html).find(f => f.actionId && f.body.includes(marker)) ?? null
}

async function submitForm(pageUrl, form, overrides = {}, cookie) {
  const fd = new FormData()
  fd.append(form.actionId, '')
  for (const [k, v] of Object.entries({ ...form.fields, ...overrides })) fd.append(k, v)
  const r = await fetch(pageUrl, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: fd,
    redirect: 'manual',
  })
  return r.status
}

const referrer = crypto.randomUUID(), referred = crypto.randomUUID()
const catId = crypto.randomUUID(), apptId = crypto.randomUUID(), referralId = crypto.randomUUID()
const sadTok = `${MARK}sad`, happyTok = `${MARK}happy`

async function cleanup() {
  await pipe([
    exec(`DELETE FROM ReviewRequest WHERE token LIKE '${MARK}%'`),
    exec(`DELETE FROM Incident WHERE description LIKE '%${MARK}%'`),
    exec(`DELETE FROM Referral WHERE referrerId IN (?,?) OR referredId IN (?,?)`, [t(referrer), t(referred), t(referrer), t(referred)]),
    exec(`DELETE FROM WalletEntry WHERE customerId IN (?,?)`, [t(referrer), t(referred)]),
    exec(`DELETE FROM Appointment WHERE customerId IN (?,?)`, [t(referrer), t(referred)]),
    exec(`DELETE FROM Cat WHERE customerId IN (?,?)`, [t(referrer), t(referred)]),
    exec(`DELETE FROM Customer WHERE id IN (?,?)`, [t(referrer), t(referred)]),
  ])
}

try {
  await cleanup()
  const now = Date.now()

  await pipe([
    exec(`INSERT INTO Customer (id,phone,name,source,marketingConsent,walletBalance,referralCode,createdAt,updatedAt)
          VALUES (?,?,?,'WalkIn',1,0,?,?,CURRENT_TIMESTAMP)`,
      [t(referrer), t(`+60${MARK}1`), t(`${MARK} Referrer`), t(`${MARK}CD`), t(iso(now - 200 * DAY))]),
    exec(`INSERT INTO Customer (id,phone,name,source,marketingConsent,walletBalance,referredById,createdAt,updatedAt)
          VALUES (?,?,?,'WalkIn',1,0,?,?,CURRENT_TIMESTAMP)`,
      [t(referred), t(`+60${MARK}2`), t(`${MARK} Referred`), t(referrer), t(iso(now - 30 * DAY))]),
    exec(`INSERT INTO Cat (id,name,customerId,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(`${MARK}Cat`), t(referred)]),
    // The referred customer has actually visited — this is what makes it payable.
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?,'Completed',1,0,?,CURRENT_TIMESTAMP)`,
      [t(apptId), t(referred), t(catId), t(iso(now - 3 * DAY)), t(iso(now - 3 * DAY))]),
    exec(`INSERT INTO Referral (id,referrerId,referredId,status,createdAt,updatedAt)
          VALUES (?,?,?,'Pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(referralId), t(referrer), t(referred)]),
    exec(`INSERT INTO ReviewRequest (id,token,customerId,sentAt) VALUES (?,?,?,?)`,
      [t(crypto.randomUUID()), t(sadTok), t(referrer), t(iso(now - DAY))]),
    exec(`INSERT INTO ReviewRequest (id,token,customerId,sentAt) VALUES (?,?,?,?)`,
      [t(crypto.randomUUID()), t(happyTok), t(referred), t(iso(now - DAY))]),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  // ── M4 · the gate ──
  const sadUrl = `${BASE}/review/${sadTok}`
  const anon = await fetch(sadUrl)
  const anonHtml = strip(await anon.text())
  check('review page is public (no session)', anon.status === 200, `status ${anon.status}`)
  check('asks how it went first', /how did it go/i.test(anonHtml))
  check('no public review link before answering', !anonHtml.includes('Leave a review'))

  const sadForm = findForm(anonHtml, 'value="Negative"')
  check('found the negative-answer form', !!sadForm, 'no server-action form on the review page')

  if (sadForm) {
    await submitForm(sadUrl, sadForm, { detail: `${MARK} the dryer was too loud` })

    const rr = await one(`SELECT sentiment, respondedAt, incidentId FROM ReviewRequest WHERE token = ?`, [t(sadTok)])
    check('negative answer recorded', rr[0] === 'Negative' && !!rr[1], `sentiment=${rr[0]}`)
    check('negative answer raised an Incident', !!rr[2], 'incidentId should be set')

    const inc = await one(`SELECT type, description, customerId FROM Incident WHERE id = ?`, [t(rr[2] ?? '')])
    check('incident is a Complaint against the right customer', inc?.[0] === 'Complaint' && inc?.[2] === referrer)
    check('incident carries the customer\'s words', String(inc?.[1] ?? '').includes('dryer was too loud'))

    const after = strip(await (await fetch(sadUrl)).text())
    check('unhappy customer is never shown the review link', !after.includes('Leave a review'),
      'the gate must hold after answering')
    check('unhappy customer gets a real acknowledgement', /thank you for telling us/i.test(after))
  }

  // Positive path reaches the review link.
  const happyUrl = `${BASE}/review/${happyTok}`
  const happyHtml = strip(await (await fetch(happyUrl)).text())
  const happyForm = findForm(happyHtml, 'value="Positive"')
  check('found the positive-answer form', !!happyForm)
  if (happyForm) {
    await submitForm(happyUrl, happyForm)
    const rr = await one(`SELECT sentiment, incidentId FROM ReviewRequest WHERE token = ?`, [t(happyTok)])
    check('positive answer recorded', rr[0] === 'Positive')
    check('positive answer raises no incident', !rr[1])
  }

  // ── M5 · the money ──
  const bal = async id => Number((await one(`SELECT walletBalance FROM Customer WHERE id = ?`, [t(id)]))[0])
  const entries = async id => Number((await one(`SELECT COUNT(*) FROM WalletEntry WHERE customerId = ?`, [t(id)]))[0])

  check('both wallets start empty', await bal(referrer) === 0 && await bal(referred) === 0)

  const refUrl = `${BASE}/marketing/referrals`
  const refHtml = strip(await (await fetch(refUrl, { headers: { Cookie: cookie } })).text())
  const creditForm = findForm(refHtml, referralId)
  check('found the credit form for this referral', !!creditForm)

  if (creditForm) {
    await submitForm(refUrl, creditForm, {}, cookie)

    const rBal = await bal(referrer), dBal = await bal(referred)
    const rEnt = await entries(referrer), dEnt = await entries(referred)
    const status = (await one(`SELECT status, referrerCreditRM, referredCreditRM FROM Referral WHERE id = ?`, [t(referralId)]))

    check('referrer wallet credited', rBal > 0, `balance ${rBal}`)
    check('referred wallet credited', dBal > 0, `balance ${dBal}`)
    check('a ledger entry accompanies each credit', rEnt === 1 && dEnt === 1,
      `entries referrer=${rEnt} referred=${dEnt} — rule 2 requires ledger + balance together`)
    check('balance matches the ledger', rBal === Number(status[1]) && dBal === Number(status[2]),
      `wallet ${rBal}/${dBal} vs recorded ${status[1]}/${status[2]}`)
    check('referral marked Credited', status[0] === 'Credited', `status=${status[0]}`)

    // Paying twice is the failure that matters most here.
    await submitForm(refUrl, creditForm, {}, cookie)
    check('refuses to pay the same referral twice',
      await bal(referrer) === rBal && await entries(referrer) === 1,
      `balance moved to ${await bal(referrer)}`)
  }

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
