import 'dotenv/config'
import './_guard.mjs'
import crypto from 'node:crypto'

// E2E for Hardening Phase 0. Asserts (against a PRODUCTION build on :3100):
//  • security headers present on every response
//  • /api/cron/eod-analysis is fail-closed: no auth → 401; bearer secret OR a
//    manager session → allowed
//  • the WhatsApp + Google-Forms webhooks reject unauthenticated calls
// Read-only: it does not seed or mutate business data. The positive cron calls
// are skipped if there are unprocessed WhatsApp messages (so we never trigger a
// real Anthropic run as a side effect).

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const RAW = process.env.DATABASE_URL, DBTOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
const CRON = process.env.CRON_SECRET
const WA_SECRET = process.env.WHATSAPP_APP_SECRET
const FORMS_SECRET = process.env.GOOGLE_FORMS_SECRET

const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

async function pipe(sql) {
  const r = await fetch(HTTP, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DBTOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  })
  const j = await r.json()
  return j.results?.[0]?.response?.result?.rows?.[0]?.[0]?.value ?? null
}

try {
  // ── Security headers ──
  const res = await fetch(`${BASE}/login`, { redirect: 'manual' })
  const h = res.headers
  check('X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY', h.get('x-frame-options'))
  check('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff')
  check('Referrer-Policy set', (h.get('referrer-policy') ?? '').includes('strict-origin'))
  check('Permissions-Policy set', (h.get('permissions-policy') ?? '').includes('camera=()'))
  check("CSP enforces frame-ancestors 'none'", (h.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"))
  check('CSP report-only present', !!h.get('content-security-policy-report-only'))
  check('HSTS present (prod build)', (h.get('strict-transport-security') ?? '').includes('max-age='))

  // ── Cron: fail-closed (redirect:'manual' so we see the route's real status,
  // not a followed redirect) ──
  const cronNoAuth = await fetch(`${BASE}/api/cron/eod-analysis`, { method: 'POST', redirect: 'manual' })
  check('cron POST without auth → 401', cronNoAuth.status === 401, `status ${cronNoAuth.status}`)
  const cronGetNoAuth = await fetch(`${BASE}/api/cron/eod-analysis`, { redirect: 'manual' })
  check('cron GET without auth → 401', cronGetNoAuth.status === 401, `status ${cronGetNoAuth.status}`)
  const cronBadBearer = await fetch(`${BASE}/api/cron/eod-analysis`, { method: 'POST', redirect: 'manual', headers: { authorization: 'Bearer wrong-secret' } })
  check('cron POST with wrong bearer → 401', cronBadBearer.status === 401, `status ${cronBadBearer.status}`)

  // Log in as manager for the positive-path checks.
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]

  // Positive paths — only when they won't trigger a real analysis run.
  const unprocessed = Number(await pipe('SELECT count(*) FROM WhatsAppMessage WHERE processed = 0')) || 0
  if (unprocessed === 0) {
    const cronMgr = await fetch(`${BASE}/api/cron/eod-analysis`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie ?? '' } })
    check('cron POST with manager session → 200', cronMgr.status === 200, `status ${cronMgr.status}`)
    if (CRON) {
      const cronOk = await fetch(`${BASE}/api/cron/eod-analysis`, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${CRON}` } })
      check('cron POST with valid bearer → 200', cronOk.status === 200, `status ${cronOk.status}`)
    }
  } else {
    console.log(`  • skipped cron positive checks (${unprocessed} unprocessed msgs — avoids a real Anthropic run)`)
  }

  // ── WhatsApp webhook: reject unsigned ──
  const waRes = await fetch(`${BASE}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  check('WhatsApp webhook rejects unsigned POST', [403, 503].includes(waRes.status), `status ${waRes.status}`)
  if (WA_SECRET) {
    const body = '{}'
    const sig = 'sha256=' + crypto.createHmac('sha256', WA_SECRET).update(body).digest('hex')
    const ok = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig }, body,
    })
    check('WhatsApp webhook accepts a valid signature', ok.status === 200, `status ${ok.status}`)
  }

  // ── Google Forms webhook: reject no secret ──
  const formsRes = await fetch(`${BASE}/api/google-forms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+60120000000' }),
  })
  check('Google Forms webhook rejects missing secret', [401, 503].includes(formsRes.status), `status ${formsRes.status}`)
  if (FORMS_SECRET) {
    const okAuth = await fetch(`${BASE}/api/google-forms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': FORMS_SECRET }, body: JSON.stringify({}),
    })
    check('Forms webhook w/ secret but no phone → 400 (auth passed)', okAuth.status === 400, `status ${okAuth.status}`)
  }

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} catch (e) {
  console.error('verify error:', e)
  process.exitCode = 1
}
