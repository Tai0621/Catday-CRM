import 'dotenv/config'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadClients, selectClients, redact } from './clients.mjs'

// Apply one migration script to every tenant database.
//
// It spawns the ordinary scripts/migrate-*.mjs unchanged, with DATABASE_URL and
// DATABASE_AUTH_TOKEN overridden per client. That works because those scripts
// use `import 'dotenv/config'`, and dotenv does not overwrite variables already
// present in the environment — so the injected values win over .env. No existing
// migration needs rewriting to be fannable-out.
//
// Runs sequentially, not in parallel: a schema change across live client
// databases should be readable when it goes wrong, and a partial failure should
// stop somewhere obvious rather than in five places at once.
//
//   node scripts/migrate-all.mjs scripts/migrate-action-variants.mjs
//   node scripts/migrate-all.mjs --list
//   node scripts/migrate-all.mjs <script> --only=demo
//   node scripts/migrate-all.mjs <script> --skip=catday

const args = process.argv.slice(2)
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const has = name => args.includes(`--${name}`)
const script = args.find(a => !a.startsWith('--'))

// A bad registry is an operator error, not a bug — report it as a sentence, not
// a stack trace. This script gets run in the middle of a release.
let clients, targets
try {
  clients = loadClients()
  targets = selectClients(clients, {
    only: flag('only'),
    skip: flag('skip'),
    envOnly: has('demo-only') ? 'demo' : undefined,
  })
} catch (e) {
  console.error(`\n${e.message}\n`)
  process.exit(1)
}

if (has('list') || !script) {
  console.log(`Tenants (${clients.length}):`)
  for (const c of clients) {
    console.log(`  ${c.slug.padEnd(14)} ${c.env.padEnd(11)} ${c.name.padEnd(20)} ${redact(c.databaseUrl)}`)
  }
  if (!script && !has('list')) {
    console.log(`\nUsage: node scripts/migrate-all.mjs <migration-script> [--only=a,b] [--skip=c] [--demo-only]`)
    process.exitCode = 1
  }
  process.exit(process.exitCode ?? 0)
}

if (!existsSync(script)) {
  console.error(`Migration script not found: ${script}`)
  process.exit(1)
}

const live = targets.filter(c => c.env === 'production')
console.log(`Applying ${script}`)
console.log(`  to ${targets.length} tenant(s) — ${live.length} live, ${targets.length - live.length} demo\n`)

const run = client => new Promise(resolve => {
  const child = spawn(process.execPath, [script], {
    // dotenv will not override these, so the tenant's credentials win over .env
    env: { ...process.env, DATABASE_URL: client.databaseUrl, DATABASE_AUTH_TOKEN: client.authToken },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  child.on('close', code => resolve({ code, out }))
})

const results = []
for (const client of targets) {
  process.stdout.write(`─ ${client.slug} (${client.env}) … `)
  const { code, out } = await run(client)
  results.push({ client, code })
  if (code === 0) {
    console.log('ok')
    for (const line of out.split('\n').filter(l => l.trim())) console.log(`    ${line}`)
  } else {
    console.log('FAILED')
    for (const line of out.split('\n').filter(l => l.trim())) console.log(`    ${line}`)
    // Stop on the first failure. Continuing would leave the estate in a mix of
    // migrated and un-migrated states, which is worse to reason about than a
    // clean stop at a known client.
    console.error(`\nStopped at "${client.slug}". Tenants after it were not touched.`)
    break
  }
}

const ok = results.filter(r => r.code === 0)
console.log(`\n${ok.length}/${targets.length} tenants migrated`)
if (ok.length !== targets.length) {
  console.error('Do NOT deploy until every tenant is migrated — a shared deploy would break the rest.')
  process.exitCode = 1
}
