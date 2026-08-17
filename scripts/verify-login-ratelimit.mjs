import 'dotenv/config'
import './_guard.mjs'

// E2E for Phase 1 commit 2: login rate-limiting (count failures per IP, block
// after the threshold, clear on success). Uses a unique X-Forwarded-For so the
// hammer only blocks its own key — real logins (and other verify scripts) are
// unaffected. No DB seeding; nothing to clean up.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const MAX_FAILS = 8
const HAMMER_IP = `198.51.100.${1 + Math.floor(Math.random() * 250)}` // TEST-NET-2, isolated key
const FRESH_IP = `203.0.113.${1 + Math.floor(Math.random() * 250)}`   // TEST-NET-3

const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

const attempt = (password, ip) => fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
  body: new URLSearchParams({ password }).toString(),
  redirect: 'manual',
})
const loc = res => res.headers.get('location') ?? ''
const strip = h => h.replace(/<!--[\s\S]*?-->/g, '')

try {
  // ── First MAX_FAILS wrong attempts are allowed through (just rejected) ──
  let allWrong = true
  for (let i = 1; i <= MAX_FAILS; i++) {
    const r = await attempt('definitely-wrong', HAMMER_IP)
    if (!loc(r).includes('/login?error=1')) allWrong = false
  }
  check(`first ${MAX_FAILS} failures return error=1`, allWrong)

  // ── The next attempt is blocked ──
  const blocked = await attempt('definitely-wrong', HAMMER_IP)
  check('attempt over the threshold → error=rate', loc(blocked).includes('/login?error=rate'), loc(blocked))

  // ── Even the CORRECT password is locked out from that IP ──
  const lockedCorrect = await attempt(process.env.APP_PASSWORD ?? '', HAMMER_IP)
  check('correct password from blocked IP still locked out', loc(lockedCorrect).includes('/login?error=rate'))

  // ── A different IP is unaffected — correct password logs in ──
  const freshOk = await attempt(process.env.APP_PASSWORD ?? '', FRESH_IP)
  check('correct password from a fresh IP logs in', freshOk.status === 307 && loc(freshOk).endsWith('/'), `${freshOk.status} ${loc(freshOk)}`)

  // ── A successful login clears that IP's failure counter ──
  await attempt('definitely-wrong', FRESH_IP) // 1 failure
  await attempt(process.env.APP_PASSWORD ?? '', FRESH_IP) // success clears it
  const afterClear = await attempt('definitely-wrong', FRESH_IP)
  check('success resets the counter (still error=1, not rate)', loc(afterClear).includes('/login?error=1'))

  // ── Login page surfaces the messages ──
  const rateHtml = strip(await (await fetch(`${BASE}/login?error=rate`)).text())
  check('login page shows the rate-limit message', rateHtml.includes('Too many attempts'))
  const errHtml = strip(await (await fetch(`${BASE}/login?error=1`)).text())
  check('login page shows the wrong-password message', errHtml.includes('Incorrect password'))

  console.log(`\n${pass}/${total} checks passed`)
  if (pass !== total) process.exitCode = 1
} catch (e) {
  console.error('verify error:', e)
  process.exitCode = 1
}
