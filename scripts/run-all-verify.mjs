import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { demoEnv } from './load-env.mjs'

// The suites inherit THIS environment, and they load `.env` with dotenv, which
// does not overwrite what is already set — so whatever is decided here wins for
// every one of them. That is the point: the server and the scripts must agree
// on the password, and the only way to guarantee it is to derive both from the
// same loader.
const ENV = demoEnv()
let isDevServer = false

// Run every verify-*.mjs and summarise. Release gate, not a dev loop: it is
// slow on purpose and reports a line per suite so a failure is attributable.
//
//   node scripts/start-demo.mjs &          # production build, demo database
//   node scripts/run-all-verify.mjs
//
// Start the server through start-demo.mjs, not by hand. `next start` does not
// load .env into the server process the way `next dev` does — its banner has no
// "Environments:" line — so a hand-started server inherits whatever the shell
// was carrying. That has already produced a server whose APP_PASSWORD matched
// NO file on disk, rejecting every login while the suites sent the right one.
// start-demo.mjs builds the environment explicitly and prints a fingerprint of
// the password; this runner prints its own on mismatch, so the two can be
// compared in one glance.
//
// Sequential by design. These suites seed and delete shared rows in one demo
// database; running them concurrently makes them fail each other and the
// results stop meaning anything.
//
// THREE THINGS MAKE A RUN LIE. Read them before believing a red line.
//
// 1. Some suites drive server actions by scraping `$$RSC_SERVER_ACTION` out of
//    the dev chunks (AGENTS.md technique B). Those symbols do not exist in a
//    production build, so against `next start` they fail with "found <x> action
//    id" and tell you nothing. They need `node scripts/dev-turso-demo.mjs`.
//    Known: txn-delete, txn-reversal, statement-overrides, statement-rows,
//    hidden-rows, schema-fixes, row-reorder, parts of appointments.
//
// 2. A full run trips the app's OWN brute-force protection. Every suite logs
//    in; eight failures inside fifteen minutes blocks the IP (lib/rate-limit),
//    after which every later suite reports "no auth cookie" regardless of
//    whether the feature works. If failures cluster in the back half of the
//    alphabet, suspect this before suspecting the code — and re-run the
//    stragglers on their own.
//
// 3. A missing LOCAL env var reads as a broken feature. verify-consent needs
//    GOOGLE_FORMS_SECRET, verify-media-live needs BLOB_READ_WRITE_TOKEN. A
//    six-key .env will fail those on a perfectly healthy build.
//
// So: green here is meaningful, red here is a question, not an answer.

const only = process.env.ONLY ? process.env.ONLY.split(',') : null
const suites = readdirSync('scripts')
  .filter(f => f.startsWith('verify-') && f.endsWith('.mjs'))
  .map(f => f.replace(/^verify-|\.mjs$/g, ''))
  .filter(s => !only || only.includes(s))

// Preflight: can we log in at all?
//
// Without this the runner cheerfully reports twenty broken features when the
// real fault is one password. A server started outside scripts/start-demo.mjs
// can inherit a stale APP_PASSWORD that matches no file on disk, and every
// suite then fails on "no auth cookie" — which reads as a broken app.
{
  const base = ENV.VERIFY_BASE ?? 'http://localhost:3100'
  const attempt = async pw => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: pw ?? '' }).toString(), redirect: 'manual',
    }).catch(() => null)
    return { r, ok: (r?.headers.get('set-cookie') ?? '').includes('auth=') }
  }

  let { r: res, ok } = await attempt(ENV.APP_PASSWORD)

  // A dev server is a different world: scripts/dev-turso-demo.mjs deliberately
  // authenticates with a throwaway `dev-local` rather than the real password, so
  // the suites — which send the one from .env — could never sign in against it.
  // That is why the dev-only suites have been unverifiable rather than failing.
  // Detect it and adopt it, instead of reporting nine broken features.
  if (!ok) {
    const devTry = await attempt('dev-local')
    if (devTry.ok) {
      ENV.APP_PASSWORD = 'dev-local'
      isDevServer = true
      ok = true
      console.log('· dev server detected — using its local password for every suite\n')
    } else {
      res = res ?? devTry.r
    }
  }

  const where = res?.headers.get('location') ?? ''
  if (!ok) {
    const { createHash } = await import('node:crypto')
    console.error(`\nCannot log in — refusing to run, because every suite would report a false failure.\n`)
    if (!res) console.error(`  The server at ${base} did not answer. Start it first.`)
    else if (where.includes('error=rate')) console.error(`  Rate-limited: eight failed logins inside fifteen minutes. Restart the server to clear it.`)
    else console.error(`  The server rejected this password (${where || res.status}).`)
    const pw = ENV.APP_PASSWORD
    console.error(`\n  This script's APP_PASSWORD fingerprint: ${pw ? createHash('sha256').update(pw).digest('hex').slice(0, 10) : '(unset)'}`)
    console.error(`  Start the server with:  node scripts/start-demo.mjs`)
    console.error(`  It prints its own fingerprint. If the two differ, the server has stale env.\n`)
    process.exit(1)
  }
}

// Does the SERVER have an AI key? Asked of the server, not of ENV, because
// start-demo.mjs can inject a placeholder that ENV knows nothing about.
//
// Two suites want opposite answers and cannot both run against one server:
// verify-copilot needs the assistant to read as configured so the budget and
// kill-switch paths in front of the model call are reachable, and
// verify-daily-brief needs it NOT configured so it can prove a missing key
// skips the brief instead of faking one. Whichever is contradicted is skipped
// with its reason, rather than failing and being explained away every run.
let serverHasAi = false
try {
  const base = ENV.VERIFY_BASE ?? 'http://localhost:3100'
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: ENV.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
  })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  const probe = await (await fetch(`${base}/api/ask?path=/`, { headers: { cookie } })).json()
  serverHasAi = probe?.reason !== 'no-key'
} catch { /* leave false — the copilot suite will report the detail either way */ }

// Suites that cannot pass HERE, and why. Reported as SKIP with the reason
// rather than FAIL: a red line that means "wrong server" or "no token" trains
// people to ignore red lines, which is worse than not running the suite.
const DEV_ONLY = new Set([
  'txn-delete', 'txn-reversal', 'statement-overrides', 'statement-rows',
  'hidden-rows', 'schema-fixes', 'row-reorder', 'appointments', 'booking-lanes',
  'scenario', 'dev-only',
  // cat-sale drives checkout() and deleteTransaction() by resolving their action
  // ids from the Turbopack chunks — a dev-build artefact.
  'cat-sale',
])
const NEEDS_CONFIG = {
  consent: 'GOOGLE_FORMS_SECRET',
  'media-live': 'BLOB_READ_WRITE_TOKEN',
}

function skipReason(name) {
  if (DEV_ONLY.has(name) && !isDevServer) {
    return 'needs `node scripts/dev-turso-demo.mjs` (dev-only action ids)'
  }
  const key = NEEDS_CONFIG[name]
  if (key && !ENV[key]) return `needs ${key} in .env`
  if (name === 'copilot' && !serverHasAi) {
    return 'needs a server with an AI key — `start-demo.mjs --ai-placeholder`'
  }
  if (name === 'daily-brief' && serverHasAi) {
    return 'needs a server with NO AI key — drop --ai-placeholder'
  }
  return null
}

// Selecting exactly one suite streams its full output — the usual reason to
// name one is to read every line of why it fails.
const solo = suites.length === 1

const run = name => new Promise(resolve => {
  const child = spawn('node', [`scripts/verify-${name}.mjs`], { env: ENV, stdio: solo ? 'inherit' : 'pipe' })
  let out = ''
  if (solo) {
    child.on('close', () => resolve({ name, verdict: 'DONE', detail: '(streamed above)' }))
    return
  }
  const started = Date.now()
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  const timer = setTimeout(() => { child.kill(); resolve({ name, verdict: 'TIMEOUT', detail: '>180s' }) }, 180_000)
  child.on('close', code => {
    clearTimeout(timer)
    const secs = Math.round((Date.now() - started) / 1000)
    const score = out.match(/(\d+)\/(\d+)\s+(?:checks\s+)?passed/)
    if (score) {
      const [, got, want] = score
      resolve({ name, verdict: got === want ? 'PASS' : 'FAIL', detail: `${got}/${want}`, secs, out })
    } else {
      resolve({ name, verdict: 'CRASH', detail: (out.match(/Error: .*/) ?? ['no score line'])[0].slice(0, 90), secs, out })
    }
  })
})

const results = []
for (const s of suites) {
  const why = skipReason(s)
  if (why && !solo) {
    results.push({ name: s, verdict: 'SKIP', detail: why })
    console.log(`SKIP    ${s.padEnd(26)} ${why}`)
    continue
  }
  const r = await run(s)
  results.push(r)
  console.log(`${r.verdict.padEnd(7)} ${s.padEnd(26)} ${r.detail}`)
}

const by = v => results.filter(r => r.verdict === v)
console.log(`\n${by('PASS').length} pass · ${by('FAIL').length} fail · ${by('CRASH').length} crash · ${by('TIMEOUT').length} timeout · ${by('SKIP').length} skipped · ${results.length} total`)
if (by('SKIP').length) {
  console.log(`\nSkipped (not run, not passed):`)
  for (const r of by('SKIP')) console.log(`  ${r.name} — ${r.detail}`)
}
if (by('FAIL').length || by('CRASH').length || by('TIMEOUT').length) {
  console.log('\nNot passing:')
  for (const r of [...by('FAIL'), ...by('CRASH'), ...by('TIMEOUT')]) {
    console.log(`  ${r.name} (${r.detail})`)
    for (const line of (r.out ?? '').split('\n').filter(l => l.includes('✗')).slice(0, 4)) {
      console.log(`      ${line.trim()}`)
    }
  }
}
