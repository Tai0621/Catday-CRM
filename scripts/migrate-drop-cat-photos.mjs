import 'dotenv/config'

// Track A / A1 — data protection. Drop the orphaned Cat.photos column.
//
// Photos moved to MediaAsset (private Blob, ownerType 'cat') in Round 3; the
// base64-data-URL column has had no reader or writer since. Removing it takes
// customer photo bytes out of the DB row entirely (privacy locality) and kills
// the "never SELECT * on Cat or photos rides along" footgun for good. Verified
// empty first via scripts/inspect-cat-photos.mjs (0 rows, 0 bytes).
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
    if (/no such column|already exists|duplicate column/i.test(msg)) { console.log(`  • skip (gone): ${label}`); return }
    throw new Error(msg)
  }
  console.log(`  ✓ ${label}`)
}

await safe(`ALTER TABLE "Cat" DROP COLUMN "photos"`, 'drop Cat.photos')

console.log('done')
