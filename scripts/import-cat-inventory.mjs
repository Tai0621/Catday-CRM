import 'dotenv/config'
import './_guard.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

// Import the owner's cat inventory workbook into CatStock.
//
//   node scripts/import-cat-inventory.mjs "<path to .xlsx>"            # DRY RUN
//   node scripts/import-cat-inventory.mjs "<path>" --commit
//
// DRY RUN IS THE DEFAULT, deliberately. The real sheet is two years old and it
// shows: 22 of 64 date-of-birth cells hold bare numbers like `86` and `107`
// rather than dates, one reads `8/11/20222`, breed is free text that has drifted
// into "Golden Bristish" (13 cats) and "Golden British" (8) as if they were
// different breeds, and Neutered/Spayed are used as sex markers with the two
// words reversed. Loading that blind would put the mess in the database and call
// it data. So: import what is unambiguous, REPORT what is not, and let the owner
// decide the rest in the UI.
//
// Nothing is guessed. A cell that cannot be read becomes null and appears in the
// "needs attention" list — and a cat with no date of birth cannot pass the sale
// readiness gate, which is the right answer for an animal whose age nobody knows.

const file = process.argv.find(a => a.endsWith('.xlsx'))
const COMMIT = process.argv.includes('--commit')
if (!file || !existsSync(file)) {
  console.error('Usage: node scripts/import-cat-inventory.mjs "<workbook.xlsx>" [--commit]')
  process.exit(1)
}

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const nul = { type: 'null' }
const maybe = v => (v == null ? nul : t(v))

async function pipe(requests) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
  })
  // Turso answers a transient upstream failure with a 502 and no `results`, and
  // reading `results[0]` off that produced a TypeError pointing at the wrong
  // line. Check the envelope before trusting its shape.
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const err = json.results?.find(r => r?.type === 'error')
  if (err) throw new Error(err.error?.message)
  if (!json.results) throw new Error(`Unexpected response: ${JSON.stringify(json).slice(0, 200)}`)
  return json.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })
const query = async (sql, args = []) => (await pipe([exec(sql, args)]))[0].response.result

// ── read the workbook ────────────────────────────────────────────────────────
//
// An .xlsx is a zip of XML. Unzipped with the platform's own tool rather than a
// dependency: this script runs once or twice in the life of the project, and a
// new package in the tree to read one file is a worse trade.

function unzip(xlsx) {
  const dir = `${process.env.TEMP ?? '/tmp'}/catinv-${Date.now()}`
  if (process.platform === 'win32') {
    // ZipFile, not Expand-Archive: the latter refuses any extension but .zip,
    // and an .xlsx is a zip wearing a different name.
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${xlsx.replace(/'/g, "''")}','${dir}')`],
      { stdio: 'pipe' })
  } else {
    execFileSync('unzip', ['-o', '-q', xlsx, '-d', dir], { stdio: 'pipe' })
  }
  return dir
}

const dir = unzip(file)
const read = p => readFileSync(`${dir}/${p}`, 'utf8')

const shared = []
for (const m of read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  shared.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, ' '))
}

const wbRels = read('xl/_rels/workbook.xml.rels')
const relMap = {}
for (const m of wbRels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2]
const sheets = [...read('xl/workbook.xml').matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)]
  .map(m => ({ name: m[1].replace(/&amp;/g, '&'), path: relMap[m[2]] }))

const master = sheets.find(s => /master/i.test(s.name))
if (!master) { console.error('No "Master List" sheet found.'); process.exit(1) }

const colNum = ref => {
  let n = 0
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

const rows = []
for (const rm of read(`xl/${master.path.replace(/^\/?xl\//, '')}`).matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const cells = {}
  for (const cm of rm[2].matchAll(/<c[^>]*r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const type = (cm[2].match(/t="([^"]+)"/) ?? [])[1]
    let v = (cm[3].match(/<v>([\s\S]*?)<\/v>/) ?? [])[1]
    if (type === 's') v = shared[Number(v)]
    else if (type === 'inlineStr') v = (cm[3].match(/<t[^>]*>([\s\S]*?)<\/t>/) ?? [])[1]
    if (v != null && String(v).trim() !== '') cells[colNum(cm[1])] = String(v).trim()
  }
  if (Object.keys(cells).length) rows.push(cells)
}

// ── parsing, with every refusal recorded ─────────────────────────────────────

/**
 * An Excel serial date, or one of the several hand-typed formats in the sheet.
 *
 * Returns null rather than a guess. `86` and `107` appear 22 times and are NOT
 * dates — the serial range is fenced at 30000 (mid-1982) so they cannot be
 * mistaken for one. `8/11/20222` fails the year check. Both land in the report.
 */
function parseDate(raw) {
  if (!raw) return { value: null, note: 'blank' }
  const s = String(raw).trim()

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n >= 30000 && n <= 60000) {
      return { value: new Date((n - 25569) * 86400000).toISOString(), note: null }
    }
    return { value: null, note: `not a date: "${s}"` }
  }

  const dmy = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/)
  if (dmy) {
    const d = Number(dmy[1]), mo = Number(dmy[2])
    let y = Number(dmy[3])
    if (String(dmy[3]).length === 2) y += 2000
    if (y < 1990 || y > 2100) return { value: null, note: `impossible year: "${s}"` }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return { value: null, note: `impossible date: "${s}"` }
    return { value: new Date(Date.UTC(y, mo - 1, d)).toISOString(), note: null }
  }
  return { value: null, note: `unreadable: "${s}"` }
}

const BREEDS = {
  'golden bristish': 'British Shorthair', 'golden british': 'British Shorthair',
  'british': 'British Shorthair', 'british short hair': 'British Shorthair',
  'british long hair': 'British Longhair',
  'muchkin': 'Munchkin', 'munchkin': 'Munchkin', 'minuet': 'Minuet',
  'devon rex': 'Devon Rex', 'exotic short hair': 'Exotic Shorthair',
  'sellkirk rex': 'Selkirk Rex', 'selkirk rex': 'Selkirk Rex',
  'persian': 'Persian', 'ragdoll': 'Ragdoll',
  'american short hair': 'American Shorthair',
  'domestic long hair': 'Domestic', 'domestic short hair': 'Domestic',
}
const canonBreed = raw => (raw ? BREEDS[raw.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null : null)

/**
 * Role, read from the Notes column.
 *
 * `REHOME PLAN` (31 of 64 rows) means a retired breeder on its way to a home,
 * not a kitten for sale — a real distinction, because rehoming should not be
 * reported as sales revenue. Everything else defaults to Breeder rather than
 * ForSale: the sheet is a breeding register, and defaulting the other way would
 * quietly list the working queens for sale.
 */
function roleFrom(notes, category) {
  const n = (notes ?? '').toUpperCase()
  if (n.includes('REHOME')) return 'Retired'
  if (category === 'Kitten') return 'ForSale'
  return 'Breeder'
}

// Header row: the one carrying "SKU".
const headerIdx = rows.findIndex(r => Object.values(r).some(v => /^sku$/i.test(v)))
if (headerIdx < 0) { console.error('Could not find the header row (no "SKU" cell).') ; process.exit(1) }
const header = rows[headerIdx]
const colOf = (...names) => {
  for (const [num, label] of Object.entries(header)) {
    const l = label.toLowerCase().replace(/\s+/g, ' ')
    if (names.some(n => l.includes(n))) return Number(num)
  }
  return null
}
const C = {
  sku: colOf('sku'),
  name: colOf('cat name'),
  dob: colOf('dob'),
  gender: colOf('gender'),
  breed: colOf('breed'),
  category: colOf('category'),
  lastVax: colOf('lastet vaccine', 'last vaccine', 'latest vaccine'),
  nextVax: colOf('next vaccine'),
  rabies: colOf('rabies'),
  fixed: colOf('neutered'),
}

const parsed = []
const attention = []
for (const r of rows.slice(headerIdx + 1)) {
  const sku = C.sku ? r[C.sku] : null
  if (!sku || !/^[A-Z]{2}-[A-Z]{3}-\d+/i.test(sku)) continue
  const name = (C.name ? r[C.name] : null) ?? null
  if (!name) { attention.push({ sku, issue: 'no cat name — skipped' }); continue }

  const dob = parseDate(C.dob ? r[C.dob] : null)
  const lastVax = parseDate(C.lastVax ? r[C.lastVax] : null)
  const nextVax = parseDate(C.nextVax ? r[C.nextVax] : null)
  const rabies = parseDate(C.rabies ? r[C.rabies] : null)

  const breedRaw = C.breed ? r[C.breed] : null
  const breed = canonBreed(breedRaw)
  if (breedRaw && !breed) attention.push({ sku, issue: `unrecognised breed "${breedRaw}" — left blank` })
  if (dob.note && dob.note !== 'blank') attention.push({ sku, issue: `date of birth ${dob.note}` })
  else if (dob.note === 'blank') attention.push({ sku, issue: 'no date of birth — cannot pass the sale gate' })

  // The sheet's own gender column is authoritative where present. The
  // Neutered/Spayed column is NOT read as a sex marker even though it was used
  // as one: it becomes a desexing date only, and the word is derived from sex at
  // render time so the reversal cannot recur.
  const genderRaw = (C.gender ? r[C.gender] : null) ?? ''
  const gender = /^f/i.test(genderRaw) ? 'Female' : /^m/i.test(genderRaw) ? 'Male' : null
  if (!gender) attention.push({ sku, issue: 'sex not recorded' })

  const fixedRaw = (C.fixed ? r[C.fixed] : null) ?? ''
  const isDesexed = /neuter|spay/i.test(fixedRaw)

  const notes = Object.entries(r)
    .filter(([num]) => Number(num) > (C.fixed ?? 0))
    .map(([, v]) => v).join(' ') || null

  const category = (C.category ? r[C.category] : null) ?? null

  parsed.push({
    sku: sku.toUpperCase(),
    name, breed, gender,
    dateOfBirth: dob.value,
    lastVaccinatedAt: lastVax.value,
    vaccinationExpiry: nextVax.value,
    rabiesAt: rabies.value,
    // No date is recorded for the operation anywhere in the sheet, so the day of
    // import would be a fabrication. Left null; the flag is preserved in notes
    // so the owner can enter real dates without losing the fact.
    desexedAt: null,
    desexedFlag: isDesexed,
    role: roleFrom(notes, category),
    notes: [notes, isDesexed ? `Desexed (date not recorded in the workbook)` : null].filter(Boolean).join(' · ') || null,
  })
}

// ── report ──────────────────────────────────────────────────────────────────

const byRole = {}
for (const p of parsed) byRole[p.role] = (byRole[p.role] ?? 0) + 1

console.log(`\nWorkbook: ${file}`)
console.log(`Sheet:    ${master.name}`)
console.log(`Readable rows: ${parsed.length}\n`)
console.log('By role:', Object.entries(byRole).map(([k, v]) => `${k}=${v}`).join(', '))
console.log('With a usable date of birth:', parsed.filter(p => p.dateOfBirth).length, `of ${parsed.length}`)
console.log('With a recognised breed:    ', parsed.filter(p => p.breed).length, `of ${parsed.length}`)
console.log('With a vaccination date:    ', parsed.filter(p => p.lastVaccinatedAt).length, `of ${parsed.length}`)

if (attention.length) {
  console.log(`\nNeeds attention (${attention.length}) — imported, but incomplete:`)
  for (const a of attention) console.log(`  · ${a.sku}: ${a.issue}`)
}

const existing = await query(`SELECT sku FROM CatStock`)
const have = new Set(existing.rows.map(r => r[0].value))
const fresh = parsed.filter(p => !have.has(p.sku))
const already = parsed.length - fresh.length
console.log(`\nAlready in the database: ${already} · to insert: ${fresh.length}`)

if (!COMMIT) {
  console.log('\nDRY RUN — nothing was written. Re-run with --commit to import.')
  process.exit(0)
}

// ── write ───────────────────────────────────────────────────────────────────

// The house holding record, created once. Owned cats hang off it so they inherit
// every cat feature; it is flagged isHouse so no customer-facing view shows it.
let houseId
const house = await query(`SELECT id FROM Customer WHERE isHouse = 1 LIMIT 1`)
if (house.rows.length) {
  houseId = house.rows[0][0].value
} else {
  houseId = crypto.randomUUID()
  await pipe([exec(
    `INSERT INTO Customer (id,phone,name,isHouse,marketingConsent,needsDetails,pointsBalance,walletBalance,source,createdAt,updatedAt)
     VALUES (?,?,?,1,0,0,0,0,'Other',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [t(houseId), t('HOUSE-OWNED-CATS'), t('House — owned cats')])])
  console.log('\nCreated the house holding record.')
}

let inserted = 0
for (const p of fresh) {
  const catId = crypto.randomUUID()
  const stockId = crypto.randomUUID()
  await pipe([
    exec(`INSERT INTO Cat (id,name,breed,gender,dateOfBirth,lastVaccinatedAt,vaccinationExpiry,rabiesAt,desexedAt,customerId,contentOptOut,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(catId), t(p.name), maybe(p.breed), maybe(p.gender), maybe(p.dateOfBirth),
       maybe(p.lastVaccinatedAt), maybe(p.vaccinationExpiry), maybe(p.rabiesAt), maybe(p.desexedAt), t(houseId)]),
    exec(`INSERT INTO CatStock (id,catId,sku,role,status,acquisitionRM,notes,createdAt,updatedAt)
          VALUES (?,?,?,?,'InStock',0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [t(stockId), t(catId), t(p.sku), t(p.role), maybe(p.notes)]),
  ])
  inserted++
}

console.log(`\nImported ${inserted} cat${inserted === 1 ? '' : 's'}.`)
console.log('Acquisition cost is 0 for every row — the workbook does not record what any cat cost.')
console.log('Set it per cat at /inventory/cats, or the balance sheet will carry the cattery at nil.')
