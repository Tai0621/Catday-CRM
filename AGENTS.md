<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Cat Day CRM / Business OS — Build Guide

This file is the onboarding brief for any AI coding assistant (Cursor, Claude Code, etc.) working on
this repo. It captures not just the stack, but the **philosophy and conventions** this codebase has
been built with, so new work matches the existing quality bar instead of drifting from it. Read this
in full before writing code — several of these rules will produce working-looking code that is
actually wrong (silently breaks migrations, corrupts money data, or 404s in production) if skipped.

## What this is

**Cat Day** is a premium cat grooming & boarding business in Malaysia. This app is not a generic CRM —
it is their **business Operating System**: a single self-hosted system that replaces the third-party
SaaS tools a business like this would normally scatter data across (booking, POS, loyalty, accounting,
HR), specifically so the owner never has business data living outside their own system.

The OS is organized into **six business segments** (the owner's mental model, and the nav's structure):
1. **Operations & Sales** — Grooming, Boarding, Sales (appointments, POS, rooms, service board)
2. **Human Resource** — Staff & PINs
3. **Finance** — Income Statement, Balance Sheet, Cash Flow (the "3-Statement" set), Expenses,
   Revenue, Financial Plan, A/R & A/P aging
4. **Customers · CRM** — Customers, Cats, Memberships, WhatsApp, Incidents
5. **Marketing** — Academy (more planned)
6. **Administrative** — reserved, not yet built

All currency is **RM (Malaysian Ringgit)**. All money values are `Float` in RM (no cents-as-integer
convention — be consistent with the existing `Math.round(v * 100) / 100` rounding pattern used
everywhere money is computed).

## Stack (verify against `package.json` — versions move)

- **Next.js 16** (App Router, Turbopack). `proxy.ts` at the repo root is the middleware-equivalent
  (Next 16 renamed `middleware.ts` → `proxy.ts` and the exported function to `proxy`). There is no
  `middleware.ts` in this project — don't create one.
- **React 19**, **TypeScript 5** (strict), **Tailwind CSS 4**.
- **Prisma 7** with `@prisma/adapter-libsql`, **Turso** (libsql) as the actual database.
- Deployed on **Vercel**, region pinned to `hnd1` (Tokyo) — see Performance section, this is load-bearing.

Before writing any Next.js code, skim `node_modules/next/dist/docs/` for the actual current API —
do not assume App Router conventions from older training data hold here.

## The single most important gotcha: Prisma 7 + Turso migrations

**`prisma migrate dev` and `prisma db push` DO NOT WORK** against a `libsql://` URL in Prisma 7. Don't
run them — they will fail or silently do nothing useful.

The established pattern for every schema change is:

1. Edit `prisma/schema.prisma` as normal.
2. Write a **migration script** in `scripts/migrate-<feature>.mjs` that applies the equivalent raw SQL
   (`ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX`, etc.) via Turso's HTTP `/v2/pipeline` API. Copy the
   shape of any existing `scripts/migrate-*.mjs` file — they all follow the same template:
   ```js
   import 'dotenv/config'
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
   // ...safe(`ALTER TABLE "X" ADD COLUMN "y" TEXT`, 'X.y')
   ```
   Make every migration script **idempotent** (the `safe()` helper's duplicate-column/already-exists
   tolerance is what makes re-running safe) — you will re-run these.
3. Run the script directly: `node scripts/migrate-<feature>.mjs`.
4. Run `npx prisma generate` to regenerate the client from the updated schema.
5. **Restart the dev server.** The dev server caches the old Prisma client in memory; after
   `prisma generate` for a new model/field, the *running* dev server will throw confusing errors
   (including making unrelated server actions 404) until it's restarted. This has cost real debugging
   time more than once — always restart after a schema change, don't just rebuild.
6. `npm run build` includes `prisma generate` (see `package.json`), so production builds pick up the
   new client automatically on deploy — but you still need the migration script to have run against
   the actual database (build time doesn't touch the DB).

SQLite via libsql has **no native enums** — every "enum-like" field is a plain `String` with the
allowed values documented in a `//` comment on the schema field, and the actual allowed-values list
lives in `lib/constants.ts` (`APPOINTMENT_STATUSES`, `REVENUE_CATEGORIES`, etc.). Follow this pattern
for new fields — don't introduce a different way of representing choice fields.

## Database access & performance

- All queries go through the singleton in `lib/db.ts` (`PrismaClient` + `PrismaLibSql` adapter,
  cached on `global.__prisma` to survive Next's dev hot-reload).
- **Vercel region must stay `hnd1`** (`vercel.json`) because the Turso database lives in
  `aws-ap-northeast-1`. This was tuned after a real incident: wrong region (`sin1`) made the dashboard
  take ~6s (30 queries × ~70ms cross-region round trip); `hnd1` brought it to ~0.5s. Don't move the
  region without a reason, and if you do, re-measure.
- **Prefer an explicit `select` over `include`/bare fetches on the `Cat` model in list/dashboard
  queries.** Historically `Cat.photos` stored base64 data-URLs that rode along in a full-table fetch
  and made the query enormous; that column was removed in the A1 data-protection round (cat photos now
  live in `MediaAsset` / private Blob, `ownerType 'cat'`, loaded on demand). The `select` discipline
  still stands — `Cat` carries several free-text notes fields — see `lib/dashboard.ts`,
  `lib/actions.ts`, `app/cats/page.tsx` for the pattern.
- Add `@@index` on any column you'll filter/sort by at scale — this project added indexes on
  `Appointment(customerId, catId, status, scheduledAt)`, `Transaction(customerId, date, reference)`,
  etc. after the fact; do it proactively for new hot paths instead.
- `app/loading.tsx` provides an instant-navigation spinner app-wide — don't remove it, it's part of
  why navigation feels instant despite server-rendering.

## Auth model

Single httpOnly cookie named `auth`, two kinds of session sharing one signed-token format
(`lib/auth.ts`):

- **Manager** — the owner logs in with one shared `APP_PASSWORD` (env var).
- **Staff** — individual named accounts in the `Staff` model, each with a personal PIN
  (`pinHash` = **salted scrypt**, format `scrypt$N$r$p$salt$hash`, never store plaintext), and a
  `role` (`Manager | FrontDesk | Groomer | Boarding`) that decides what nav/pages they see. Because
  the hash is salted, login can't look a PIN up directly — `/api/login` fetches active staff and
  `verifyPassword`s the PIN against each; a legacy unsalted sha256 hash still verifies and is
  transparently re-hashed to scrypt on that login (`needsRehash` → `hashPassword`).

Token format (`lib/auth.ts`, mirrored edge-side in `proxy.ts`): `v3.<base64url payload>.<HMAC-SHA256
signature>`. The payload carries `iat`/`exp` (hard 30-day expiry) and `ep` (the `SESSION_EPOCH`),
signed with `SESSION_SECRET` (falling back to `APP_PASSWORD` until it's set). **Any of these
invalidates every session: rotating `SESSION_SECRET`/`APP_PASSWORD`, or bumping `SESSION_EPOCH`.** The
old `v2` sha256 format and the legacy plain-password-hash cookie were removed in the auth-hardening
phase — don't reintroduce them. When you touch the token shape, change `lib/auth.ts` **and**
`proxy.ts` together (the edge check is a hand-mirror of the node one).

`proxy.ts` (the middleware) does two things: redirects anyone without a valid cookie to `/login`, and
maintains a `MANAGER_PATHS` array of route prefixes that non-manager staff get bounced away from
(redirected to `/board`). **When you add a manager-only page (most of Finance, Staff, Services,
Cash-up, etc.), you must add its path prefix to `MANAGER_PATHS` in `proxy.ts` — the page itself should
also call `requireManager()` from `lib/auth.ts` as defense in depth.** Relying on only one of the two
has been a real bug source.

The `proxy.ts` matcher explicitly excludes static assets (images/fonts) — if you add new public
assets, don't let them get swept back under the auth gate; a mis-scoped matcher once broke the login
page's own logo (it 404'd behind the auth redirect for logged-out visitors, i.e., everyone hitting the
login page).

## Design system — follow exactly, don't improvise a new palette

This is a considered brand, not default Tailwind. Colors are used consistently and semantically
across the whole app — inventing new hex values for a new page is a regression, not a feature.

**Core palette** (see `app/globals.css` `:root` and the `cd-*` utility classes):
- Ink / near-black text: `#2D1907`
- Cream background: `#F2EDE0` / card cream: `#ECDBB6`
- Rust/brand accent (primary buttons, active states): `#B14919`
- Teal (boarding-adjacent, secondary accent): `#729094`
- Gold (membership-adjacent): `#B8902B` / `#E7CE7A`

**Segment colors** (`lib/segments.ts`, `SEGMENTS` record) — one color per business area, used
identically across nav dots, Action Inbox badges, dashboard tiles, appointment chips:
`grooming` (`#B14919`), `boarding` (`#729094`), `membership` (`#B8902B`), `community` (`#7A8A4F`),
`business` (`#2D1907`). When a new feature belongs to one of these areas, pull its color from
`SEGMENTS`, don't hardcode a new one.

**Reusable classes** — use `.cd-card`, `.cd-btn`, `.cd-btn-sec`, `.cd-input`, `.cd-label`, `.cd-pill`,
`.cd-thead`, `.cd-tbody`, `.cd-muted`, `.cd-link`, `.cd-section-header` (defined in
`app/globals.css`) instead of rebuilding equivalent Tailwind class soup inline. New shared visual
patterns should become a new `.cd-*` class, not a one-off `className` string repeated on every page.

**Accounting color convention** (income statement, balance sheet): **black = live, derived from
operational data, updates automatically; blue (`#1D4ED8`) = hard-keyed by the accountant, an
override.** This is a real double-entry-bookkeeping convention (matches how spreadsheets are
color-coded in practice), not a UI whim — preserve it in any new financial view. Red (`#B14919`,
the rust) doubles as the "negative / warning / overdue" signal throughout.

**Icons**: no emoji in the product UI. The sidebar uses a hand-built monochrome SVG icon set
(`app/components/NavIcons.tsx`) — all `stroke="currentColor"` so they inherit whatever text color
surrounds them (cream in the dark sidebar, ink elsewhere). Add new icons to that file in the same
style (24×24 viewBox, `strokeWidth={1.7}`, rounded caps/joins) rather than reaching for an emoji or a
new icon library.

**Company logo**: `public/catday-logo.png` (brand-ink colored, transparent, for light backgrounds) and
`public/catday-logo-cream.png` (cream-colored, for the dark sidebar) — both derived from the same
source art via a luminance-keying script. If you need the logo somewhere new, reuse these files; don't
re-derive from scratch.

## Data-integrity rules (these have caused real bugs — read before touching money/points/stock)

1. **Finance reads operations; it never writes to them.** The three financial statements
   (`lib/finance.ts`, `lib/balance-sheet.ts`, `lib/cash-flow.ts`) compute everything from existing
   operational tables (`Transaction`, `Expense`, `Appointment`, `WalletEntry`) **read-only**. They
   never mutate `Appointment`, `Transaction`, POS state, or anything a front-desk user would see
   differently. If a finance feature seems to require changing operational data (e.g. an early plan to
   reclassify deposits as deferred revenue), the correct move — confirmed with the owner — was to
   **not** do it, specifically to avoid any risk of finance logic corrupting what operations sees.
   Keep this boundary. Any accrual/adjustment logic belongs in a finance-only keyed cell, never in a
   silent change to how `POS`/`Appointment`/`CashUp` record things.

2. **Ledger + cached balance, always together.** `LoyaltyEntry` and `WalletEntry` are append-only
   ledgers (every entry has `points`/`amount`, `reason`/`kind`, and a note); `Customer.pointsBalance`
   and `Customer.walletBalance` are denormalized running totals kept in sync **in the same
   `db.$transaction`** as the ledger write (see `lib/loyalty.ts` `awardPoints`, `lib/wallet.ts`). If
   you add a new balance-like field, follow this exact pattern — ledger entry + balance update, one
   atomic transaction, never just incrementing the balance alone (that loses the audit trail and makes
   reversal impossible).

3. **Anything a POS checkout creates must be reversible by deleting the sale.** `app/pos/actions.ts`
   `checkout()` does several things atomically: creates `Transaction`+`TransactionLine`s, marks
   settled `Appointment`s paid, decrements `Product.stockQty`, awards loyalty points, and optionally
   spends wallet balance. `app/revenue/actions.ts` `deleteTransaction()` is the inverse of *all* of
   that: it finds sibling transactions sharing the same `reference` (a split payment shares one
   reference across two `Transaction` rows — delete them together, never half), reverses the
   `LoyaltyEntry`/points, refunds the `WalletEntry`/wallet balance, restocks products, and **re-opens
   any `Appointment` the sale had marked paid** (via `TransactionLine.appointmentId`, the explicit link
   between a sale line and the visit it settled). When you add a new POS side effect, you must also add
   its reversal here — an unreversed side effect after a deleted correction is exactly the kind of bug
   that erodes trust in the numbers.

4. **Deletes are usually soft, in the sense of "restorable," for anything with financial history.**
   E.g. removing a built-in income-statement row doesn't delete data — it adds a row to
   `StatementHiddenRow`, filtered out at render time and restorable. Only genuinely orphan-free,
   accountant-entered records (a custom statement row with zero postings, e.g.) get hard-deleted. When
   building a "remove this" feature on financial data, default to hide/restore, not `DELETE`.

## Verification philosophy — every non-trivial change ships with a script that proves it

This codebase does not consider a feature done because it compiles and "looks right" in a screenshot.
The standing practice is:

1. **`npm run build`** after every change — must compile clean (this also runs `prisma generate`, so
   it will surface a schema/client mismatch).
2. Write a **`scripts/verify-<feature>.mjs`** E2E script that: seeds known test data directly into
   Turso via the same HTTP `/v2/pipeline` pattern as the migration scripts (mark rows with a distinct
   `notes`/`note` value like `'VERIFYFOO'` so cleanup is unambiguous), logs in via
   `POST /api/login`, drives the real HTTP behavior (page fetches, or server actions — see below),
   asserts exact expected values, and **always cleans up its seeded rows in a `finally` block**, even
   on failure. Every `verify-*.mjs` in `scripts/` follows this shape — copy one as a template rather
   than inventing a new structure.
3. Run the script and report the pass count (e.g. "12/12"). Don't declare something fixed/built without
   this. When a change touches shared logic (the income statement builder, the checkout reversal,
   etc.), **re-run every existing `verify-*.mjs` script that plausibly regresses**, not just the new one.

**Driving a server action from a verification script (no browser)**: there are two techniques, and
which one applies depends on how the action takes its input. Check that first — most of the time it's
the simpler one.

**A. `<form action={serverFn}>` actions — submit the real form (preferred).** A form rendered from a
Server Component ships as a genuine no-JS form: `method="POST"`, `encType="multipart/form-data"`, and
a hidden `$ACTION_ID_<hex>` input carrying the action reference. Submitting it is therefore an
ordinary multipart POST back to the same URL — no `Next-Action` header, no chunk scraping.

```js
// 1. Fetch the page HTML (with the auth cookie if the route needs one).
// 2. Split out each <form ...>…</form>; from each, read:
//      the hidden  name="$ACTION_ID_<hex>"   → the action reference
//      every other name="…" value="…"        → the fields the page already filled in
// 3. Pick the form you want by a marker in its own markup (a hidden id, a distinctive
//    value=…) rather than by position — pages render many similar forms.
// 4. POST multipart back to the SAME page URL: append the $ACTION_ID_<hex> key (empty
//    value), then the form's own fields, then any overrides. Use redirect: 'manual',
//    because actions that end in redirect() return a 303.
// 5. Assert on the resulting DB state, not the response body.
```
This is what a browser with JavaScript disabled does, which is why it is the more robust option: it
behaves **identically against `next dev` and `next start`**. `scripts/verify-reviews-referrals.mjs`
has the reference implementation (`formsIn` / `findForm` / `submitForm`) — reuse it verbatim.

**B. Actions called with arguments (not FormData) — resolve the id from the chunks.** Next's dev
server (Turbopack) compiles each file-level `'use server'` action into a client-visible export named
`$$RSC_SERVER_ACTION_n`, itself instantiated via `createServerReference("<40-hex-id>")`, but the
mapping is spread across whichever chunk Turbopack happens to bundle it into that compile — the
mapping is **not stable** and production manifests (`.next/server/**/server-reference-manifest.json`)
use *different* ids than the live dev server, so don't trust the manifest file.
```js
// 1. Fetch the page HTML, collect every /_next/static/chunks/*.js path referenced
//    anywhere in it (not just <script> tags — client-component chunks often only
//    appear in escaped RSC flight strings).
// 2. Fetch each chunk, look for: "actionName", ()=>$$RSC_SERVER_ACTION_n
// 3. In the same chunk, find: const $$RSC_SERVER_ACTION_n = ...createServerReference("<hex>"
// 4. POST to the page URL with headers { 'Next-Action': hex, 'Content-Type': 'text/plain;charset=UTF-8' }
//    and body JSON.stringify([...args]) (an array of the action's arguments, JSON-encoded).
// 5. Dev registers file-level actions lazily on first hit — retry on a 404 a few times with a
//    short delay before giving up.
```
See `scripts/verify-hidden-rows.mjs` for the exact regex/retry implementation — reuse it verbatim,
don't re-derive it. **This one only works against `next dev`**: the `$$RSC_SERVER_ACTION` symbols are
a dev-build artefact, so a script relying on it must not be pointed at a `next start` build.

**Actions must be file-level to be drivable either way.** An action declared *inside* a page
component closes over local scope and is not exposed under its own name, so neither technique can
find it. That matches the convention above anyway — a route with more than one mutation puts them in
a colocated `actions.ts`. If a verification script can't reach an action, the fix is usually to move
it there, not to work around it.

**Preview-pane caveat**: an embedded browser preview pane may not reliably execute Next's streaming
HTML swap when `loading.tsx` is present — pages can appear stuck on a spinner there even though a real
browser and `curl`/`fetch` against the same URL work fine. Don't diagnose a "broken page" from a
preview pane alone; verify with an authenticated `fetch`/`curl` first.

## Deployment

- Vercel project, connected to GitHub `main`; pushing to `main` auto-deploys **to the live OS the
  business runs on**. `main` is for tagged releases, not work in progress — day-to-day work belongs
  on `develop`, which deploys to the demo URL against a separate database. The full setup, and the
  one ordering mistake that would point a preview at real customer data, are in
  [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md).
- Which deployment a process is runs through `lib/environment.ts` (`appEnv()`), derived from
  `VERCEL_ENV` so a new preview branch is a demo automatically and can never present itself as
  production. Non-production renders a standing `DEMO` banner and sets `robots: noindex`.
- **Local default branch is `master`, GitHub's default is `main`** — push with
  `git push origin master:main`, not a bare `git push`.
- On Windows, the Vercel CLI needs `$env:XDG_DATA_HOME` pointed at a writable path outside any
  synced/locked directory, plus `NEXT_TELEMETRY_DISABLED=1`, to run reliably — if `npx vercel` hangs
  or errors oddly on this machine, that's almost always why.
- Env vars required in Vercel (mirror `.env` locally): `DATABASE_URL`, `DATABASE_AUTH_TOKEN`,
  `APP_PASSWORD`, `ANTHROPIC_API_KEY`, `AI_ASSISTANT_MODEL`, `WHATSAPP_ANALYSIS_MODEL`, `CRON_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `GOOGLE_FORMS_SECRET`.

## The model provider seam

Every AI call goes through `createMessage()` in `lib/ai/provider.ts` — **never construct an SDK
client or read an AI key at a call site.** `scripts/verify-ai-provider.mjs` asserts that no file
outside the provider does either, so a bypass fails verification rather than working quietly until
someone switches provider.

Production runs on **Anthropic**; the demo runs on **Groq**, which is fast and cheap enough to leave
switched on for prospects. Selection is `AI_PROVIDER` (`anthropic` | `groq`), falling back to
whichever key is present — Anthropic wins when both are, so a deployment can never drift onto the
cheaper one by accident.

Groq is **OpenAI-compatible and does not speak Anthropic's Messages API**, so this is a translation
layer, not a base-URL swap: pointing the Anthropic SDK at Groq fails on the first request. The seam
presents the Anthropic shape (`tool_use` blocks, `tool_choice: { type: 'tool' }`) because that is
what the call sites and production already use. Reached with plain `fetch` — no second SDK.

The subtle part is the tool round trip: Anthropic carries a tool result as a `tool_result` block
inside a *user* message, OpenAI wants a separate `role: 'tool'` message with a matching
`tool_call_id`. Getting that wrong does **not** error — the model simply loses the result and answers
as though the tool returned nothing. That translation is exercised offline in the verify script.

`AI_ASSISTANT_MODEL` is honoured only when it plausibly belongs to the active provider; a leftover
`claude-…` id on a Groq deployment is ignored rather than sent as a guaranteed 404.

Locally the two configs are separate files, both gitignored:

```bash
source .env.demo.sh && source .env.groq.sh && npx next start -p 3100   # demo, AI on
source .env.demo.sh && npx next start -p 3100                          # verification, AI off
```

That split is deliberate — most `verify-*.mjs` scripts need a server with **no** AI key to reach the
fail-closed paths, and folding the Groq key into `.env.demo.sh` would silently break them.
- `vercel.json` also defines a Vercel Cron (`/api/cron/eod-analysis`, daily 16:00 UTC) — if you add
  another scheduled job, add it there, protected by checking `CRON_SECRET`.

## File & code conventions

- Server Components by default; a component only becomes `'use client'` when it genuinely needs
  interactivity (forms with client-side validation feedback, drag-and-drop, live-recomputing scenario
  sliders, etc.) — most pages in this app are plain async Server Components doing a direct `db.*` call
  plus a colocated `'use server'` mutation function, no client JS at all. Don't reach for client
  components/`useEffect`/SWR-style fetching out of habit; it's usually unnecessary here and works
  against the "snappy" performance goal.
- Route-colocated files: a feature at `app/<route>/` typically has `page.tsx` (server), optionally
  `actions.ts` (`'use server'` mutations, when there's more than one or they're reused by a client
  component), and a client component file only when needed (e.g. `PosClient.tsx`, `StatementTable.tsx`).
- **A `'use server'` module may only export async functions.** Adding an innocuous
  `export const SOME_KEY = '…'` to an `actions.ts` does not merely fail on that one symbol — the
  whole module compiles to *no exports at all*, and every importer fails with "the export X was not
  found … The module has no exports." (Type-only exports are fine; they're erased.) Constants that
  an action and its callers share belong in `lib/constants.ts`, not next to the action.
- No comments explaining *what* code does (names should do that); comments are reserved for *why* —
  a non-obvious constraint, a workaround, or an invariant a future reader would otherwise violate. This
  file itself is full of "why" comments for exactly that reason — match that density in code, not more.
- Don't add speculative abstraction, config flags, or "just in case" error handling for inputs that
  can't occur given this app's own guarantees (internal server actions, trusted staff/manager
  sessions). Validate at real boundaries (user-typed form fields, external webhooks) — see how
  `app/pos/actions.ts` and `app/finance/*/actions.ts` validate their `FormData`/JSON payloads as the
  reference level of rigor: check shape, check membership in an allowed-values list, clamp/round
  numbers, return a typed `{ ok: true, ... } | { ok: false; error: string }` result rather than
  throwing across the server-action boundary.
- Money formatting: `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 0 })}` for display,
  negative shown in accounting parens `(RM 1,234)` with rust/red color, not a leading minus sign — this
  convention is used throughout Finance; match it in any new money display.
- Dates that are really "period identifiers" (a month, a day) are stored as **strings**, not
  `DateTime`: `"YYYY-MM"` for month-level things (`BusinessPlan.startMonth`, `BalanceSheetCell.asOf`,
  `MonthlyTarget.month`, `PlanDriver` keys), `"YYYY-MM-DD"` for day-level things (`CashUp.date`,
  `CareTask.date`). This is deliberate — it makes uniqueness constraints and string-prefix queries
  simple. Follow it for new period-keyed data rather than introducing a `DateTime` truncated to
  month-start.

## Testing checklist before calling anything "done"

1. `npm run build` — clean compile.
2. If you touched `prisma/schema.prisma`: migration script run against the real DB, `prisma generate`
   run, **dev server restarted**.
3. A `scripts/verify-*.mjs` written and passing, seeding+asserting+cleaning up real data through the
   actual HTTP/server-action surface — not just a unit test of a pure function in isolation (those are
   fine *in addition*, e.g. for the projection math in `lib/plan-model.ts`, but the primary bar here is
   end-to-end).
4. Any plausibly-affected existing `verify-*.mjs` scripts re-run.
5. If the change touches a manager-only area: confirm the route prefix is in `proxy.ts`
   `MANAGER_PATHS` and the page calls `requireManager()`.
6. If the change touches money, points, wallet, or stock: confirm there's a symmetric reversal path
   (see Data-integrity rule 3) and that it's covered by the verify script.

## Where the (a lot of) accumulated domain knowledge lives

This file covers durable engineering conventions. Day-to-day product/business context — what's been
built so far, why specific business rules exist, exact current schema shape, in-flight roadmap — lives
in `prisma/schema.prisma`'s own comments (kept current) and in the `scripts/verify-*.mjs` files, which
double as executable documentation of exact expected behavior for every feature. If you're missing
business-logic context this file doesn't cover (e.g. "why does grooming interval default differently
for long vs short coat"), read the relevant `lib/*.ts` file first — the "why" comments there are
usually the actual answer — and match its existing behavior rather than guessing.
