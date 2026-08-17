import 'dotenv/config'
import './_guard.mjs'

// C2 — write tools behind a confirm gate.
//
// Like verify-copilot.mjs this makes NO model call. The model's half of C2 is
// choosing to draft; everything that MATTERS is on this side of that choice:
//
//   • inert     — a proposal that nobody confirms must change nothing
//   • identical — confirming must produce the same row the manual form does
//   • once      — a double-clicked Confirm must not book two appointments
//   • expiring  — "book her in tomorrow" must not be actionable on Thursday
//   • floors    — consent and the frequency cap must survive the new surface
//   • bounded   — the forbidden writes must have no tool at all
//
// Proposals are seeded straight into Turso in the shape propose() stores them,
// then driven through the real /api/ask/confirm endpoint. The manual expense
// form is driven through its own no-JS form (technique A in AGENTS.md) so the
// two rows can be compared field by field rather than by assertion about them.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYC2'
const t = v => ({ type: 'text', value: String(v) })
const n = v => ({ type: 'integer', value: String(v) })
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

// DateTime columns are ISO text with an explicit offset (see any existing row).
const iso = d => d.toISOString().replace('Z', '+00:00')
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ── ids ──
const consentId = `${MARK}-cust-yes`
const noConsentId = `${MARK}-cust-no`
const productId = `${MARK}-product`
const P = k => `${MARK}-prop-${k}`

const today = dayKey(new Date())
const now = new Date()

const proposalRow = (id, kind, payload, summary, createdAt = now) => exec(
  `INSERT INTO AiProposal (id,createdAt,kind,payload,summary,prompt,status)
   VALUES (?,?,?,?,?,?, 'Pending')`,
  [t(id), t(iso(createdAt)), t(kind), t(JSON.stringify(payload)), t(summary), t(`${MARK} prompt`)],
)

async function cleanup() {
  await pipe([
    exec(`DELETE FROM AuditLog WHERE summary LIKE '%${MARK}%' OR detail LIKE '%${MARK}%'`),
    exec(`DELETE FROM AiProposal WHERE prompt LIKE '%${MARK}%'`),
    exec(`DELETE FROM Expense WHERE notes LIKE '%${MARK}%' OR vendor LIKE '%${MARK}%'`),
    exec(`DELETE FROM GroupSend WHERE customerId IN (?,?)`, [t(consentId), t(noConsentId)]),
    exec(`DELETE FROM Customer WHERE id IN (?,?)`, [t(consentId), t(noConsentId)]),
    exec(`DELETE FROM Product WHERE id = ?`, [t(productId)]),
  ])
}

try {
  await cleanup()

  // ── seed ──
  await pipe([
    exec(`INSERT INTO Customer (id,phone,name,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 1, ?, ?)`,
      [t(consentId), t('+60112000001'), t(`${MARK} Consenting`), t(iso(now)), t(iso(now))]),
    exec(`INSERT INTO Customer (id,phone,name,source,marketingConsent,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 0, ?, ?)`,
      [t(noConsentId), t('+60112000002'), t(`${MARK} Silent`), t(iso(now)), t(iso(now))]),
    exec(`INSERT INTO Product (id,name,price,costPrice,stockQty,active,sortOrder,createdAt,updatedAt)
          VALUES (?,?,?,?,?,1,999,?,?)`,
      [t(productId), t(`${MARK} Widget`), f(30), f(12), n(4), t(iso(now)), t(iso(now))]),
  ])

  const expensePayload = {
    kind: 'expense', dateStr: today, category: 'Marketing', amount: 123.45,
    vendor: `${MARK} Vendor`, notes: `${MARK} drafted`, paid: true,
  }
  const waTo = id => ({ kind: 'whatsapp', customerId: id, customerName: `${MARK}`, phone: '+60112000001', body: `${MARK} hello there` })

  await pipe([
    proposalRow(P('expense'), 'expense', expensePayload, `${MARK} expense`),
    proposalRow(P('reorder'), 'reorder', { kind: 'reorder', productId, reorderLevel: 7 }, `${MARK} reorder`),
    proposalRow(P('wa-no'), 'whatsapp', waTo(noConsentId), `${MARK} wa refused`),
    proposalRow(P('wa-yes'), 'whatsapp', waTo(consentId), `${MARK} wa allowed`),
    proposalRow(P('wa-cap'), 'whatsapp', waTo(consentId), `${MARK} wa capped`),
    proposalRow(P('decline'), 'expense', expensePayload, `${MARK} to discard`),
    // Older than PROPOSAL_TTL_MIN (30) — must be refused, not executed.
    proposalRow(P('stale'), 'expense', expensePayload, `${MARK} stale`, new Date(now.getTime() - 90 * 60 * 1000)),
  ])

  // ── auth ──
  // Asserted as "a stranger gets no data" rather than a status code: proxy.ts
  // redirects before the route's own 401 is reached.
  const anon = await fetch(`${BASE}/api/ask/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: P('expense') }), redirect: 'manual',
  })
  const denied = anon.status === 401 ||
    (anon.status >= 300 && anon.status < 400 && (anon.headers.get('location') ?? '').includes('/login'))
  check('a stranger cannot confirm anything', denied, `status ${anon.status}`)
  const leaked = await one(`SELECT COUNT(*) FROM Expense WHERE notes LIKE '%${MARK}%'`)
  check('…and the refused attempt wrote nothing', Number(leaked[0][0]) === 0, `${leaked[0][0]} expenses`)

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  const confirm = async (id, decision) => {
    const r = await fetch(`${BASE}/api/ask/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(decision ? { id, decision } : { id }),
    })
    return { status: r.status, body: await r.json() }
  }

  // ── a proposal on its own is inert ──
  const beforeExpenses = Number((await one(`SELECT COUNT(*) FROM Expense`))[0][0])
  const pending = await one(`SELECT COUNT(*) FROM AiProposal WHERE prompt LIKE '%${MARK}%' AND status = 'Pending'`)
  check('seven proposals are parked, unexecuted', Number(pending[0][0]) === 7, `${pending[0][0]} pending`)
  check('parking them created no expense', Number((await one(`SELECT COUNT(*) FROM Expense`))[0][0]) === beforeExpenses)

  // ── confirm executes, through the manual path ──
  const okExpense = await confirm(P('expense'))
  check('confirming an expense succeeds', okExpense.status === 200 && okExpense.body.ok === true,
    `${okExpense.status} ${JSON.stringify(okExpense.body)}`)

  const made = await one(
    `SELECT id, amount, category, vendor, paid, date FROM Expense WHERE notes = ?`, [t(`${MARK} drafted`)])
  check('exactly one expense row exists', made.length === 1, `${made.length} rows`)
  const [confirmedId, amount, category, vendor, paid, dateVal] = made[0] ?? []
  check('the amount is exactly what was proposed', Number(amount) === 123.45, String(amount))
  check('the category is the one proposed', category === 'Marketing', String(category))

  // Same-shape comparison against the real form, rather than an assertion about
  // what the form would have produced.
  const page = await fetch(`${BASE}/finance/expenses`, { headers: { cookie } })
  const html = await page.text()
  const form = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)]
    .map(m => ({ actionId: (m[1].match(/name="(\$ACTION_ID_[0-9a-f]+)"/) ?? [])[1], body: m[1] }))
    .find(x => x.actionId && x.body.includes('name="category"'))
  check('the manual expense form is reachable', !!form, 'no $ACTION_ID form with a category field')

  if (form) {
    const fd = new FormData()
    fd.append(form.actionId, '')
    for (const [k, v] of Object.entries({
      date: today, amount: '123.45', category: 'Marketing',
      vendor: `${MARK} Vendor`, notes: `${MARK} manual`, paid: 'paid', dueDate: '',
    })) fd.append(k, v)
    await fetch(`${BASE}/finance/expenses`, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' })

    const manual = await one(
      `SELECT amount, category, vendor, paid, date FROM Expense WHERE notes = ?`, [t(`${MARK} manual`)])
    check('the manual form wrote its own row', manual.length === 1, `${manual.length} rows`)
    if (manual.length === 1) {
      const [mAmount, mCategory, mVendor, mPaid, mDate] = manual[0]
      const same = Number(mAmount) === Number(amount) && mCategory === category &&
        mVendor === vendor && String(mPaid) === String(paid) && String(mDate) === String(dateVal)
      check('confirm produced the same row shape as the manual path', same,
        `confirm=${JSON.stringify([amount, category, vendor, paid, dateVal])} manual=${JSON.stringify(manual[0])}`)
    }
  }

  // ── the audit trail ──
  const audit = await one(
    `SELECT action, entityType, entityId, detail FROM AuditLog WHERE action = 'copilot.expense' AND entityId = ?`,
    [t(confirmedId ?? '')])
  check('an AuditLog row records the confirmed write', audit.length === 1, `${audit.length} rows`)
  check('it points at the row that was created', audit[0]?.[1] === 'Expense', String(audit[0]?.[1]))
  check('it carries the prompt that produced it', String(audit[0]?.[3] ?? '').includes(`${MARK} prompt`),
    String(audit[0]?.[3] ?? '').slice(0, 120))

  // ── once, and only once ──
  const again = await confirm(P('expense'))
  check('confirming the same proposal twice is refused', again.status === 409 && again.body.ok === false,
    `${again.status} ${JSON.stringify(again.body)}`)
  const dupes = await one(`SELECT COUNT(*) FROM Expense WHERE notes = ?`, [t(`${MARK} drafted`)])
  check('…and no second row was written', Number(dupes[0][0]) === 1, `${dupes[0][0]} rows`)

  // ── expiry ──
  const stale = await confirm(P('stale'))
  check('a proposal past its TTL is refused', stale.status === 409 && /too old/i.test(stale.body.error ?? ''),
    `${stale.status} ${JSON.stringify(stale.body)}`)
  const staleStatus = await one(`SELECT status FROM AiProposal WHERE id = ?`, [t(P('stale'))])
  check('…and is closed out rather than left pending', staleStatus[0][0] === 'Declined', String(staleStatus[0][0]))

  // ── discard ──
  await confirm(P('decline'), 'decline')
  const declined = await one(`SELECT status FROM AiProposal WHERE id = ?`, [t(P('decline'))])
  check('discarding marks it declined', declined[0][0] === 'Declined', String(declined[0][0]))
  const afterDecline = await confirm(P('decline'))
  check('a discarded proposal cannot then be confirmed', afterDecline.status === 409, String(afterDecline.status))

  // ── a second kind, proving dispatch is real ──
  const okReorder = await confirm(P('reorder'))
  check('confirming a reorder level succeeds', okReorder.status === 200 && okReorder.body.ok === true,
    JSON.stringify(okReorder.body))
  const level = await one(`SELECT reorderLevel, price FROM Product WHERE id = ?`, [t(productId)])
  check('the threshold moved to the proposed value', Number(level[0][0]) === 7, String(level[0][0]))
  check('…and nothing else on the product changed', Number(level[0][1]) === 30, `price ${level[0][1]}`)

  // ── the M10 floors survive the new surface ──
  const waNo = await confirm(P('wa-no'))
  check('a message to a non-consenting customer is refused', waNo.status === 409 && /never agreed/i.test(waNo.body.error ?? ''),
    JSON.stringify(waNo.body))
  const noSend = await one(`SELECT COUNT(*) FROM GroupSend WHERE customerId = ?`, [t(noConsentId)])
  check('…and no send was logged', Number(noSend[0][0]) === 0, `${noSend[0][0]} sends`)

  const waYes = await confirm(P('wa-yes'))
  check('a message to a consenting customer succeeds', waYes.status === 200 && waYes.body.ok === true, JSON.stringify(waYes.body))
  const sent = await one(`SELECT groupKey, channel FROM GroupSend WHERE customerId = ?`, [t(consentId)])
  check('it logs the same GroupSend row the worklist writes', sent.length === 1 && sent[0][1] === 'WhatsApp',
    JSON.stringify(sent))
  check('filed under the ad-hoc key, not a real audience', sent[0]?.[0] === 'copilot', String(sent[0]?.[0]))

  const waCap = await confirm(P('wa-cap'))
  check('the global frequency cap then blocks a second message', waCap.status === 409 && /last 14 days/i.test(waCap.body.error ?? ''),
    JSON.stringify(waCap.body))
  const capCount = await one(`SELECT COUNT(*) FROM GroupSend WHERE customerId = ?`, [t(consentId)])
  check('…and no second send was logged', Number(capCount[0][0]) === 1, `${capCount[0][0]} sends`)

  // ── what must stay unreachable (source-level) ──
  // The write tools only run inside a model call, so the boundary is asserted
  // against the source: the guarantee is that no tool for these exists at all.
  const fs = await import('node:fs')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const tools = strip(fs.readFileSync('lib/ai/write-tools.ts', 'utf8'))
  const proposals = strip(fs.readFileSync('lib/ai/proposals.ts', 'utf8'))
  const route = strip(fs.readFileSync('app/api/ask/confirm/route.ts', 'utf8'))

  const forbidden = ['checkout', 'loyalty', 'wallet', 'payroll', 'commission', 'erase', 'refund', 'delete']
  const hits = forbidden.filter(w => new RegExp(w, 'i').test(tools))
  check('no write tool touches a forbidden operation', hits.length === 0, hits.join(', '))

  const kinds = (proposals.match(/export const PROPOSAL_KINDS = \[([^\]]+)\]/) ?? [])[1] ?? ''
  const declared = [...kinds.matchAll(/'([^']+)'/g)].map(m => m[1])
  const builders = [...(proposals.match(/const BUILDERS[^{]*\{([\s\S]*?)\n\}/) ?? ['', ''])[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1])
  check('the allow-list and the dispatch table are the same set',
    declared.length === 5 && declared.length === builders.length && declared.every(k => builders.includes(k)),
    `kinds=${declared.join(',')} builders=${builders.join(',')}`)

  // The proposal is the ONLY thing a draft writes. Anything else here would mean
  // a tool that acts before anyone has seen it.
  const writes = [...proposals.matchAll(/db\.(\w+)\.(create|update|upsert|delete|updateMany|deleteMany)\b/g)]
  const nonProposalWrites = writes.filter(m => m[1] !== 'aiProposal').map(m => `${m[1]}.${m[2]}`)
  check('drafting writes only to AiProposal', nonProposalWrites.length === 0, nonProposalWrites.join(', '))

  // The client sends an id. If it could send a payload, the confirm card would
  // stop being evidence of what the model actually proposed.
  check('the confirm endpoint accepts an id, never a payload',
    /body\?\.id/.test(route) && !/body\?\.(payload|kind|amount)/.test(route))

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
