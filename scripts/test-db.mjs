import 'dotenv/config'

const RAW = process.env.DATABASE_URL
const TOKEN = process.env.DATABASE_AUTH_TOKEN

console.log('DATABASE_URL set:', !!RAW, RAW ? `(${RAW.slice(0, 30)}…)` : '')
console.log('DATABASE_AUTH_TOKEN set:', !!TOKEN, TOKEN ? `(length ${TOKEN.length})` : '')
if (TOKEN && (/\s/.test(TOKEN) || /["']/.test(TOKEN))) {
  console.log('⚠️  Token contains whitespace or quote characters — likely a paste problem.')
}

if (!RAW || !TOKEN) { console.log('Missing env vars.'); process.exit(1) }

const HTTP = RAW.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '') + '/v2/pipeline'
try {
  const res = await fetch(HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'SELECT 1 AS ok' } }, { type: 'close' }] }),
  })
  const json = await res.json()
  console.log('HTTP status:', res.status)
  const r = json.results?.[0]
  if (res.ok && r?.type === 'ok') console.log('✓ DB connection OK — token is valid.')
  else console.log('✗ DB rejected the request:', JSON.stringify(json).slice(0, 300))
} catch (e) {
  console.log('✗ fetch failed:', String(e.message ?? e))
}
