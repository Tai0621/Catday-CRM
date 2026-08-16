import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

// Run every verify-*.mjs and summarise. Release gate, not a dev loop: it is
// slow on purpose and reports a line per suite so a failure is attributable.
//
//   set -a && . ./.env && set +a && . ./.env.demo.sh   # BOTH, in this order
//   npx next start -p 3100 &
//   node scripts/run-all-verify.mjs
//
// Export `.env` into the SHELL before starting the server. `next start` here
// does not load it into the server process the way `next dev` does — its
// startup banner has no "Environments:" line — so the server comes up with no
// APP_PASSWORD and rejects every login with `?error=1`. Sourcing .env.demo.sh
// afterwards keeps the demo database pointed somewhere safe to break.
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

const run = name => new Promise(resolve => {
  const child = spawn('node', [`scripts/verify-${name}.mjs`], { env: process.env })
  let out = ''
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
  const r = await run(s)
  results.push(r)
  console.log(`${r.verdict.padEnd(7)} ${s.padEnd(26)} ${r.detail}`)
}

const by = v => results.filter(r => r.verdict === v)
console.log(`\n${by('PASS').length} pass · ${by('FAIL').length} fail · ${by('CRASH').length} crash · ${by('TIMEOUT').length} timeout · ${results.length} total`)
if (by('FAIL').length || by('CRASH').length || by('TIMEOUT').length) {
  console.log('\nNot passing:')
  for (const r of [...by('FAIL'), ...by('CRASH'), ...by('TIMEOUT')]) {
    console.log(`  ${r.name} (${r.detail})`)
    for (const line of (r.out ?? '').split('\n').filter(l => l.includes('✗')).slice(0, 4)) {
      console.log(`      ${line.trim()}`)
    }
  }
}
