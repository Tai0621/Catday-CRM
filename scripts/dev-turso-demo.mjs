import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Launched from wherever the preview runner happens to sit, so the project root
// is derived from this file rather than assumed to be the cwd.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

// Run the dev server against the SHARED TURSO demo database.
//
// scripts/dev-demo.mjs is the sibling of this: that one uses a local sqlite
// file, which is faster and works offline. Use this one when the work needs the
// demo data everyone else sees.
//
// `.env` points at the live Cat Day database, so a plain `next dev` puts a
// developer — or an agent driving a browser — one click away from cancelling a
// real customer's booking. This wrapper loads .env.demo.sh over the top so the
// preview is always aimed somewhere safe to break.

// Local-only sign-in for this server. The demo DEPLOYMENT's password is
// irrelevant here — a dev server authenticates against whatever APP_PASSWORD is
// in its own environment, so a throwaway value keeps the real one off disk and
// out of shell history.
//
// Kept as a literal rather than an export: this module spawns a server at import
// time, so anything importing a constant from it would start one by accident.
// scripts/verify-dev-only.mjs hardcodes the same string.
const DEV_PASSWORD = 'dev-local'

const explicit = process.argv.slice(2).filter(a => a.startsWith('.env'))
const files = [...(existsSync('.env.demo.sh') ? ['.env.demo.sh'] : []), ...explicit]

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`${file} is missing — cannot start a demo server without it.`)
    process.exit(1)
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*export\s+([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// Fall back to the tenant registry when .env.demo.sh is absent. Without this the
// documented command in AGENTS.md fails on a fresh clone, which pushes people
// toward a plain `next dev` — i.e. straight at the live database. clients.json
// already carries the demo credentials that migrate-all uses; reuse them rather
// than asking for a second copy on disk.
if (!files.length) {
  if (!existsSync('clients.json')) {
    console.error('Neither .env.demo.sh nor clients.json is present — cannot locate a demo database.')
    process.exit(1)
  }
  const demo = JSON.parse(readFileSync('clients.json', 'utf8')).clients?.find(c => c.env === 'demo')
  if (!demo) {
    console.error('clients.json has no tenant with env "demo".')
    process.exit(1)
  }
  process.env.DATABASE_URL = demo.databaseUrl
  process.env.DATABASE_AUTH_TOKEN = demo.authToken
  console.log(`credentials ← clients.json (${demo.slug})`)
}

process.env.APP_PASSWORD ??= DEV_PASSWORD

const target = process.env.DATABASE_URL ?? ''
if (/catday-crm/.test(target)) {
  console.error('Refusing to start: DATABASE_URL still points at the live Cat Day database.')
  process.exit(1)
}
console.log(`dev server → ${target.replace(/^libsql:\/\//, '').split('.')[0]}`)

const port = process.env.PORT ?? '3100'
spawn('npx', ['next', 'dev', '-p', port], { stdio: 'inherit', shell: true })
  .on('exit', code => process.exit(code ?? 0))
