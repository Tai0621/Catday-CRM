import { spawn } from 'node:child_process'

// Runs `next dev` against the local demo database (prisma/demo.db) instead of
// the shared Turso database that normal `npm run dev` and production both use.
// Works identically on Windows/macOS/Linux and in Bash or PowerShell, since the
// override happens in this script's own process.env rather than shell syntax.
//
// APP_PASSWORD, ANTHROPIC_API_KEY, etc. still load normally from .env — only
// the database connection is swapped. DATABASE_AUTH_TOKEN is cleared because a
// local file database doesn't use one, and leaving the real prod token set is
// simply unnecessary (harmless either way, but this keeps intent explicit).

process.env.DATABASE_URL = 'file:./prisma/demo.db'
process.env.DATABASE_AUTH_TOKEN = ''

console.log('▶ Starting dev server against the LOCAL DEMO database (prisma/demo.db)')
console.log('  Production data is not touched. Owner login uses the normal APP_PASSWORD from .env.')
console.log('  Staff PIN logins: see the output of `node scripts/seed-demo-data.mjs`.\n')

const child = spawn('npx', ['next', 'dev'], { stdio: 'inherit', shell: true, env: process.env })
child.on('exit', code => process.exit(code ?? 0))
