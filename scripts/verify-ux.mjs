import 'dotenv/config'
import './_guard.mjs'
import fs from 'node:fs'
import path from 'node:path'

// The structural UX guarantees — the ones that are easy to regress silently
// because nothing breaks when they go.
//
// Measured before this round (docs/PLAN-UI-UX.md §2.5):
//   56 files rendered a server-action form
//    4 of them acknowledged the click
//
// A button that gives no feedback for 1.5s is the single largest contributor
// to the OS feeling laggy, and the reflex it produces — pressing again — really
// did advance an appointment twice on the service board. So "every action form
// ships a pending state" is a claim worth pinning.
//
// Static assertions on purpose: `SubmitButton` renders an ordinary
// `<button type="submit">` until the moment it is pressed, so there is nothing
// in the served HTML to tell it apart. The source IS the observable.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.tsx')) files.push(p.replace(/\\/g, '/'))
  }
})('app')

// ══ 1. Every server-action form acknowledges the click ══
//
// One documented exception: /whatsapp posts a NATIVE form to an API route
// rather than calling a server action. `useFormStatus` reports nothing for a
// real form POST — the browser does its own navigation and shows its own
// spinner — so a pending component there would be decoration that never fires.
const PENDING_EXEMPT = new Set([
  'app/whatsapp/page.tsx',
])

const actionForms = files.filter(f => fs.readFileSync(f, 'utf8').includes('<form action={'))
const missing = actionForms
  .filter(f => !PENDING_EXEMPT.has(f))
  .filter(f => !/SubmitButton|TaskCheck/.test(fs.readFileSync(f, 'utf8')))

check(`every server-action form acknowledges the click (${actionForms.length} files)`,
  missing.length === 0,
  `${missing.length} without: ${missing.slice(0, 6).join(', ')}`)

// The exemption must stay honest: if that page ever switches to a server
// action, the exemption silently stops being true.
for (const f of PENDING_EXEMPT) {
  const src = fs.readFileSync(f, 'utf8')
  check(`the ${f} exemption is still a native form post, not a server action`,
    /<form action="\//.test(src),
    'it now uses a server action and should carry a pending state')
}

// ══ 2. No raw submit buttons sneak back in ══
// Only raw submits inside a SERVER-ACTION form count. A native form — a GET
// search box, or a POST to an API route — gets the browser's own navigation
// spinner, and `useFormStatus` reports nothing for it, so a pending component
// there would be decoration that never fires. Checking per-file rather than
// per-form flagged the boarding wall's search box, which was a false positive.
function rawSubmitsInActionForms(src) {
  const forms = [...src.matchAll(/<form\b[^>]*>/g)]
  const buttons = [...src.matchAll(/<button\s+type="submit"/g)]
  return buttons.filter(b => {
    const owner = forms.filter(f => f.index < b.index).pop()
    return owner ? owner[0].includes('action={') : false
  }).length
}

const rawSubmits = actionForms.filter(f => {
  const src = fs.readFileSync(f, 'utf8')
  // Pending.tsx IS the implementation — it has to contain the raw button.
  if (f === 'app/components/Pending.tsx') return false
  return !PENDING_EXEMPT.has(f) && rawSubmitsInActionForms(src) > 0
})
check('no bare <button type="submit"> left inside an action form',
  rawSubmits.length === 0, rawSubmits.slice(0, 6).join(', '))

// ══ 3. Something in the OS is actually announced to a screen reader ══
const pending = fs.readFileSync('app/components/Pending.tsx', 'utf8')
check('there is an aria-live region for async state changes',
  /aria-live/.test(pending), 'no aria-live anywhere — state changes are silent')
check('…and it does not claim success it cannot verify',
  !/Saved successfully|Success!/.test(pending),
  'announcing success from a component that cannot see the result is a lie')

// ══ 4. The landing page is the brief, not the 6-second dashboard ══
const roles = fs.readFileSync('lib/roles.ts', 'utf8')
check('the Manager role lands on the brief, not the dashboard',
  /Manager: '\/brief'/.test(roles), 'ROLE_HOME.Manager is not /brief')

const loginRoute = fs.readFileSync('app/api/login/route.ts', 'utf8')
check('the owner login reads the landing from the role rather than hardcoding it',
  /homeFor\('Manager'\)/.test(loginRoute))

// ══ 5. Wide tables cannot push the page sideways ══
//
// A table wider than the viewport scrolls the whole BODY, which on a tablet
// means the nav slides away and the page looks broken. Each wide table has to
// scroll inside its own container instead.
const tablePages = files.filter(f => fs.readFileSync(f, 'utf8').includes('<table'))
const unguarded = tablePages.filter(f => {
  const src = fs.readFileSync(f, 'utf8')
  // A table is guarded if an overflow container appears anywhere before it.
  return !/overflow-x-auto|overflowX: 'auto'|overflow-auto/.test(src)
})
check(`wide tables scroll inside their own container (${tablePages.length} pages with tables)`,
  unguarded.length === 0,
  `${unguarded.length} unguarded: ${unguarded.slice(0, 8).join(', ')}`)

// ══ 6. Live: the landing actually lands there ══
if (process.env.SKIP_LIVE !== '1') {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }), redirect: 'manual',
  })
  const to = new URL(login.headers.get('location') ?? '/', BASE).pathname
  check('signing in as the owner lands on /brief', to === '/brief', to)

  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  const brief = await fetch(`${BASE}/brief`, { headers: { cookie } })
  check('…and that page opens', brief.status === 200, `status ${brief.status}`)
}

console.log(`\n${pass}/${total} checks passed`)
if (pass !== total) process.exitCode = 1
