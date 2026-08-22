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

// ══ 6. The floor: the shell works below the tablet breakpoint ══
//
// The sidebar used to be an unconditional `w-56` with no breakpoint, so on a
// 375px phone the page had 151px to live in — 103 after padding. Tablets are
// the primary floor device and phones are used for photographs, so the shell
// has to fold rather than squeeze.
const nav = fs.readFileSync('app/components/Nav.tsx', 'utf8')
check('the sidebar becomes a drawer below the breakpoint',
  /md:static/.test(nav) && /-translate-x-full/.test(nav),
  'the sidebar is still an unconditional column')
check('…with a way to open it', /Open menu/.test(nav))
check('…and a way to close it without navigating', /Close menu/.test(nav) && /Escape/.test(nav))
check('the collapse preference survives a reload',
  /localStorage\.setItem\(COLLAPSE_KEY/.test(nav),
  'collapse was useState(false) and reset on every load')
check('the drawer closes on navigation rather than covering the page it opened',
  /setDrawer\(false\) \}, \[pathname\]\)/.test(nav))

const layout = fs.readFileSync('app/layout.tsx', 'utf8')
check('the page clears the fixed floor bar instead of hiding under it',
  /pt-16 md:p-6|pt-16/.test(layout), 'main has no top padding below the breakpoint')

// Touch targets on the screens used standing up.
const FLOOR_SCREENS = [
  'app/runsheet/[id]/checkin/page.tsx',
  'app/runsheet/[id]/checkout/page.tsx',
  'app/runsheet/[id]/log/page.tsx',
]
const smallChips = FLOOR_SCREENS.filter(f =>
  /inline-block px-3 py-2 rounded-lg border text-sm/.test(fs.readFileSync(f, 'utf8')))
check('the run sheet condition chips meet a 44px touch target',
  smallChips.length === 0, `${smallChips.length} screens still on the ~36px chip`)

const css = fs.readFileSync('app/globals.css', 'utf8')
check('…because the target is a shared class, not a per-page fix',
  /\.cd-chip\s*\{[^}]*min-height:\s*44px/.test(css))

// The camera path — the one thing phones are actually for here.
const upload = fs.readFileSync('app/components/MediaUpload.tsx', 'utf8')
check('capture opens the camera directly on a phone', /capture: 'environment'/.test(upload))
check('…but is not forced for documents, or a supplier’s emailed PDF could not be attached',
  /accept === 'document' \? \{\} :/.test(upload))

// ══ 7. Destructive actions ask first ══
//
// 35 delete/remove actions existed and five confirmed anything. The unguarded
// ones included deleting an expense (income statement), a fixed asset (balance
// sheet) and a whole cabinet bank — one click, no question, no undo.
//
// Only HARD deletes of things with financial or structural consequence are
// listed. Soft/restorable removals (hiding a statement row, withdrawing a
// pending leave request) deliberately stay one click: ceremony on a reversible
// action just teaches people to click through the dialog.
const MUST_CONFIRM = [
  ['app/finance/expenses/page.tsx', 'deleting an expense'],
  ['app/admin/assets/page.tsx', 'removing a fixed asset'],
  ['app/rooms/arrange/page.tsx', 'deleting a cabinet bank'],
  ['app/admin/licenses/page.tsx', 'deleting a licence'],
  ['app/inventory/cats/[id]/page.tsx', 'removing a cat cost'],
]
const unconfirmed = MUST_CONFIRM.filter(([f]) => !/ConfirmSubmit/.test(fs.readFileSync(f, 'utf8')))
check('destructive deletes ask before they fire',
  unconfirmed.length === 0, unconfirmed.map(([, what]) => what).join(', '))

// The message has to say WHAT goes. "Are you sure?" tells nobody anything.
const vagueConfirm = MUST_CONFIRM.filter(([f]) =>
  /message=\{?["'`]\s*(Are you sure|Confirm)\b/i.test(fs.readFileSync(f, 'utf8')))
check('…and say what is being destroyed, not just "are you sure"',
  vagueConfirm.length === 0, vagueConfirm.map(([f]) => f).join(', '))

// The dialog is a guard against a slip, NOT authorisation — it is client-side
// and a form still posts without JavaScript. Anything that must not happen is
// refused server-side, and these two already are.
const roleSrc = fs.readFileSync('app/hr/roles/actions.ts', 'utf8')
check('a role still holding staff is refused on the SERVER, not by a dialog',
  /holders > 0/.test(roleSrc))
const roomSrc = fs.readFileSync('app/rooms/[id]/settings/page.tsx', 'utf8')
check('a room with booking history is refused on the SERVER',
  /has-bookings/.test(roomSrc))

// ══ 8. Live: the landing actually lands there ══
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
