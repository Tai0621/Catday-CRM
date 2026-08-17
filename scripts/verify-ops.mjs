// One-shot verification for the Operations Round: inserts a temp cat, checks the
// new cat detail + assessment pages render, then removes the temp row.
// Usage: node scripts/verify-ops.mjs [baseUrl]   (default http://localhost:3100)
import 'dotenv/config'
import './_guard.mjs'

// These two suites report with inline ✓/✗ rather than a check() helper, so they
// had no score line and the release runner graded them as crashes. Tally the
// marks as they are printed and emit one — cheaper and less risky than
// rewriting two working suites, and it makes them countable like the rest.
let __ticks = 0, __crosses = 0
const __log = console.log
console.log = (...a) => {
  const s = a.map(String).join(' ')
  __ticks += (s.match(/✓/g) ?? []).length
  __crosses += (s.match(/✗/g) ?? []).length
  __log(...a)
}
process.on('exit', () => {
  const total = __ticks + __crosses
  if (total > 0) __log(`\n${__ticks}/${total} checks passed`)
  if (__crosses > 0) process.exitCode = 1
})

import { createHash } from 'crypto'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function sql(stmt) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] }),
  })
  const json = await res.json()
  const r = json.results?.[0]
  if (r?.type === 'error') throw new Error(r.error?.message)
  return r?.response?.result
}

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
})
const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0] ?? ''
const get = async path => {
  const r = await fetch(BASE + path, { headers: { Cookie: cookie }, redirect: 'manual' })
  // React's SSR splits adjacent text nodes with <!-- --> markers, so
  // 'default cycle 18d' is never literally present. Strip them, as the other
  // suites do — otherwise a rendered value reads as a missing one.
  return { status: r.status, text: (await r.text()).replace(/<!--[\s\S]*?-->/g, '') }
}

// 1) find a customer to attach to
const cust = await sql({ sql: 'SELECT id FROM Customer LIMIT 1' })
const customerId = cust?.rows?.[0]?.[0]?.value
if (!customerId) { console.log('No customer in DB — skipping'); process.exit(0) }

// 2) temp cat
const catId = 'verifyops' + Date.now().toString(36)
await sql({
  sql: `INSERT INTO Cat (id, name, customerId, coatType, createdAt, updatedAt)
        VALUES (?, 'Verify Test Cat', ?, 'Long', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: [{ type: 'text', value: catId }, { type: 'text', value: customerId }],
})

try {
  const detail = await get(`/cats/${catId}`)
  console.log(`GET /cats/[id] -> ${detail.status} ` +
    `founding:${detail.text.includes('Founding Cat number') ? '✓' : '✗'} ` +
    `careProfile:${detail.text.includes('Care Profile') ? '✓' : '✗'} ` +
    `coat:${detail.text.includes('Long hair') ? '✓' : '✗'}`)

  const assess = await get(`/cats/${catId}/assess`)
  console.log(`GET /cats/[id]/assess -> ${assess.status} ` +
    `form:${assess.text.includes('Groomer Assessment') ? '✓' : '✗'} ` +
    // The <select> arrives in the streamed RSC payload, not as HTML, and there
    // the label is split across JSON tokens: ["Long"," hair (default cycle ",18,"d)"].
    // A literal 'default cycle 18d' therefore never appears however the
    // comments are stripped. Match the number with separators allowed between.
    `cycleDefault:${/default cycle\D{0,8}18\D{0,8}d\)/.test(assess.text) ? '✓' : '✗'}`)

  const appts = await get('/appointments')
  console.log(`GET /appointments -> ${appts.status}`)
  const actions = await get('/actions?seg=grooming')
  console.log(`GET /actions?seg=grooming -> ${actions.status} chips:${actions.text.includes('All · ') ? '✓' : '✗'}`)
} finally {
  await sql({ sql: 'DELETE FROM CatAssessment WHERE catId = ?', args: [{ type: 'text', value: catId }] })
  await sql({ sql: 'DELETE FROM Cat WHERE id = ?', args: [{ type: 'text', value: catId }] })
  console.log('Temp cat removed.')
}
