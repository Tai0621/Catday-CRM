// A verification script must never touch the live business.
//
// Every verify-*.mjs seeds rows, drives real mutations, and deletes what it
// made. Pointed at production that is not a test, it is an edit to a real
// customer's record — and the only thing standing between the two is which
// DATABASE_URL happened to be in the environment. `.env` holds production, so
// the DEFAULT for a script run by hand is the dangerous one.
//
// This has already been run the wrong way once: exporting APP_PASSWORD to match
// a dev server, while DATABASE_URL still resolved to production through dotenv.
// Nothing was lost — the cleanup in `finally` ran — but it was luck, not design.
//
// Imported for its side effect, immediately after `dotenv/config`, so the check
// happens before a single statement is sent.

const url = process.env.DATABASE_URL ?? ''

if (/catday-crm/.test(url) && !process.env.ALLOW_PRODUCTION_VERIFY) {
  console.error(`
Refusing to run: DATABASE_URL points at the LIVE Cat Day database.

  ${url.replace(/^libsql:\/\//, '').split('.')[0]}

Verification scripts seed and delete rows. Run them against the demo:

  node scripts/start-demo.mjs        # or scripts/dev-turso-demo.mjs
  node scripts/run-all-verify.mjs    # sets the demo environment for you

To drive ONE suite by hand, take the environment from the same loader:

  node -e "import('./scripts/load-env.mjs').then(async m => {
    Object.assign(process.env, m.demoEnv())
    await import('./scripts/verify-<name>.mjs')
  })"
`)
  process.exit(1)
}
