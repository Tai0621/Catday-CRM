import 'dotenv/config'

// When does each part of the dashboard actually arrive?
//
// Total response time is the wrong number for a streamed page: the reader is
// not waiting for the last byte, they are waiting for the part they came to
// look at. This watches the response stream and reports the moment each marker
// first appears, so "the revenue is on screen while the action queue is still
// being built" is a measurement rather than a claim.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'

const MARKERS = [
  ['shell (nav + heading)', 'Dashboard'],
  ['action queue placeholder', 'Reading the day'],
  ['revenue figures', 'This month'],
  ['room occupancy', 'Occupancy'],
  ['action queue content', 'Open inbox'],
]

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
if (!cookie.startsWith('auth=')) throw new Error(`login failed (${login.status}) — check APP_PASSWORD`)

await fetch(`${BASE}/`, { headers: { Cookie: cookie } }).then(r => r.text()) // warm

const t0 = Date.now()
const res = await fetch(`${BASE}/`, { headers: { Cookie: cookie } })
const seen = new Map()
let buf = ''
for await (const chunk of res.body) {
  buf += Buffer.from(chunk).toString('utf8')
  for (const [label, needle] of MARKERS) {
    if (!seen.has(label) && buf.includes(needle)) seen.set(label, Date.now() - t0)
  }
}
const total = Date.now() - t0

for (const [label] of MARKERS) {
  const at = seen.get(label)
  console.log(`${label.padEnd(28)} ${at == null ? '     — not found' : `${at}ms`.padStart(8)}`)
}
console.log(`${'complete'.padEnd(28)} ${`${total}ms`.padStart(8)}`)
