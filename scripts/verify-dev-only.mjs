import './_guard.mjs'
// Runs the verify scripts that CANNOT work against a deployed build.
//
// Ten scripts drive server actions with AGENTS.md technique B — scraping
// `$$RSC_SERVER_ACTION` symbols out of Turbopack chunks to recover an action id.
// Those symbols are a `next dev` artefact, so every one of these scripts fails
// its first assertion against demo.lucidopartners.com (or any `next start`
// build) and then reports a cascade of downstream failures that look like
// regressions but are not. verify-txn-reversal reads 0/12 there.
//
// The consequence is that the POS checkout reversal path — loyalty reversal,
// wallet refund, restock, re-opening a paid appointment (AGENTS.md
// data-integrity rule 3) — has no coverage unless these are run locally. This
// script is how you run them.
//
// Usage, in two terminals:
//   1)  node scripts/dev-turso-demo.mjs
//   2)  node scripts/verify-dev-only.mjs
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

// Must match scripts/dev-turso-demo.mjs — see the comment on DEV_PASSWORD there.
const DEV_PASSWORD = 'dev-local'
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'

// Every script matching /RSC_SERVER_ACTION|Next-Action/ in scripts/.
const SCRIPTS = [
  'verify-txn-reversal', 'verify-txn-delete', 'verify-appointments',
  'verify-booking-lanes', 'verify-hidden-rows', 'verify-reviews-referrals',
  'verify-row-reorder', 'verify-schema-fixes', 'verify-statement-overrides',
  'verify-statement-rows',
]

if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error(`REFUSING: these scripts require a local \`next dev\` server. Got ${BASE}.`)
  process.exit(1)
}

// Resolve the demo database the same way the dev runner does, so the scripts
// seed into whatever the server is actually reading.
let dbUrl = process.env.DATABASE_URL, dbToken = process.env.DATABASE_AUTH_TOKEN
if (existsSync('clients.json')) {
  const demo = JSON.parse(readFileSync('clients.json', 'utf8')).clients?.find(c => c.env === 'demo')
  if (demo) { dbUrl = demo.databaseUrl; dbToken = demo.authToken }
}
if (!dbUrl) { console.error('No demo database found (clients.json missing a demo tenant).'); process.exit(1) }
if (/catday/.test(dbUrl)) { console.error('REFUSING: resolved database is a production tenant.'); process.exit(1) }

// The server must be up, and must be the dev build these scripts need.
try {
  const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`health ${res.status}`)
} catch (e) {
  console.error(`Cannot reach ${BASE} — start it first:\n\n  node scripts/dev-turso-demo.mjs\n\n(${e.message})`)
  process.exit(1)
}

// A localhost URL proves nothing about which database is behind it. `.env`
// points at production, so a plain `next dev` on :3100 serves the LIVE business
// — and these scripts would then seed and delete rows in it. That is not
// hypothetical: a stray `next dev` was found running against production while
// this script was being written.
//
// So compare an identity the two databases cannot share. business.name is read
// through getConfig() from the Setting table the server is actually attached to,
// and is rendered on the sign-in page; if it disagrees with the demo database's
// own row, the server is reading something else. Fail closed on any doubt.
const demoName = await (async () => {
  const http = dbUrl.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
  const res = await fetch(http, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dbToken}` },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql: `SELECT "value" FROM "Setting" WHERE "key" = 'business.name'` } },
        { type: 'close' },
      ],
    }),
  })
  return (await res.json()).results?.[0]?.response?.result?.rows?.[0]?.[0]?.value ?? null
})()

if (!demoName) {
  console.error('Cannot read business.name from the demo database — refusing to guess which server is on the line.')
  process.exit(1)
}

const servedName = (await (await fetch(`${BASE}/login`)).text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
if (!servedName.includes(demoName)) {
  console.error(
    `\nREFUSING TO RUN — ${BASE} is not serving the demo database.\n` +
    `  demo database says business.name = ${JSON.stringify(demoName)}\n` +
    `  the server on ${BASE} reports  = ${JSON.stringify(servedName)}\n\n` +
    `A plain \`next dev\` inherits .env, which points at the LIVE business database.\n` +
    `Stop that server and start this one instead:\n\n  node scripts/dev-turso-demo.mjs\n`
  )
  process.exit(1)
}
console.log(`server   serving "${servedName}" — demo confirmed`)

console.log(`base     ${BASE}`)
console.log(`database ${dbUrl.replace(/^libsql:\/\//, '').split('.')[0]}`)
console.log(`scripts  ${SCRIPTS.length}\n`)

const env = {
  ...process.env,
  VERIFY_BASE: BASE,
  DATABASE_URL: dbUrl,
  DATABASE_AUTH_TOKEN: dbToken,
  APP_PASSWORD: process.env.APP_PASSWORD ?? DEV_PASSWORD,
}

const run = name => new Promise(resolve => {
  // Generous but bounded: a hung script must not stall the whole run, which is
  // how the first attempt at this suite died.
  const child = spawn(process.execPath, [`scripts/${name}.mjs`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const timer = setTimeout(() => child.kill('SIGKILL'), 180_000)
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  child.on('close', code => { clearTimeout(timer); resolve({ code, out }) })
})

const results = []
for (const name of SCRIPTS) {
  process.stdout.write(`─ ${name.replace('verify-', '').padEnd(22)} `)
  const { code, out } = await run(name)
  const line = out.match(/(\d+)\/(\d+) (?:checks )?passed/)
  const killed = code === null || code === 137
  const label = killed ? 'TIMEOUT' : (line ? line[0] : (code === 0 ? 'ok (no count)' : 'FAILED'))
  results.push({ name, code, out, ok: !killed && code === 0, label })
  console.log(label)
}

const bad = results.filter(r => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} scripts green`)

for (const r of bad) {
  console.log(`\n──── ${r.name} ────`)
  const lines = r.out.split('\n').filter(l => /✗|Error|FAILED|error:/.test(l))
  console.log(lines.slice(0, 10).join('\n') || r.out.split('\n').slice(-10).join('\n'))
}

process.exitCode = bad.length ? 1 : 0
