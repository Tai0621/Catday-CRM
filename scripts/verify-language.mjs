import 'dotenv/config'
import './_guard.mjs'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// M9 — per-customer language.
//
// The claims:
//
//   • unknown is a real answer — null never silently becomes English, in the
//     data, in the audience rules, or in a prompt
//   • detection is honest — it says nothing when there is no signal, rather
//     than producing a confident wrong answer on "ok thanks"
//   • localisation rides on the A/B machinery: a household sees copy in its own
//     language, and the arms WITHIN a language still compete
//   • a language-targeted audience never sweeps in everyone unrecorded
//
// lib/language.ts imports only constants.ts, which imports nothing, so the
// detector compiles standalone and is exercised directly.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

const MARK = 'VERIFYM9'
const t = v => ({ type: 'text', value: String(v) })
const nul = { type: 'null' }
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
const ago = n => new Date(Date.now() - n * DAY)

const zhId = `${MARK}-zh`, msId = `${MARK}-ms`, unknownId = `${MARK}-none`

async function cleanup() {
  await pipe([
    exec(`DELETE FROM "ActionVariant" WHERE label LIKE '${MARK}%'`),
    exec(`DELETE FROM "Appointment" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Cat" WHERE id LIKE '${MARK}%'`),
    exec(`DELETE FROM "Customer" WHERE id LIKE '${MARK}%'`),
  ])
}

try {
  await cleanup()

  // ══ 1. The detector, exercised directly ══
  const outDir = mkdtempSync(join(tmpdir(), 'm9-'))
  execSync(`npx tsc lib/language.ts --outDir "${outDir}" --module es2022 --target es2022 --moduleResolution bundler`,
    { stdio: 'pipe' })
  const js = join(outDir, 'language.js')
  writeFileSync(js, readFileSync(js, 'utf8').replace(/from '(\.\.?\/[^']+)'/g, "from '$1.js'"))
  const L = await import(pathToFileURL(js).href)

  check('Mandarin is detected from the script itself',
    L.detect('你好，请问明天可以帮我的猫洗澡吗') === 'Mandarin', String(L.detect('你好，请问明天可以帮我的猫洗澡吗')))
  check('Malay is detected from its function words',
    L.detect('Hi, saya nak tanya berapa harga untuk grooming kucing saya') === 'Bahasa Malaysia',
    String(L.detect('Hi, saya nak tanya berapa harga untuk grooming kucing saya')))
  check('a short message asserts nothing', L.detect('ok thanks') === null, String(L.detect('ok thanks')))
  check('plain English asserts nothing rather than claiming English',
    L.detect('Hello, I would like to book a grooming session for my cat please') === null,
    String(L.detect('Hello, I would like to book a grooming session for my cat please')))
  check('one stray Malay-looking word is not enough',
    L.detect('Please book us in for the ada session next week thanks') === null,
    String(L.detect('Please book us in for the ada session next week thanks')))
  check('empty input is safe', L.detect('') === null && L.detect(null) === null)

  check('an unrecognised stored value is treated as unknown',
    L.languageOf({ language: 'Klingon' }) === null, String(L.languageOf({ language: 'Klingon' })))
  check('a recognised stored value is used',
    L.languageOf({ language: 'Mandarin' }) === 'Mandarin')
  check('a missing customer is unknown, not a crash', L.languageOf(null) === null)
  check('no language means no prompt fragment at all', L.languagePrompt(null) === '')
  check('the prompt says compose, not translate',
    /natively/.test(L.languagePrompt('Mandarin')) && /rather than translating/.test(L.languagePrompt('Mandarin')),
    L.languagePrompt('Mandarin'))

  // ══ 2. Seed three households ══
  const now = iso(new Date())
  const seed = (id, phone, language) => [
    exec(`INSERT INTO "Customer" (id,phone,name,source,marketingConsent,language,createdAt,updatedAt)
          VALUES (?,?,?, 'WalkIn', 1, ?, ?, ?)`,
      [t(id), t(phone), t(`${MARK} ${language ?? 'Unknown'}`), language ? t(language) : nul, t(iso(ago(400))), t(now)]),
    exec(`INSERT INTO "Cat" (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)`,
      [t(`${id}-cat`), t(id), t(`${MARK}Cat`), t(now), t(now)]),
    // One old completed visit and nothing since → a WinBack candidate.
    exec(`INSERT INTO "Appointment" (id,customerId,catId,type,scheduledAt,status,paid,createdAt,updatedAt)
          VALUES (?,?,?, 'Grooming', ?, 'Completed', 1, ?, ?)`,
      [t(`${id}-appt`), t(id), t(`${id}-cat`), t(iso(ago(200))), t(now), t(now)]),
  ]
  await pipe([...seed(zhId, '60188000001', 'Mandarin'), ...seed(msId, '60188000002', 'Bahasa Malaysia'), ...seed(unknownId, '60188000003', null)])

  // Copy in three flavours for the same action type.
  const variant = (label, body, language) => exec(
    `INSERT INTO "ActionVariant" (id,type,label,body,isActive,isDefault,language,createdAt,updatedAt)
     VALUES (?, 'WinBack', ?, ?, 1, 0, ?, ?, ?)`,
    [t(`${MARK}-${label}`), t(`${MARK} ${label}`), t(body), language ? t(language) : nul, t(now), t(now)])
  await pipe([
    variant('ZH', `${MARK}-ZH-COPY 我们想念 {cat}`, 'Mandarin'),
    variant('MS', `${MARK}-MS-COPY Kami rindu {cat}`, 'Bahasa Malaysia'),
    variant('NEUTRAL', `${MARK}-NEUTRAL-COPY We miss {cat}`, null),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  // Tokens are ASCII, so they survive the wa.me URL-encoding unchanged and the
  // page needs no decoding — decoding it whole throws on unrelated stray %s.
  const inbox = await (await fetch(`${BASE}/actions`, { headers: { cookie } })).text()

  // ══ 3. Each household gets copy in its own language ══
  // Which copy each household was actually served.
  //
  // Read from the wa.me link rather than from text near the customer's name:
  // the name also appears in the embedded RSC flight payload, and adjacent
  // cards sit close enough together that any character window catches its
  // neighbours. The phone number in the href identifies one household exactly.
  const cardFor = phone => {
    const links = [...inbox.matchAll(new RegExp(`wa\\.me/${phone}\\?text=([^"'&\\s]+)`, 'g'))].map(m => m[1])
    const found = new Set()
    for (const link of links) {
      for (const tag of ['ZH', 'MS', 'NEUTRAL']) if (link.includes(`${MARK}-${tag}-COPY`)) found.add(tag)
    }
    return found.size === 1 ? [...found][0] : found.size === 0 ? null : `ambiguous:${[...found].join('+')}`
  }

  check('the seeded households reach the inbox', inbox.includes(`${MARK} Mandarin`), 'no WinBack card seeded')
  check('a Mandarin household gets the Mandarin copy', cardFor('60188000001') === 'ZH', String(cardFor('60188000001')))
  check('a Malay household gets the Malay copy', cardFor('60188000002') === 'MS', String(cardFor('60188000002')))
  check('a household with no recorded language gets the neutral copy — never a guess',
    cardFor('60188000003') === 'NEUTRAL', String(cardFor('60188000003')))

  // ══ 4. Arms within a language still compete ══
  await pipe([variant('ZH2', `${MARK}-ZH2-COPY 好久不见 {cat}`, 'Mandarin')])
  const withTwo = await (await fetch(`${BASE}/actions`, { headers: { cookie } })).text()
  const zhWindowHasSomeMandarinArm = withTwo.includes(`${MARK}-ZH-COPY`) || withTwo.includes(`${MARK}-ZH2-COPY`)
  check('adding a second arm in the same language keeps the household in that language',
    zhWindowHasSomeMandarinArm && !withTwo.includes(`${MARK}-MS-COPY Kami rindu ${MARK}Cat`),
    'a Mandarin household drifted out of Mandarin')

  // ══ 5. Audiences never sweep in the unrecorded ══
  const groupsSrc = readFileSync('lib/customer-groups.ts', 'utf8')
  check('language is part of the audience vocabulary', /language\?: string\[\]/.test(groupsSrc))
  check('…and an unknown language never matches a language rule',
    /if \(r\.language && !\(c\.language && r\.language\.includes\(c\.language\)\)\) return false/.test(groupsSrc),
    'the rule would include unrecorded households')

  // ══ 6. Nothing was backfilled ══
  const migration = readFileSync('scripts/migrate-language.mjs', 'utf8')
  check('the migration adds the column without inventing a value',
    !/UPDATE "Customer" SET language/i.test(migration) && /no backfill/i.test(migration),
    'existing customers were assigned a language nobody recorded')

  // ══ 7. The generators are wired ══
  const askSrc = readFileSync('lib/ai/ask.ts', 'utf8')
  check('the assistant is told the customer\'s language before it drafts',
    /language: c\.language/.test(askSrc) && /written natively in it/.test(askSrc))
  const voiceSrc = readFileSync('lib/brand-voice.ts', 'utf8')
  check('customer-facing copy carries the language instruction',
    /languagePrompt/.test(voiceSrc), 'customerVoicePrompt ignores language')
  const proposalsSrc = readFileSync('lib/ai/proposals.ts', 'utf8')
  check('a drafted message in the wrong language is flagged, not silently sent',
    /languageWarning/.test(proposalsSrc) && /detect\(body\)/.test(proposalsSrc))
  check('…and flagged rather than refused, because detection is a heuristic',
    !/return \{ ok: false, error: `.*reads as/.test(proposalsSrc), 'a heuristic is blocking a real message')

  // ══ 8. The field is editable ══
  const edit = await (await fetch(`${BASE}/customers/${zhId}/edit`, { headers: { cookie } })).text()
  check('language is editable on the customer', edit.includes('name="language"'), 'no language field')
  check('…with an explicit unknown option', /Not known/.test(edit), 'unknown is not offerable')

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
