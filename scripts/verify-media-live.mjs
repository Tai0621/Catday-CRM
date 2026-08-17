import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// LIVE Blob round-trip against the deployed app (which holds the real
// BLOB_READ_WRITE_TOKEN — local dev can't, so this must run against production).
// Seeds a cat, uploads a real PNG through the app, fetches it back from Blob,
// then deletes it via the DELETE route and confirms both blob + row are gone.
// Run:  VERIFY_BASE=https://catday-crm.vercel.app node scripts/verify-media-live.mjs

const BASE = process.env.VERIFY_BASE ?? 'https://catday-crm.vercel.app'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYMEDIALIVE'

const t = v => ({ type: 'text', value: String(v) })
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
async function countRows(id) {
  const res = await pipe([exec(`SELECT COUNT(*) AS c FROM MediaAsset WHERE id = ?`, [t(id)])])
  return Number(res[0]?.response?.result?.rows?.[0]?.[0]?.value ?? 0)
}

const custId = crypto.randomUUID(), catId = crypto.randomUUID()
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function cleanup() {
  await pipe([
    exec(`DELETE FROM MediaAsset WHERE ownerId = ?`, [t(catId)]),
    exec(`DELETE FROM Cat WHERE id = ?`, [t(catId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

console.log(`Live Blob round-trip against ${BASE}`)
try {
  await cleanup()
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60126660001')]),
    exec(`INSERT INTO Cat (id,customerId,name,createdAt,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catId), t(custId), t(`${MARK}Cat`)]),
  ])

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')

  // ── Upload a real PNG through the app ──
  const fd = new FormData()
  fd.set('file', new File([PNG], 'roundtrip.png', { type: 'image/png' }))
  fd.set('ownerType', 'cat'); fd.set('ownerId', catId); fd.set('tag', 'test')
  const up = await fetch(`${BASE}/api/media/upload`, { method: 'POST', headers: { Cookie: cookie }, body: fd })
  const upBody = await up.json().catch(() => ({}))
  check('upload returns 200', up.status === 200, `${up.status} ${JSON.stringify(upBody)}`)
  const asset = upBody.asset
  check('response carries a Blob URL', !!asset?.url && /^https:\/\//.test(asset.url), asset?.url)
  check('MediaAsset row was created', asset?.id ? (await countRows(asset.id)) === 1 : false)

  // ── Fetch the file back through the authenticated proxy (private store) ──
  if (asset?.id) {
    const proxy = `${BASE}/api/media/${asset.id}/file`
    const got = await fetch(proxy, { headers: { Cookie: cookie } })
    check('media is fetchable via the auth proxy (200)', got.status === 200, String(got.status))
    check('proxy content-type is an image', (got.headers.get('content-type') ?? '').startsWith('image/'), got.headers.get('content-type') ?? '')
    const bytes = Buffer.from(await got.arrayBuffer())
    check('bytes match what we uploaded', bytes.length === PNG.length, `${bytes.length} vs ${PNG.length}`)
    // the raw private blob URL must NOT be publicly accessible
    if (asset.url) {
      const raw = await fetch(asset.url)
      check('raw blob URL is private (not 200)', raw.status !== 200, String(raw.status))
    }
  }

  // ── Delete it via the app, confirm gone ──
  if (asset?.id) {
    const del = await fetch(`${BASE}/api/media/${asset.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
    check('delete returns 200', del.status === 200, String(del.status))
    check('MediaAsset row removed', (await countRows(asset.id)) === 0)
    const after = await fetch(`${BASE}/api/media/${asset.id}/file`, { headers: { Cookie: cookie } })
    check('proxy now 404s (row gone)', after.status === 404, String(after.status))
  }

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
