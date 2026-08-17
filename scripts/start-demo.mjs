import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { demoEnv } from './load-env.mjs'

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

// Run a PRODUCTION build against the shared Turso demo database.
//
// The sibling of scripts/dev-turso-demo.mjs, and it exists for the same reason
// plus one more: `next start` does not load .env into the server process the
// way `next dev` does — its startup banner has no "Environments:" line. So the
// server takes whatever the shell happened to be carrying, and if that is
// stale, every login fails with `?error=1` while the verify scripts (which read
// .env directly) send a different password. The result is a suite that reports
// twenty broken features and one real cause.
//
// This builds the environment explicitly and hands it to the child, so the
// server and the scripts cannot disagree about what the password is.
//
//   node scripts/start-demo.mjs            # after `npm run build`
//   PORT=3100 node scripts/start-demo.mjs

// .env first, then the demo overlay — the overlay must win on DATABASE_URL and
// on APP_PASSWORD, which the demo does not share with production.
const env = demoEnv(process.argv.slice(2).filter(a => a.startsWith('.env')))

const target = env.DATABASE_URL ?? ''
if (!target) { console.error('No DATABASE_URL — refusing to start.'); process.exit(1) }
if (/catday-crm/.test(target)) {
  console.error('Refusing to start: DATABASE_URL points at the LIVE Cat Day database.')
  process.exit(1)
}
if (!env.APP_PASSWORD) {
  console.error('No APP_PASSWORD in .env — every login would fail with ?error=1.')
  process.exit(1)
}

// Print a fingerprint, never the value. When a verification run mysteriously
// cannot log in, comparing this line against the scripts is the whole diagnosis.
const fingerprint = createHash('sha256').update(env.APP_PASSWORD).digest('hex').slice(0, 10)
console.log(`demo server → ${target.replace(/^libsql:\/\//, '').split('.')[0]}`)
console.log(`APP_PASSWORD fingerprint → ${fingerprint} (len ${env.APP_PASSWORD.length})`)

const port = env.PORT ?? '3100'
spawn('npx', ['next', 'start', '-p', port], { stdio: 'inherit', shell: true, env })
  .on('exit', code => process.exit(code ?? 0))
