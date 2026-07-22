import 'dotenv/config'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN
if (!RAW) throw new Error('DATABASE_URL not set')

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

console.log('Media (Vercel Blob attachments) migration…')

await safe(
  `CREATE TABLE IF NOT EXISTS "MediaAsset" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "url" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tag" TEXT,
    "caption" TEXT,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'MediaAsset table',
)
await safe(`CREATE INDEX IF NOT EXISTS "MediaAsset_owner_idx" ON "MediaAsset" ("ownerType", "ownerId")`, 'MediaAsset owner index')

console.log('done — MediaAsset table ready. Uploads need BLOB_READ_WRITE_TOKEN in the env (Vercel Blob).')
