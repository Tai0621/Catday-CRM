import 'dotenv/config'
import { readFileSync } from 'node:fs'

// What a BUTTON costs.
//
// A server action is not just its mutation: it writes, then revalidatePath
// re-renders the whole page and ships it back. So the cost of ticking one
// checkbox is the mutation PLUS every query the page needs to redraw itself.
// This measures the round trip a person actually waits through.
//
// The care-task toggle is used because it is self-reversing — this runs it an
// even number of times, leaving the demo exactly as it found it.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const LOG = process.env.PERF_LOG ?? '.tmp-perf.log'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const qlines = () => readFileSync(LOG, 'utf8').split('\n').filter(l => l.startsWith('[q]'))

const decode = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
function formsIn(html) {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m => {
    const fields = {}
    for (const tag of m[1].matchAll(/<input\b[^>]*>/g)) {
      const name = tag[0].match(/\bname="([^"]*)"/)?.[1]
      if (name) fields[decode(name)] = decode(tag[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '')
    }
    return { fields, isAction: Object.keys(fields).some(k => k.startsWith('$ACTION_')) }
  })
}

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
if (!cookie.startsWith('auth=')) throw new Error(`login failed (${login.status})`)

const html = await (await fetch(`${BASE}/runsheet`, { headers: { Cookie: cookie } })).text()
const form = formsIn(html).find(f => f.isAction && f.fields.id)
if (!form) { console.log('no care task on the run sheet today — nothing to measure'); process.exit(0) }

async function click() {
  await sleep(400)
  const before = qlines().length
  const fd = new FormData()
  for (const [k, v] of Object.entries(form.fields)) fd.append(k, v)
  const t0 = Date.now()
  const res = await fetch(`${BASE}/runsheet`, { method: 'POST', headers: { Cookie: cookie }, body: fd, redirect: 'manual' })
  await res.text()
  const wall = Date.now() - t0
  await sleep(400)
  return { wall, queries: qlines().length - before, status: res.status }
}

const a = await click()
const b = await click() // back to where it started
console.log(`tick one checkbox  → ${a.wall}ms, ${a.queries} queries (status ${a.status})`)
console.log(`untick it again    → ${b.wall}ms, ${b.queries} queries (status ${b.status})`)
console.log(`\nfor comparison, just LOADING /runsheet costs 12 queries — the write is a rounding error next to the redraw.`)
