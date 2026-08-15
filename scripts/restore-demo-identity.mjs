// Re-applies the demo tenant identity block from scripts/seed-demo-data.mjs.
// A partial seed left business.name and business.tagline unwritten, so they fell
// back to DEFAULT_CONFIG — i.e. a real client's name and tagline on a
// prospect-facing demo. Idempotent: the six already-correct rows are no-ops.
//
// Credentials are injected by migrate-all.mjs --only=demo; never read here.
const RAW = process.env.DATABASE_URL, TOKEN = process.env.DATABASE_AUTH_TOKEN
const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'

// Hard refusal: this must never touch a production tenant.
if (/catday/.test(RAW)) {
  console.error('REFUSING: target is a production tenant.')
  process.exit(1)
}

// Verbatim from scripts/seed-demo-data.mjs `demoIdentity`.
const demoIdentity = {
  'business.name': 'Velvet Paw',
  'business.tagline': 'A calm day for every cat',
  'business.legalName': 'Velvet Paw Sdn Bhd',
  'business.regNo': '202401000000 (1000000-X)',
  'business.address': '12 Jalan Demo, Bangsar, 59100 Kuala Lumpur',
  'business.phone': '+60 3-0000 0000',
  'business.email': 'hello@velvetpaw.example',
  'portalLabel': 'Staff Portal',
  'brand.logoUrl': '/demo-logo.svg',
  'brand.logoDarkUrl': '/demo-logo-cream.svg',
}

const t = v => ({ type: 'text', value: String(v) })
const now = new Date().toISOString()

const requests = Object.entries(demoIdentity).map(([key, value]) => ({
  type: 'execute',
  stmt: {
    sql: `INSERT INTO "Setting" ("key","value","updatedAt") VALUES (?,?,?)
          ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`,
    args: [t(key), t(value), t(now)],
  },
}))

const res = await fetch(HTTP, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
})
const json = await res.json()
const err = json.results?.find(r => r?.type === 'error')
if (err) { console.error('  failed:', err.error?.message); process.exit(1) }

// Read back and assert.
const verify = await fetch(HTTP, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({
    requests: [{ type: 'execute', stmt: { sql: `SELECT "key","value" FROM "Setting" ORDER BY "key"` } }, { type: 'close' }],
  }),
})
const rows = ((await verify.json()).results?.[0].response?.result?.rows ?? []).map(r => r.map(c => c.value))
const got = Object.fromEntries(rows)

let bad = 0
for (const [k, v] of Object.entries(demoIdentity)) {
  const ok = got[k] === v
  if (!ok) bad++
  console.log(`    ${ok ? '✓' : '✗'} ${k.padEnd(24)} = ${JSON.stringify(got[k])}`)
}
console.log(`\n    ${Object.keys(demoIdentity).length - bad}/${Object.keys(demoIdentity).length} identity rows correct`)
if (bad) process.exit(1)
