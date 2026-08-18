import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for the cat inventory spine:
//  • the list and detail pages render a stock cat
//  • the sale-readiness gate blocks an under-age / unvaccinated / reserved cat
//    and passes one that is complete
//  • a cost added to a cat shows in its ledger and does NOT reach the balance
//    sheet (acquisition cost is the only figure that does)
//  • the house holding record and its cats are absent from every
//    customer-facing surface, and present on the operational ones
//
// Drives real forms (AGENTS.md technique A) so it behaves the same against
// `next dev` and `next start`. Cleans up in `finally`.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYCATINV'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const mark = ok => (ok ? '✓' : '✗')

async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`)
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const scalar = async (sql, args = []) => (await pipe([exec(sql, args)]))[0].response.result.rows[0]?.[0]?.value

const DAY = 24 * 60 * 60 * 1000
const iso = d => d.toISOString()
const now = new Date()
const daysAgo = n => new Date(now.getTime() - n * DAY)

// Three cats: one sellable, one too young, one with no vaccination.
const readyCat = crypto.randomUUID(), readyStock = crypto.randomUUID()
const youngCat = crypto.randomUUID(), youngStock = crypto.randomUUID()
const unvaxCat = crypto.randomUUID(), unvaxStock = crypto.randomUUID()
const SKU_READY = `${MARK}-R1`, SKU_YOUNG = `${MARK}-Y1`, SKU_UNVAX = `${MARK}-U1`

async function cleanup() {
  await pipe([
    exec(`DELETE FROM CatCost WHERE catStockId IN (SELECT id FROM CatStock WHERE sku LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM CareTask WHERE catId IN (SELECT id FROM Cat WHERE name LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM Appointment WHERE catId IN (SELECT id FROM Cat WHERE name LIKE ?)`, [t(`${MARK}%`)]),
    exec(`DELETE FROM CatStock WHERE sku LIKE ?`, [t(`${MARK}%`)]),
    exec(`DELETE FROM Cat WHERE name LIKE ?`, [t(`${MARK}%`)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mark(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// ── form driver (technique A) ────────────────────────────────────────────────
function formsIn(html) {
  const out = []
  for (const m of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
    const raw = m[0]
    const fields = {}
    for (const inp of raw.matchAll(/<input\b[^>]*>/gi)) {
      const tag = inp[0]
      const name = (tag.match(/\bname="([^"]*)"/) ?? [])[1]
      if (!name) continue
      // A missing value= means empty string, not "skip". $ACTION_REF_n carries
      // no value attribute at all, and dropping it costs the action reference.
      fields[name] = (tag.match(/\bvalue="([^"]*)"/) ?? [, ''])[1]
    }
    const action = (raw.match(/\baction="([^"]*)"/) ?? [])[1] ?? null
    out.push({ raw, fields, action, isAction: Object.keys(fields).some(k => k.startsWith('$ACTION_')) })
  }
  return out
}
const findForm = (html, needle) => formsIn(html).find(f => f.isAction && f.raw.includes(needle))

async function submitForm(url, form, overrides, cookie) {
  const body = new FormData()
  for (const [k, v] of Object.entries(form.fields)) body.append(k, v)
  for (const [k, v] of Object.entries(overrides)) body.set(k, String(v))
  return fetch(url, { method: 'POST', headers: { Cookie: cookie }, body, redirect: 'manual' })
}

try {
  await cleanup()

  const nextYear = new Date(now.getTime() + 300 * DAY)
  await pipe([
    // sellable: 6 months old, vaccinated, dewormed, chipped
    exec(`INSERT INTO Cat (id,name,breed,gender,dateOfBirth,lastVaccinatedAt,vaccinationExpiry,lastDewormAt,desexedAt,customerId,contentOptOut,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?, (SELECT id FROM Customer WHERE isHouse = 1 LIMIT 1), 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [t(readyCat), t(`${MARK} Ready`), t('British Shorthair'), t('Female'), t(iso(daysAgo(180))),
       t(iso(daysAgo(30))), t(iso(nextYear)), t(iso(daysAgo(10))), t(iso(daysAgo(20)))]),
    exec(`INSERT INTO CatStock (id,catId,sku,role,status,acquisitionRM,askingRM,microchipNo,createdAt,updatedAt)
          VALUES (?,?,?,'ForSale','InStock',?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(readyStock), t(readyCat), t(SKU_READY), f(1200), f(4500), t('900000000000001')]),

    // too young: 4 weeks
    exec(`INSERT INTO Cat (id,name,breed,gender,dateOfBirth,lastVaccinatedAt,vaccinationExpiry,customerId,contentOptOut,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?, (SELECT id FROM Customer WHERE isHouse = 1 LIMIT 1), 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [t(youngCat), t(`${MARK} Young`), t('Devon Rex'), t('Male'), t(iso(daysAgo(28))), t(iso(daysAgo(7))), t(iso(nextYear))]),
    exec(`INSERT INTO CatStock (id,catId,sku,role,status,acquisitionRM,createdAt,updatedAt)
          VALUES (?,?,?,'ForSale','InStock',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(youngStock), t(youngCat), t(SKU_YOUNG)]),

    // old enough but never vaccinated
    exec(`INSERT INTO Cat (id,name,breed,gender,dateOfBirth,customerId,contentOptOut,createdAt,updatedAt)
          VALUES (?,?,?,?,?, (SELECT id FROM Customer WHERE isHouse = 1 LIMIT 1), 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [t(unvaxCat), t(`${MARK} Unvax`), t('Persian'), t('Female'), t(iso(daysAgo(200)))]),
    exec(`INSERT INTO CatStock (id,catId,sku,role,status,acquisitionRM,createdAt,updatedAt)
          VALUES (?,?,?,'ForSale','InStock',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(unvaxStock), t(unvaxCat), t(SKU_UNVAX)]),
  ])
  console.log('seeded 3 stock cats (ready / under-age / unvaccinated)')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(),
    redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim())
    .find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const get = async url => (await fetch(`${BASE}${url}`, { headers: { Cookie: cookie } })).text()

  // ── the list ──
  const list = strip(await get('/inventory/cats'))
  check('inventory list shows the ready cat', list.includes(SKU_READY))
  check('inventory list shows the under-age cat', list.includes(SKU_YOUNG))

  // Scoped to the TABLE, not the page. The batch-vaccination picker further down
  // lists every cat on purpose — you vaccinate the ones that are not sellable
  // yet, that is the point of it — so a whole-page match reports the filter as
  // broken when it is working.
  const tableOf = html => (html.match(/<tbody[\s\S]*?<\/tbody>/) ?? [''])[0]
  const readyTable = strip(tableOf(await get('/inventory/cats?ready=1')))
  check('ready filter keeps the sellable cat', readyTable.includes(SKU_READY))
  check('ready filter drops the under-age cat', !readyTable.includes(SKU_YOUNG))
  check('ready filter drops the unvaccinated cat', !readyTable.includes(SKU_UNVAX))

  // ── the gate, on the detail pages ──
  const readyPage = strip(await get(`/inventory/cats/${readyStock}`))
  check('ready cat reads Ready', /Can this cat be sold\? Ready/.test(readyPage), readyPage.slice(0, 0) || 'no Ready pill')
  check('ready cat offers the POS link', (await get(`/inventory/cats/${readyStock}`)).includes(`/pos?catStock=${readyStock}`))

  const youngPage = strip(await get(`/inventory/cats/${youngStock}`))
  check('under-age cat is blocked', youngPage.includes('Under 12 weeks'))
  const unvaxPage = strip(await get(`/inventory/cats/${unvaxStock}`))
  check('unvaccinated cat is blocked', unvaxPage.includes('No vaccination recorded'))

  // ── costs are management data, not an asset ──
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const livestockNow = async () => {
    const csv = await get(`/finance/balance-sheet/export?asOf=${monthKey}`)
    const row = csv.split(/\r?\n/).find(l => l.startsWith('Livestock (cats at cost)')) ?? ''
    return Number(row.split(',')[1])
  }
  const beforeCost = await livestockNow()

  const detailHtml = await get(`/inventory/cats/${readyStock}`)
  const costForm = findForm(detailHtml, 'name="catStockId"')
  check('found the add-cost form', !!costForm)
  if (costForm) {
    const res = await submitForm(`${BASE}/inventory/cats/${readyStock}`, costForm,
      { amountRM: '380', category: 'Vet Treatment', vendor: `${MARK} Vet` }, cookie)
    check('add-cost accepted', res.status < 400 || res.status === 303, `HTTP ${res.status}`)
    const ledgerTotal = Number(await scalar(`SELECT COALESCE(SUM(amountRM),0) FROM CatCost WHERE catStockId = ?`, [t(readyStock)]))
    check('cost lands in the cat ledger', ledgerTotal === 380, `sum = ${ledgerTotal}`)

    const afterCost = await livestockNow()
    check('a vet cost does NOT change livestock on the balance sheet',
      afterCost === beforeCost, `${beforeCost} → ${afterCost}`)

    const spentPage = strip(await get(`/inventory/cats/${readyStock}`))
    check('detail page shows spent-to-date including the cost', spentPage.includes('1,580'), 'expected 1200 + 380')
  }

  // ── acquisition cost IS the carried value, measured as movement ──
  const withCat = await livestockNow()
  await pipe([exec(`UPDATE CatStock SET acquisitionRM = 0 WHERE id = ?`, [t(readyStock)])])
  const withoutCat = await livestockNow()
  await pipe([exec(`UPDATE CatStock SET acquisitionRM = 1200 WHERE id = ?`, [t(readyStock)])])
  check('acquisition cost adds exactly itself to livestock',
    withCat - withoutCat === 1200, `${withCat} with, ${withoutCat} without`)

  // ── house isolation ──
  const cats = strip(await get('/cats'))
  check('customer cat list excludes owned cats', !cats.includes(`${MARK} Ready`))
  const customersPage = strip(await get('/customers'))
  check('customer list excludes the house record', !/House — owned cats/.test(customersPage))
  const actions = strip(await get('/actions'))
  check('action inbox raises no message card for an owned cat',
    !new RegExp(`${MARK} Ready.*(WhatsApp|Wish|Message)`).test(actions))

  // ── the room / run sheet direction: owned cats DO appear ──
  const roomId = await scalar(`SELECT id FROM Room WHERE isActive = 1 ORDER BY sortOrder LIMIT 1`)
  if (roomId) {
    const roomForm = findForm(await get(`/inventory/cats/${readyStock}`), 'name="roomId"')
    check('found the assign-room form', !!roomForm)
    if (roomForm) {
      await submitForm(`${BASE}/inventory/cats/${readyStock}`, roomForm, { roomId }, cookie)
      const residency = Number(await scalar(
        `SELECT COUNT(*) FROM Appointment WHERE catId = ? AND type = 'Residency' AND status = 'CheckedIn'`, [t(readyCat)]))
      check('assigning a room creates one residency', residency === 1, `${residency} rows`)

      await get('/runsheet') // first load generates today's care tasks
      const sheet = strip(await get('/runsheet'))
      check('run sheet lists the owned cat in house', sheet.includes(`${MARK} Ready`))
      const tasks = Number(await scalar(`SELECT COUNT(*) FROM CareTask WHERE catId = ?`, [t(readyCat)]))
      check('care tasks were generated for it', tasks > 0, `${tasks} tasks`)

      const diary = strip(await get('/appointments'))
      check('the diary does NOT show the residency', !diary.includes(`${MARK} Ready`))

      const revenue = await get(`/finance/income-statement/export?year=${now.getFullYear()}`).catch(() => '')
      check('a residency contributes no revenue line', !revenue.includes('Residency'))
    }
  } else {
    console.log('  (no active room on this database — skipping the residency checks)')
  }

  console.log(`\n${pass}/${total} checks passed`)
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
