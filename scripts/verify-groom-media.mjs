import 'dotenv/config'
import crypto from 'node:crypto'

// E2E for Round 6: grooming before/after media, scoped to the grooming visit.
// Seeds a checked-in grooming appointment with a "before" + "after" MediaAsset
// (tagged groom-before / groom-after on the appointment) and asserts:
//  • the assessment screen shows Before + After capture blocks with the media
//  • the assessment screen auto-resolves today's visit even without ?appt
//  • the board's InService card links to /assess?appt=<id> ("Photos & assess")
//  • the cat page shows a read-only "Grooming before & after" gallery
//  • a grooming visit with NO media renders no gallery card (empty-state hide)
// Cleans up fully.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const MARK = 'VERIFYGROOM'
const DAY = 24 * 60 * 60 * 1000
const at = (d, h = 10) => { const x = new Date(); x.setHours(0,0,0,0); return new Date(x.getTime() + d * DAY + h * 3600000).toISOString() }

const t = v => ({ type: 'text', value: String(v) })
const f = v => ({ type: 'float', value: Number(v) })
const i = v => ({ type: 'integer', value: String(Math.round(Number(v))) })
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

const custId = crypto.randomUUID(), catId = crypto.randomUUID(), bareCatId = crypto.randomUUID()
const apptId = crypto.randomUUID(), bareApptId = crypto.randomUUID()
const beforeId = crypto.randomUUID(), afterId = crypto.randomUUID()

async function cleanup() {
  await pipe([
    exec(`DELETE FROM MediaAsset WHERE ownerId IN (?,?)`, [t(apptId), t(bareApptId)]),
    exec(`DELETE FROM Appointment WHERE id IN (?,?)`, [t(apptId), t(bareApptId)]),
    exec(`DELETE FROM Cat WHERE id IN (?,?)`, [t(catId), t(bareCatId)]),
    exec(`DELETE FROM Customer WHERE id = ?`, [t(custId)]),
  ])
}

let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  await cleanup()
  const media = (id, tag) => exec(
    `INSERT INTO MediaAsset (id,url,pathname,kind,contentType,size,ownerType,ownerId,tag,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [t(id), t(`https://blob.example/${id}.jpg`), t(`appointment/${apptId}/${id}.jpg`), t('image'), t('image/jpeg'), i(12345), t('appointment'), t(apptId), t(tag)],
  )
  await pipe([
    exec(`INSERT INTO Customer (id,name,phone,walletBalance,pointsBalance,createdAt,updatedAt)
          VALUES (?,?,?,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(custId), t(`${MARK} Cust`), t('+60122223333')]),
    exec(`INSERT INTO Cat (id,customerId,name,lifeStage,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(catId), t(custId), t(`${MARK}Mochi`), t('Adult')]),
    exec(`INSERT INTO Cat (id,customerId,name,lifeStage,createdAt,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [t(bareCatId), t(custId), t(`${MARK}Bare`), t('Adult')]),
    // grooming visit today, in service, with before/after media
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?, 'InService', ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(apptId), t(custId), t(catId), t(at(0, 10)), f(120)]),
    // a grooming visit with NO media (empty-state case)
    exec(`INSERT INTO Appointment (id,customerId,catId,type,scheduledAt,status,price,paid,usedCredit,createdAt,updatedAt)
          VALUES (?,?,?,'Grooming',?, 'Scheduled', ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [t(bareApptId), t(custId), t(bareCatId), t(at(0, 11)), f(120)]),
    media(beforeId, 'groom-before'),
    media(afterId, 'groom-after'),
  ])
  console.log('seeded a grooming visit with before/after media + a media-less visit')

  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
  if (!cookie) throw new Error('no auth cookie')
  const getHtml = async u => strip(await (await fetch(`${BASE}${u}`, { headers: { Cookie: cookie } })).text())

  const beforeSrc = `/api/media/${beforeId}/file`, afterSrc = `/api/media/${afterId}/file`

  // ── Assessment screen (explicit ?appt) ──
  const a1 = await getHtml(`/cats/${catId}/assess?appt=${apptId}`)
  check('assess screen shows Before & after block', a1.includes('Before &amp; after') && a1.includes('>Before<') && a1.includes('>After<'))
  check('assess screen renders both media (before + after)', a1.includes(beforeSrc) && a1.includes(afterSrc))

  // ── Assessment screen auto-resolves today's visit without ?appt ──
  const a2 = await getHtml(`/cats/${catId}/assess`)
  check('assess auto-resolves today visit (before media present)', a2.includes(beforeSrc) && a2.includes(afterSrc))

  // ── Board InService card links to photos & assess ──
  const board = await getHtml('/board')
  check('board InService card links to /assess?appt=<id>', board.includes(`/cats/${catId}/assess?appt=${apptId}`))
  check('board InService label is "Photos & assess"', board.includes('Photos &amp; assess'))

  // ── Cat page read-only before/after gallery ──
  const cat = await getHtml(`/cats/${catId}`)
  check('cat page shows "Grooming before & after" card', cat.includes('Grooming before &amp; after'))
  check('cat page gallery renders both media', cat.includes(beforeSrc) && cat.includes(afterSrc))

  // ── Empty-state: media-less grooming visit → no gallery card ──
  const bare = await getHtml(`/cats/${bareCatId}`)
  check('media-less cat hides the before/after card', !bare.includes('Grooming before &amp; after'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} finally {
  await cleanup()
  console.log('cleaned up test data')
}
