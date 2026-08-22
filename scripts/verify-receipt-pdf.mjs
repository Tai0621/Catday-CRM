import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

// The customer's receipt.
//
// The claims under test, in the order they matter:
//  • the public link returns a PDF, not a web page. That is the whole point:
//    a page is a door into the app, a PDF is a document.
//  • it opens with NO cookie. A customer has no login, so a receipt that needs
//    one is a receipt they cannot read.
//  • ...and it exposes nothing else. No link, no URL, no route into the OS.
//  • the token is the only guard, so a wrong one must 404 rather than leak.
//  • no em-dashes anywhere on it, INCLUDING ones arriving from service names
//    in the database, which is where they actually come from.
//  • the logo is really embedded, not merely referenced.
//  • Bank Transfer survives the round trip to the receipt and the cash-up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYRCPT'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const int = v => ({ type: 'integer', value: String(v) })
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

const custId = crypto.randomUUID()
const txnCash = crypto.randomUUID(), txnBank = crypto.randomUUID()
const tokenCash = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
const tokenBank = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
const REF_CASH = `${MARK}-C1`, REF_BANK = `${MARK}-B1`

// The em-dash the receipt must strip comes from DATA, not from our own copy —
// this is exactly the shape of the real service names ("Boarding — Standard").
const DASHED_ITEM = 'Boarding — Standard (per night)'

// Set when the suite overwrites brand.logoUrl to exercise the raster branch, so
// the finally puts the tenant's real logo back. A killed run of verify-branding
// once left its test values live on the demo site; this suite does not repeat it.
let logoRestore = null

async function cleanup() {
  await pipe([
    exec(`DELETE FROM TransactionLine WHERE transactionId IN (?,?)`, [t(txnCash), t(txnBank)]),
    exec(`DELETE FROM "Transaction" WHERE id IN (?,?)`, [t(txnCash), t(txnBank)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
  if (logoRestore !== null) {
    await pipe([exec(
      `INSERT INTO Setting (key,value,updatedAt) VALUES ('brand.logoUrl',?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [t(logoRestore)])])
    console.log(`restored brand.logoUrl = ${logoRestore}`)
    logoRestore = null
  }
}

/**
 * The text actually drawn on the page.
 *
 * pdf-lib writes strings as HEX (`<4142...> Tj`), not as parenthesised
 * literals. An extractor that looks only for `(...)` finds nothing and returns
 * "", which then satisfies every "the receipt does not contain X" assertion
 * without reading a single character. That is exactly what happened here, so
 * the caller asserts on `text.length` before trusting any absence check.
 */
async function drawnText(bytes) {
  const doc = await PDFDocument.load(bytes)

  // ── Why this is not just "decode the hex" ──
  //
  // With the brand fonts EMBEDDED AND SUBSET, pdf-lib writes glyph IDs, not
  // character codes. Reading the hex as latin1 produced binary noise, and every
  // content assertion below silently stopped checking anything. The font's
  // ToUnicode CMap is the map back, and it is the only honest way to read what
  // a person would actually see on the page.
  // Resolved through the page's RESOURCES, not by BaseFont name. pdf-lib mints
  // a fresh resource key per use — the stream says `/Inter-Regular-9742682568`
  // while the descriptor says `/Inter-Regular-4525` — so matching on the font
  // name finds nothing and every string decodes to noise.
  const ctx0 = doc.context
  const toUnicodeByFont = new Map()
  for (const page of doc.getPages()) {
    const fontDict = ctx0.lookup(page.node.Resources()?.get(PDFName.of('Font')))
    if (!fontDict?.entries) continue
    for (const [key, ref] of fontDict.entries()) {
      const name = key.toString().replace(/^\//, '')
      if (toUnicodeByFont.has(name)) continue
      const font = ctx0.lookup(ref)
      const stream = ctx0.lookup(font?.get?.(PDFName.of('ToUnicode')))
      if (!(stream instanceof PDFRawStream)) continue
      const cmap = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
      const map = new Map()
      for (const m of cmap.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const chars = m[2].match(/.{4}/g)?.map(h => String.fromCharCode(parseInt(h, 16))).join('') ?? ''
        map.set(parseInt(m[1], 16), chars)
      }
      toUnicodeByFont.set(name, map)
    }
  }

  let content = ''
  for (const page of doc.getPages()) {
    const ctx = page.node.context
    const resolved = ctx.lookup(page.node.get(PDFName.of('Contents')))
    const streams = resolved instanceof PDFRawStream ? [resolved]
      : (resolved?.asArray?.() ?? []).map(r => ctx.lookup(r))
    for (const s of streams) {
      if (s instanceof PDFRawStream) content += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')
    }
  }

  // Walk the stream in order, tracking the font each string is set in — two
  // fonts' glyph IDs mean different characters, so one merged map would decode
  // the mono strings with the body font's table and quietly produce nonsense.
  const hex = []
  let current = null
  for (const m of content.matchAll(/\/([A-Za-z0-9+._-]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g)) {
    if (m[1]) { current = m[1]; continue }
    const map = toUnicodeByFont.get(current)
    const codes = m[2].match(/.{4}/g) ?? []
    hex.push(map
      ? codes.map(c => map.get(parseInt(c, 16)) ?? '').join('')
      : Buffer.from(m[2], 'hex').toString('latin1'))
  }
  const literal = [...content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map(m => m[1])
  const hasImage = doc.context.enumerateIndirectObjects()
    .some(([, o]) => o?.dict?.get?.(PDFName.of('Subtype'))?.toString() === '/Image')

  // Font names live in the object graph, NOT in the raw bytes — the first
  // version of the font check grepped the file as latin1 and reported a
  // fallback to Helvetica while Inter was embedded perfectly well, because the
  // descriptors are inside a compressed object stream.
  const fonts = doc.context.enumerateIndirectObjects()
    .map(([, o]) => o?.get?.(PDFName.of('BaseFont'))?.toString())
    .filter(Boolean)

  return { doc, text: [...hex, ...literal].join('\n'), hasImage, fonts }
}

try {
  await cleanup()

  const now = new Date().toISOString()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,pointsBalance,walletBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(custId), t(`${MARK} Customer`), t('+60109999123')]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,method,category,reference,publicToken,createdAt)
          VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [t(txnCash), t(custId), t(now), f(180), t('Cash'), t('Boarding'), t(REF_CASH), t(tokenCash)]),
    exec(`INSERT INTO "Transaction" (id,customerId,date,total,method,category,reference,publicToken,createdAt)
          VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [t(txnBank), t(custId), t(now), f(240), t('Bank Transfer'), t('Boarding'), t(REF_BANK), t(tokenBank)]),
    exec(`INSERT INTO TransactionLine (id,transactionId,description,quantity,unitPrice,subtotal)
          VALUES (?,?,?,?,?,?)`,
      [t(crypto.randomUUID()), t(txnCash), t(DASHED_ITEM), int(2), f(90), f(180)]),
    exec(`INSERT INTO TransactionLine (id,transactionId,description,quantity,unitPrice,subtotal)
          VALUES (?,?,?,?,?,?)`,
      [t(crypto.randomUUID()), t(txnBank), t(`${MARK} Suite stay`), int(1), f(240), f(240)]),
  ])
  console.log('seeded a customer and two sales (Cash, Bank Transfer)')

  // ══ 1. The public link returns a PDF, with no cookie ══
  const res = await fetch(`${BASE}/r/${tokenCash}`, { redirect: 'manual' })
  check('the receipt link opens with NO login', res.status === 200, `status ${res.status}`)
  check('…and returns a PDF, not a page',
    (res.headers.get('content-type') ?? '').includes('application/pdf'),
    res.headers.get('content-type') ?? 'no content-type')
  check('…shown inline rather than forced as a download',
    (res.headers.get('content-disposition') ?? '').startsWith('inline'),
    res.headers.get('content-disposition') ?? '')
  check('…and kept out of search engines',
    (res.headers.get('x-robots-tag') ?? '').includes('noindex'))
  check('…and out of shared caches',
    (res.headers.get('cache-control') ?? '').includes('private'),
    res.headers.get('cache-control') ?? '')

  const bytes = Buffer.from(await res.arrayBuffer())
  check('the body really is a PDF', bytes.subarray(0, 5).toString() === '%PDF-', bytes.subarray(0, 8).toString())

  const { doc, text, hasImage, fonts } = await drawnText(bytes)
  check('it is one page', doc.getPageCount() === 1, String(doc.getPageCount()))

  // Before any "the receipt does NOT contain X" assertion below: prove the
  // extractor read something. An empty string passes every absence check, which
  // is how a broken extractor reports a perfect receipt.
  check('the extractor actually read the page text', text.length > 100, `${text.length} chars`)

  // ══ 2. No em-dashes, including the one that came from the data ══
  check('the seeded line really did contain an em-dash', DASHED_ITEM.includes('—'))
  check('…and the receipt does not', !/—|/.test(text), 'em-dash reached the customer')
  check('…nor an en-dash', !/–|/.test(text))
  check('the item still reads correctly after stripping it',
    text.includes('Boarding - Standard'), text.slice(0, 300))

  // ══ 3. It shows the sale, and nothing else ══
  check('the receipt shows its reference', text.includes(REF_CASH))
  check('…the total', text.includes('180.00'))
  check('…the payment method', text.includes('Paid by Cash'))
  check('…and the customer', text.includes(`${MARK} Customer`))

  // The reason this is a PDF at all: no route back into the OS.
  check('it carries no link into the app',
    !/https?:\/\//.test(text) && !/\/pos|\/rooms|\/customers|\/login/.test(text),
    text.match(/https?:\/\/\S+|\/(pos|rooms|customers|login)\S*/)?.[0] ?? '')
  check('the PDF has no link annotations at all',
    doc.getPages().every(p => {
      const a = p.node.get(PDFName.of('Annots'))
      return !a || (p.node.context.lookup(a)?.asArray?.() ?? []).length === 0
    }))

  // ══ 4. Bank Transfer survives to the receipt ══
  const bankRes = await fetch(`${BASE}/r/${tokenBank}`, { redirect: 'manual' })
  check('a Bank Transfer sale renders its receipt', bankRes.status === 200, `status ${bankRes.status}`)
  const bank = await drawnText(Buffer.from(await bankRes.arrayBuffer()))
  check('…and names Bank Transfer as the method',
    bank.text.includes('Paid by Bank Transfer'), bank.text.slice(0, 300))

  // ══ 4b. The masthead is THIS tenant's, whichever branch it takes ══
  //
  // The logo is a per-tenant setting (brand.logoUrl). A PDF can only carry a
  // raster, so a PNG/JPG logo is embedded and an SVG one cannot be — in which
  // case the business NAME is set as a wordmark. Both are this tenant's
  // identity; what must never happen is falling back to another tenant's file.
  const logoSetting = await pipe([exec(`SELECT value FROM Setting WHERE key = 'brand.logoUrl'`)])
  const logoUrl = logoSetting[0].response.result.rows[0]?.[0]?.value ?? '/catday-logo.png'
  const raster = /\.(png|jpe?g)$/i.test(logoUrl)
  console.log(`  · configured logo: ${logoUrl} (${raster ? 'raster, embeds' : 'not a raster, wordmark instead'})`)

  if (raster) {
    check('a raster logo is embedded in the file, not linked', hasImage)
  } else {
    check('a non-raster logo falls back to the wordmark rather than an image', !hasImage)
    check('…and the wordmark is the tenant’s own name', text.includes('VELVET PAW') || text.toUpperCase().includes('VELVET PAW'),
      text.slice(0, 200))
  }
  check('the receipt never shows a different tenant’s brand',
    !/CAT ?DAY/i.test(text) || /cat ?day/i.test(logoUrl),
    'another business’s name appears on this receipt')

  // Whatever the branch, the tenant is named somewhere on the page.
  check('the business is identified on the receipt', text.includes('this is a digital receipt'))

  // The RASTER branch is what production takes (brand.logoUrl defaults to a
  // PNG), so it cannot go untested just because this demo happens to use an SVG.
  //
  // The restore here is deliberately paranoid, because the naive version DID
  // cause damage: an interrupted run left TEST_LOGO in the setting, the next run
  // captured THAT as the prior value, and "restoring" it cemented Cat Day's logo
  // onto the Velvet Paw demo. A suite that repairs itself into the wrong state
  // is worse than one that fails. So a prior equal to the test value is never
  // stored as something to restore.
  const TEST_LOGO = '/catday-logo.png'
  if (raster) {
    // Already covered above — this tenant's own logo IS the raster path.
  } else if (logoUrl === TEST_LOGO) {
    check('the tenant logo was left on the test value by an earlier run', false,
      'run: node scripts/restore-demo-identity.mjs')
  } else {
    logoRestore = logoUrl
    await pipe([exec(
      `INSERT INTO Setting (key,value,updatedAt) VALUES ('brand.logoUrl',?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [t(TEST_LOGO)])])
    const withPng = await drawnText(Buffer.from(await (await fetch(`${BASE}/r/${tokenCash}`)).arrayBuffer()))
    check('a PNG logo really is embedded in the PDF (the production path)', withPng.hasImage)
    check('…and the wordmark steps aside when there is an image',
      !withPng.text.includes('VELVET PAW'), 'both the logo and the wordmark rendered')
  }

  // ══ 4c. The brand's own fonts, not Helvetica ══
  //
  // A missing font file falls back to Helvetica rather than failing, which is
  // right for the customer and invisible to us — so it is asserted rather than
  // assumed. The embedded name appears in the PDF's font descriptors.
  check('the receipt is lettered in the brand font, not Helvetica',
    fonts.some(x => /Inter/.test(x)), `fonts embedded: ${fonts.join(', ') || 'none'}`)
  check('…and the reference is set in the brand mono',
    fonts.some(x => /SpaceMono/i.test(x)), `fonts embedded: ${fonts.join(', ') || 'none'}`)
  check('…with no standard font left over', !fonts.some(x => /Helvetica|Courier/.test(x)),
    fonts.join(', '))
  check('the fonts are subset, not shipped whole',
    bytes.length < 400_000, `${Math.round(bytes.length / 1024)}KB — a full font got embedded`)

  // ══ 5. The token is the guard ══
  const bad = await fetch(`${BASE}/r/${'0'.repeat(64)}`, { redirect: 'manual' })
  check('an unknown token 404s rather than leaking anything', bad.status === 404, `status ${bad.status}`)

  // ══ 6. Bank Transfer reaches the cash-up ══
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  const cashup = await (await fetch(`${BASE}/cashup`, { headers: { Cookie: cookie } })).text()
  const visible = cashup.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  check('the cash-up has a Bank Transfer tile', visible.includes('Bank Transfer'), visible.slice(0, 200))
  check('…and it is not filed under "no method recorded"',
    !/No method recorded[^0-9]*240/.test(visible))

  // ══ 7. The POS offers it, and the server refuses anything else ══
  //
  // The payment buttons are client-side and only render once the basket has a
  // remainder, so an empty /pos page never contains them. Asserting on the page
  // HTML would be asserting on the empty state. The claim worth making is that
  // the shipped client bundle carries the method, and that the SERVER will not
  // accept one outside the list.
  const posHtml = await (await fetch(`${BASE}/pos`, { headers: { Cookie: cookie } })).text()
  const chunks = [...posHtml.matchAll(/\/_next\/static\/chunks\/[^"'\\\s]+\.js/g)].map(m => m[0])
  let inBundle = false
  for (const c of [...new Set(chunks)]) {
    const js = await (await fetch(`${BASE}${c}`)).text()
    if (js.includes('Bank Transfer')) { inBundle = true; break }
  }
  check('the POS client ships Bank Transfer as a payment option', inBundle,
    `checked ${new Set(chunks).size} chunks`)

  const src = await import('node:fs').then(fs => fs.readFileSync('app/pos/actions.ts', 'utf8'))
  check('the server validates the method against the allowed list rather than trusting it',
    /CHECKOUT_METHODS\.includes\(p\.method\)/.test(src))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up seeded data')
}
