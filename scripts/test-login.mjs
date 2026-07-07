import 'dotenv/config'

const BASE = 'https://catday-crm.vercel.app'
const pw = process.env.APP_PASSWORD ?? ''
console.log(`Testing login (password length ${pw.length})…`)

// 1) POST the password to /api/login, don't auto-follow redirects
const body = new URLSearchParams({ password: pw }).toString()
const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
  redirect: 'manual',
})
const loc = login.headers.get('location') ?? ''
console.log(`/api/login -> HTTP ${login.status}, redirect: ${loc.replace(BASE, '') || '(none)'}`)

if (loc.includes('/login')) {
  console.log('✗ LOGIN REJECTED — stored APP_PASSWORD does not match. (Likely trailing char or empty value in Vercel.)')
  process.exit(0)
}
console.log('✓ Login accepted.')

// 2) Grab the auth cookie and hit the DB-backed dashboard
const setCookie = login.headers.get('set-cookie') ?? ''
const authCookie = setCookie.split(',').map(s => s.trim()).find(s => s.startsWith('auth='))?.split(';')[0]
if (!authCookie) { console.log('? No auth cookie returned, cannot test dashboard.'); process.exit(0) }

const dash = await fetch(`${BASE}/`, { headers: { Cookie: authCookie }, redirect: 'manual' })
console.log(`GET / (authenticated) -> HTTP ${dash.status}`)
if (dash.status === 200) console.log('✓ Dashboard loads — database connection OK.')
else if (dash.status >= 500) console.log('✗ Dashboard 500 — DB token still broken.')
else console.log(`? Unexpected: ${dash.status} ${dash.headers.get('location') ?? ''}`)

// 3) Intelligence Round pages
for (const path of ['/actions', '/ask', '/customers']) {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: authCookie }, redirect: 'manual' })
  console.log(`GET ${path} -> HTTP ${r.status} ${r.status === 200 ? '✓' : '✗'}`)
}
