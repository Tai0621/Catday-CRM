import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Round 3 media infrastructure. Seeds a cat with one MediaAsset row and
// asserts:
//  • the cat page renders the Photos section + the existing image thumbnail
//  • uploads degrade gracefully while BLOB_READ_WRITE_TOKEN is absent (a notice,
//    and the API refuses with 503 rather than crashing)
//  • the upload endpoint requires sign-in
// (Live upload round-trip is a separate check once the Blob token is added.)
// Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYMEDIA'

const t = v => ({ type: 'text', value: String(v) })
const n = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
const mk = ok => (ok ? '✓' : '✗')
async function pipe(reqs) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [...reqs, { type: 'close' }] }),
  })
  const j = await r.json()
  const e = j.results?.find(x => x?.type === 'error')
  if (e) throw new Error(e.error?.message)
  return j.results
}
const exec = (sql, args = []) => ({ type: 'execute', stmt: { sql, args } })

const custId = crypto.randomUUID(), catId = crypto.randomUUID(), assetId = crypto.randomUUID()
const SEED_URL = `https://example.com/${MARK}-photo.jpg`

async function cleanup() {
  await pipe([
    exec(`DELETE FROM MediaAsset WHERE ownerId = ? OR pathname LIKE '${MARK}%'`, [t(catId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60127770001')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catId), t(custId), t(`${MARK}Cat`)]),
    exec(`INSERT INTO MediaAsset (id,url,pathname,kind,contentType,size,ownerType,ownerId,createdAt)
          VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [t(assetId), t(SEED_URL), t(`${MARK}/cat/x.jpg`), t('image'), t('image/jpeg'), n(12345), t('cat'), t(catId)]),
  ])
  console.log('seeded a cat + one MediaAsset (image)')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  // ── Cat page renders the gallery ──
  const cat = await getHtml(`/cats/${catId}`)
  check('cat page has a Photos section', cat.includes('Photos &amp; videos') || cat.includes('Photos & videos'))
  // Private store: the thumbnail is served through the auth proxy, not the raw URL.
  check('cat page renders the media via the auth proxy', cat.includes(`/api/media/${assetId}/file`))
  check('raw private blob URL is NOT exposed in HTML', !cat.includes(SEED_URL))

  // ── Upload endpoint guards ──
  // Unauthenticated requests are stopped at the proxy (redirect to /login).
  const anon = await fetch(`${BASE}/api/media/upload`, { method: 'POST', body: new FormData(), redirect: 'manual' })
  const anonLoc = anon.headers.get('location') ?? ''
  check('upload requires sign-in (redirects to /login)', [301, 302, 307, 308].includes(anon.status) && anonLoc.includes('/login'), `${anon.status} ${anonLoc}`)

  // A field is appended so the multipart body always carries a boundary.
  const fd = new FormData(); fd.set('ownerType', 'cat')
  const authed = await fetch(`${BASE}/api/media/upload`, { method: 'POST', headers: { Cookie: cookie }, body: fd })
  const body = await authed.json().catch(() => ({}))
  // A malformed request is now rejected BEFORE the storage check, so this is a
  // 400 either way. The route used to answer 503 first, which meant every
  // validation rejection was untestable on a deployment without a Blob token —
  // a script asserting "415 for a bad file type" passed on the 503 without the
  // type check ever running.
  check('upload with no file → 400, whether or not storage is configured',
    authed.status === 400, `${authed.status} ${JSON.stringify(body)}`)
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('  · BLOB token present — the "storage off" notice does not apply')
  } else {
    check('cat page shows the "not set up" notice', cat.includes('isn’t set up yet') || cat.includes('set up yet'))
  }

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
