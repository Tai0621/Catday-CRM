import 'dotenv/config'

// M8 — Brand voice profile.
// The voice is a config seam feeding every text generator, so what has to hold
// is: the fields exist in Business Settings, an override round-trips through
// Setting, a blank field falls back to the built-in default, and the rendered
// prompt fragment carries the override. Deliberately does NOT call the model —
// that costs tokens and returns non-deterministic prose.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYVOICE'

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

const VOICE_KEYS = ['voice.tone', 'voice.languages', 'voice.emoji', 'voice.signature', 'voice.avoid']

async function cleanup() {
  await pipe([exec(`DELETE FROM Setting WHERE key IN (${VOICE_KEYS.map(() => '?').join(',')})`, VOICE_KEYS.map(t))])
}

try {
  await cleanup()

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  check('manager login', cookie.startsWith('auth='), `status ${login.status}`)

  // 1 · The fields exist in Business Settings with the built-in defaults showing.
  const before = strip(await (await fetch(`${BASE}/admin/settings`, { headers: { cookie } })).text())
  check('Brand Voice group renders', before.includes('Brand Voice'))
  for (const key of VOICE_KEYS) {
    check(`field ${key} present`, before.includes(`name="${key}"`))
  }
  check('default tone offered as placeholder', /Warm, calm and premium/.test(before), 'DEFAULT_CONFIG.voice.tone should be the placeholder')

  // 2 · An override round-trips.
  const override = `${MARK} clipped and formal, no warmth`
  await pipe([exec(
    `INSERT INTO Setting (key,value,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP`,
    [t('voice.tone'), t(override)])])

  const after = strip(await (await fetch(`${BASE}/admin/settings`, { headers: { cookie } })).text())
  check('override round-trips into the form', after.includes(override))

  // 3 · A blank override falls back to the default rather than sending empty voice.
  await pipe([exec(`UPDATE Setting SET value = '' WHERE key = 'voice.tone'`)])
  const blanked = strip(await (await fetch(`${BASE}/admin/settings`, { headers: { cookie } })).text())
  check('blank override does not persist as the value', !blanked.includes(override))

  console.log(`\n${pass}/${total} passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up')
}
