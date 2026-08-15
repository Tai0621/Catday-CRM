import 'dotenv/config'

// The Intelligence section of the sidebar.
//
// It used to be a static heading with its four links always on show. It is now
// a drop-down like the six business segments, which means two things have to
// hold at once and they pull in opposite directions:
//
//   COLLAPSED elsewhere — its links must not be in the document when you are
//   somewhere else, or it is not a drop-down, just a heading with an arrow.
//
//   OPEN when you are inside it — landing on /ask with the menu that contains
//   /ask shut is the one state that makes a collapsible sidebar feel broken.
//
// Also checked: the name changed everywhere the owner can read it. A section
// called "Intelligence" in the sidebar and "AI" on the screen that grants
// access to it is two names for one thing.

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3100'
const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: process.env.APP_PASSWORD ?? '' }).toString(), redirect: 'manual',
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
if (!cookie.startsWith('auth=')) throw new Error(`login failed (${login.status})`)

/**
 * The sidebar as rendered, tags stripped.
 *
 * Read from the <aside> only. The RSC payload later in the document repeats
 * every label whether or not it is on screen, so searching the whole page
 * cannot tell an open drop-down from a shut one — which is precisely what is
 * under test here.
 */
async function sidebar(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } })
  const html = await res.text()
  const aside = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? ''
  return { status: res.status, nav: aside.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }
}

// ══ 1. The name ══
const board = await sidebar('/board')
check('the sidebar renders', board.status === 200 && board.nav.length > 0, `status ${board.status}`)
check('the section is called Intelligence', board.nav.includes('Intelligence'), board.nav.slice(0, 200))
// The old heading was the bare word "AI" between other headings. Its absence is
// what proves the rename landed rather than adding a second section.
check('…and the old "AI" heading is gone', !/\bAI\b/.test(board.nav), board.nav.slice(0, 240))

// ══ 2. Collapsed when you are somewhere else ══
// /board is in Operations, so Intelligence should be shut and its links absent.
check('its links are NOT in the document from another page',
  !board.nav.includes('Morning Brief') && !board.nav.includes('Monthly Reports'),
  'Intelligence rendered its links while collapsed — that is a heading, not a drop-down')

// ══ 3. Open when you are inside it ══
const ask = await sidebar('/ask')
check('landing on Assistant opens the drop-down that holds it',
  ask.nav.includes('Morning Brief') && ask.nav.includes('Monthly Reports'),
  ask.nav.slice(0, 300))
check('…and the tab you are on is listed', ask.nav.includes('Assistant'), ask.nav.slice(0, 300))

const reports = await sidebar('/reports')
check('the same holds arriving at Monthly Reports', reports.nav.includes('Assistant'), reports.nav.slice(0, 300))

// ══ 4. The other sections still behave ══
check('a business segment is still shown', board.nav.includes('Operations'), board.nav.slice(0, 240))
check('…and opens on the page it holds', board.nav.includes('Service Board'), board.nav.slice(0, 300))

// ══ 5. One name, both readers ══
// lib/nav-catalogue is the single source; the role editor must show the same
// word the sidebar does.
const roles = await fetch(`${BASE}/hr/roles`, { headers: { Cookie: cookie } })
const rolesHtml = await roles.text()
check('the role editor groups tabs under Intelligence too',
  rolesHtml.includes('Intelligence'), `status ${roles.status}`)

// ══ 6. The page it links to agrees ══
const aiPage = await (await fetch(`${BASE}/ai`, { headers: { Cookie: cookie } })).text()
check('the Overview page is titled Intelligence, not AI',
  /<h1[^>]*>\s*Intelligence\s*<\/h1>/.test(aiPage),
  aiPage.match(/<h1[^>]*>[^<]*<\/h1>/)?.[0] ?? '(no h1)')

// ══ 7. Renaming a label is not a permission change ══
check('the AI pages still open', (await fetch(`${BASE}/ask`, { headers: { Cookie: cookie } })).status === 200)

console.log(`\n${pass}/${total} passed`)
if (pass !== total) process.exitCode = 1
