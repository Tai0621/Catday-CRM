import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// Monthly records — the document trail behind a month's close.
//
// The claim under test is not "a page renders". It is that a period is a
// WALL: an expense in March and an expense in April must never appear in the
// same month's records, and an invoice uploaded in April against a March cost
// must file under MARCH — because the month being closed is the month the money
// belongs to, not the month someone got round to scanning the paper.
//
// Also checked: a split payment is one receipt, not two, while its money is
// counted once in full. Getting that wrong would either overstate the number of
// sales or understate the takings — and this screen exists to be checked
// against the income statement.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYREC'

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

// Two settled periods in the past, so today's real demo data cannot drift into
// them and no assertion depends on what month it happens to be.
const MAR = '2031-03', APR = '2031-04'
const marchId = crypto.randomUUID(), aprilId = crypto.randomUUID()
const custId = crypto.randomUUID()
const splitRef = `${MARK}-SPLIT`
const soloRef = `${MARK}-SOLO`
const docId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM MediaAsset WHERE ownerType = 'expense' AND ownerId IN (?,?)`, [t(marchId), t(aprilId)]),
    exec(`DELETE FROM Expense WHERE id IN (?,?)`, [t(marchId), t(aprilId)]),
    exec(`DELETE FROM "Transaction" WHERE reference LIKE '${MARK}%'`),
    exec(`DELETE FROM Customer WHERE name LIKE '${MARK}%'`),
  ])
}

/**
 * Strip tags so assertions read text rather than markup.
 *
 * Deliberately the WHOLE document, not the <main> element: app/loading.tsx puts
 * every route behind a Suspense boundary, so the shell ships with the skeleton
 * inside <main> and the real content arrives in later chunks. Reading <main>
 * alone returns the placeholder — which looks exactly like a page that rendered
 * nothing, and cost a full debugging round to spot.
 */
const textOf = html => html.replace(/<[^>]+>/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ')

try {
  await cleanup()

  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(custId), t(`${MARK} Buyer`), t('+60123334444')]),

    // March: one expense WITH an invoice, plus a split-payment sale (two rows,
    // one reference, RM 90 + RM 60).
    exec(`INSERT INTO Expense (id,date,category,amount,vendor,notes,paid,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(marchId), t('2031-03-10T02:00:00.000Z'), t('Utilities'), t(400), t(`${MARK} MarchVendor`), t(`${MARK} march cost`)]),
    exec(`INSERT INTO MediaAsset (id,url,pathname,kind,contentType,size,ownerType,ownerId,createdAt)
          VALUES (?,?,?,?,?,?,'expense',?,CURRENT_TIMESTAMP)`,
      // Uploaded in APRIL against a MARCH expense — the case the design exists for.
      [t(docId), t('https://example.invalid/march.pdf'), t('expense/2031-03/' + marchId + '/april-upload.pdf'),
        t('document'), t('application/pdf'), t(1234), t(marchId)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,category,total,method,reference,createdAt)
          VALUES (?,?,?,'Grooming',?,'Cash',?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(custId), t('2031-03-12T03:00:00.000Z'), t(90), t(splitRef)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,category,total,method,reference,createdAt)
          VALUES (?,?,?,'Grooming',?,'Wallet',?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(custId), t('2031-03-12T03:00:00.000Z'), t(60), t(splitRef)]),

    // April: one expense with NO invoice, and an unrelated sale.
    exec(`INSERT INTO Expense (id,date,category,amount,vendor,notes,paid,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(aprilId), t('2031-04-05T02:00:00.000Z'), t('Marketing'), t(250), t(`${MARK} AprilVendor`), t(`${MARK} april cost`)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,category,total,method,reference,createdAt)
          VALUES (?,?,?,'Retail',?,'Card',?,CURRENT_TIMESTAMP)`,
      [t(crypto.randomUUID()), t(custId), t('2031-04-07T03:00:00.000Z'), t(25), t(soloRef)]),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  if (!cookie.startsWith('auth=')) throw new Error(`login failed (${login.status})`)

  const load = async period => {
    const res = await fetch(`${BASE}/finance/records?period=${period}`, { headers: { Cookie: cookie } })
    return { status: res.status, text: textOf(await res.text()) }
  }

  const march = await load(MAR)
  check('the records screen opens on a chosen period', march.status === 200, `status ${march.status}`)
  check('it names the month it is showing', march.text.includes('March 2031'), march.text.slice(0, 160))

  // ══ 1. The period is a wall, in both directions ══
  check('March shows the March expense', march.text.includes(`${MARK} MarchVendor`), 'March cost missing')
  check('…and does NOT show April\'s', !march.text.includes(`${MARK} AprilVendor`),
    'an expense from another month leaked into this period')

  const april = await load(APR)
  check('April shows the April expense', april.text.includes(`${MARK} AprilVendor`), 'April cost missing')
  check('…and does NOT show March\'s', !april.text.includes(`${MARK} MarchVendor`),
    'an expense from another month leaked into this period')

  // ══ 2. An invoice files under the expense's month, not the upload's ══
  // The March expense's document exists and was uploaded later; it must count
  // toward MARCH's coverage, and April's lone expense must read as unfiled.
  check('the March invoice is filed under March', /Expense invoices/.test(march.text) && march.text.includes('PDF'),
    'no document listed against the March expense')
  check('…and March therefore reads as fully covered', /100%/.test(march.text),
    march.text.match(/Invoices on file[^%]{0,40}%/)?.[0] ?? 'coverage not 100%')
  check('an expense with no invoice is called out, not hidden',
    april.text.includes('No invoice on file') && april.text.includes(`${MARK} AprilVendor`),
    'the undocumented April expense was not flagged')
  check('…and April\'s coverage is 0%, by value', /0%/.test(april.text),
    april.text.match(/Invoices on file[^%]{0,40}%/)?.[0] ?? 'coverage not 0%')

  // ══ 3. A split payment is ONE receipt, whole ══
  // Two rows, one reference, RM 90 + RM 60. Counting rows would say two sales;
  // counting one row would say RM 90 taken.
  check('a split payment counts as a single sale',
    /1 sale\b/.test(march.text), march.text.match(/\d+ sales?/)?.[0] ?? 'sale count not 1')
  check('…and its full value is counted once', march.text.includes('150'),
    'RM 150 split across two rows was not summed')
  check('…and it is labelled as a split', march.text.includes('split'), 'split payment not marked')

  // ══ 4. An unknown period does not render an empty month as if it were real ══
  const bogus = await fetch(`${BASE}/finance/records?period=not-a-month`, { headers: { Cookie: cookie } })
  const bogusText = textOf(await bogus.text())
  check('a bogus period falls back to a real one rather than showing nothing',
    bogus.status === 200 && /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(bogusText),
    `status ${bogus.status}`)

  // ══ 5. Reachability: manager-only, and staff cannot browse the books ══
  const anon = await fetch(`${BASE}/finance/records`, { redirect: 'manual' })
  check('signed-out visitors cannot open the records', anon.status !== 200, `status ${anon.status}`)

  // ══ 6. Uploads are validated at the boundary ══
  const bad = await fetch(`${BASE}/api/media/upload`, {
    method: 'POST', headers: { Cookie: cookie },
    body: (() => {
      const fd = new FormData()
      fd.set('file', new File(['x'], 'notes.txt', { type: 'text/plain' }))
      fd.set('ownerType', 'expense')
      fd.set('ownerId', marchId)
      return fd
    })(),
  })
  // Exactly 415 — NOT "415 or 503". Blob storage is usually absent on a local
  // verification run, and accepting the 503 would make this pass without the
  // type check ever running.
  check('an unsupported file type is refused', bad.status === 415,
    `status ${bad.status} — a .txt was accepted as an invoice`)

  const orphan = await fetch(`${BASE}/api/media/upload`, {
    method: 'POST', headers: { Cookie: cookie },
    body: (() => {
      const fd = new FormData()
      fd.set('file', new File(['%PDF-1.4'], 'ghost.pdf', { type: 'application/pdf' }))
      fd.set('ownerType', 'expense')
      fd.set('ownerId', 'does-not-exist')
      return fd
    })(),
  })
  check('an invoice cannot be filed against a non-existent expense',
    orphan.status === 404,
    `status ${orphan.status} — a document with no month to belong to was accepted`)

  // ══ 7. A REAL upload files itself under the expense's month ══
  // The seeded document above had its pathname written by hand, which proves
  // nothing about the route that writes it. This uploads an actual PDF today,
  // against a MARCH 2031 expense, and checks where it landed — then deletes it
  // through the app's own endpoint so no blob is left behind.
  const real = await fetch(`${BASE}/api/media/upload`, {
    method: 'POST', headers: { Cookie: cookie },
    body: (() => {
      const fd = new FormData()
      fd.set('file', new File(['%PDF-1.4 verify'], 'supplier-invoice.pdf', { type: 'application/pdf' }))
      fd.set('ownerType', 'expense')
      fd.set('ownerId', marchId)
      return fd
    })(),
  })
  if (real.status === 503) {
    console.log('  · blob storage not configured here — skipping the live upload check')
  } else {
    const body = await real.json().catch(() => ({}))
    check('a PDF invoice uploads against an expense', real.status === 200 && !!body.asset?.id,
      `status ${real.status} ${JSON.stringify(body).slice(0, 120)}`)
    if (body.asset?.id) {
      const row = (await pipe([exec(`SELECT pathname, kind FROM MediaAsset WHERE id = ?`, [t(body.asset.id)])]))[0]
        .response.result.rows[0]
      const pathname = row?.[0]?.value ?? ''
      check('…and is stored under the EXPENSE\'s month, not today\'s',
        pathname.includes(`expense/${MAR}/`), pathname || '(no pathname)')
      check('…and is recorded as a document, not an image', (row?.[1]?.value ?? '') === 'document', row?.[1]?.value)

      const del = await fetch(`${BASE}/api/media/${body.asset.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
      check('…and can be removed again, blob and all', del.status === 200, `status ${del.status}`)
    }
  }

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
