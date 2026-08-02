import 'dotenv/config'

// C4 · Message A/B variants for the Action Inbox.
// Additive only: a new ActionVariant table plus the column recording which
// variant a logged outcome was shown. Types with no variant rows keep their
// built-in template, so this migration changes no existing behaviour on its own.

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

async function safe(sql, label) {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  })
  const json = await res.json()
  const r = json.results?.[0]
  if (r?.type === 'error') {
    const msg = r.error?.message ?? ''
    if (/duplicate column|already exists/i.test(msg)) { console.log(`  • skip (exists): ${label}`); return }
    throw new Error(msg)
  }
  console.log(`  ✓ ${label}`)
}

console.log('C4 · Action Inbox message variants')

await safe(`ALTER TABLE "ActionLog" ADD COLUMN "variant" TEXT`, 'ActionLog.variant')

await safe(`CREATE TABLE IF NOT EXISTS "ActionVariant" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "type"      TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, 'ActionVariant table')

await safe(`CREATE UNIQUE INDEX IF NOT EXISTS "ActionVariant_type_label_key" ON "ActionVariant"("type", "label")`, 'ActionVariant(type,label) unique')
await safe(`CREATE INDEX IF NOT EXISTS "ActionVariant_type_isActive_idx" ON "ActionVariant"("type", "isActive")`, 'ActionVariant(type,isActive)')

console.log('done')
