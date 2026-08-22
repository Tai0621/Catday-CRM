# UI/UX upgrade — making the OS feel good to use

**Status:** proposal, nothing built. For review and editing before any work starts.
**Measured:** 2026-08-21, against the demo database from a laptop in Malaysia
(~95 ms to Turso in `aws-ap-northeast-1`). On Vercel `hnd1` the round trip is a
fraction of this; the *ratios* are what transfer, not the absolute numbers.

---

## 1. The brief, and what it actually turns out to be

The ask was: *"User should find it pleasing to use the OS instead of feeling
that it's slow / laggy / confusing."*

Those three words look like one complaint. They are three different problems
with three different fixes, and they are worth separating before spending a day
on the wrong one.

| word | what it really means here | where it lives |
|---|---|---|
| **slow** | one page takes six seconds | the dashboard, and almost nothing else |
| **laggy** | you click and nothing happens for a second | every button in the OS |
| **confusing** | 83 pages, 56 nav links, no way to jump | the whole information architecture |

The important finding is that **"slow" and "laggy" are not the same problem, and
"laggy" is the bigger one.** The median page in this OS renders in 540 ms, which
is fine. It still feels bad, because pressing a button produces no
acknowledgement at all until the entire route re-renders around it.

That is the thing to fix first, and it is mostly not a performance problem.

---

## 2. Evidence

Everything below is measured, not estimated. Re-run with the commands in
[PERFORMANCE.md](PERFORMANCE.md).

### 2.1 Page load — `scripts/perf-probe.mjs`

| page | paint | full | queries |
|---|---:|---:|---:|
| `/` | 109 ms | **5952 ms** | **63** |
| `/runsheet` | 144 ms | 1276 ms | 12 |
| `/rooms` | 165 ms | 1201 ms | 7 |
| `/finance/income-statement` | 103 ms | 1131 ms | 11 |
| `/pos` | 96 ms | 1105 ms | 11 |
| `/customers` | 113 ms | 1079 ms | 9 |
| `/board` | 106 ms | 622 ms | 7 |
| `/cats` | 95 ms | 544 ms | 5 |
| median of 18 | ~105 ms | ~540 ms | 6 |

**Correction — there are two slow pages, not one.** The first probe covered 18
routes and I concluded from it that the dashboard was the only slow page. That
was wrong. Measuring the role landing pages afterwards found:

| page | wall | queries | who lands here |
|---|---:|---:|---|
| `/` dashboard | 5952 ms | 63 | the owner, once a day |
| **`/actions` Action Inbox** | **5211 ms** | **47** | **Front Desk, every login** |
| `/brief` Morning Brief | **400 ms** | **3** | the owner (proposed landing) |
| `/runsheet` | 1544 ms | 12 | Boarding carers |
| `/board` | 681 ms | 7 | Groomers |

`/actions` is the worse of the two in practice. The dashboard is one person's
page seen once a morning; the Action Inbox is **Front Desk's home screen**, hit
on every sign-in and returned to all day. It reads `Appointment`, `Cat` and
`Customer` five times each, the same shape as the dashboard, because both are
driven by `buildActionQueue()`.

Everything else measured is acceptable.

### 2.2 What the dashboard is doing — `PERF_ONLY=/`

63 queries, 74.8 s of summed database time. The same tables, over and over:

| table | times read per render |
|---|---:|
| `Customer` | 10 |
| `Appointment` | 8 |
| `Cat` | 7 |
| `Room` | 3 |
| `Membership` | 3 |

These are not N+1 loops. They are independent aggregators each asking for the
same rows in a slightly different shape. PERFORMANCE.md predicted exactly this
under "if more is needed"; it is still true.

### 2.3 When things arrive — `scripts/perf-stream.mjs`

```
shell (nav + heading)           108 ms
action queue placeholder       3645 ms
revenue figures                3645 ms
room occupancy                 3646 ms
action queue content           6276 ms
complete                       6277 ms
```

Read that middle column again: **nothing at all happens between 108 ms and
3645 ms.** The skeleton appears almost instantly and then the user watches it
for three and a half seconds. Fast paint with a long empty middle reads as
*broken*, not as *loading* — arguably worse than a slower paint with steady
progress.

### 2.4 What a button costs — `scripts/perf-action.mjs`

```
tick one checkbox   → 1469 ms, 14 queries
untick it again     → 1330 ms, 14 queries
```

Two of those queries save the change. The other twelve redraw the page around
it. **The write is a rounding error next to the redraw.**

### 2.5 The UX gaps, counted

| affordance | present in the codebase |
|---|---|
| forms driven by a server action | **56 files** |
| ...that acknowledge the click | **3 files** |
| optimistic updates (`useOptimistic`) | **0** |
| toast / confirmation layer | **0** |
| `aria-live` regions | **0** |
| global search or command palette | **0** (across 83 pages, 56 nav links) |
| `revalidatePath` (whole-route redraw) | **161 calls in 46 files** |
| `revalidateTag` (targeted) | **0** |
| routes with a shape-matched skeleton | **4 of 83** |
| table pages guarded against sideways scroll | **16 of 34** |
| mobile navigation | **none — see §2.6** |

### 2.6 There is no mobile layout

`app/layout.tsx` renders the shell as `flex h-full overflow-hidden` with the
sidebar as an unconditional `<aside className="w-56">`. There is no breakpoint,
no drawer, no hamburger, and the collapse toggle is `useState(false)` — not
persisted, so it re-expands on every full load.

On a 375 px phone that leaves **151 px** for the page, and `p-6` takes 48 of
them. Roughly **103 px of usable width.**

This matters more than it looks. The people on their feet all day — groomers at
the service board, carers on the run sheet and the boarding wall — are the ones
least likely to be at a desk. The screens they use most are the ones the OS
handles worst.

---

## 3. What "pleasing" would mean, stated as numbers

Vague goals produce vague work. Proposed targets, each measurable with tooling
that already exists:

| target | today | measured by |
|---|---|---|
| every page fully rendered under **1.5 s** | 17 of 18 pass; `/` fails at 5.9 s | `perf-probe.mjs` |
| every click acknowledged within **100 ms** | 3 of 56 files | new `verify-ux.mjs` |
| no mutation costing more than **4 queries** | a checkbox costs 14 | `perf-action.mjs` |
| any page reachable in **≤ 2 keystrokes** | not possible | manual |
| **no** horizontal body scroll at 375 px | 18 pages fail | new `verify-ux.mjs` |
| dashboard content begins arriving under **1 s** | 3.6 s | `perf-stream.mjs` |

If these are the wrong targets, this is the section to edit.

---

## 4. The work

Ordered by **felt improvement per unit of risk**, not by technical interest.
Each phase is independently shippable and independently valuable.

### Phase 1 — Make every click answer instantly

*The largest felt improvement in the plan, and almost none of it makes anything
faster.*

The gap between pressing a button and seeing evidence that it worked is the
single biggest contributor to "laggy". It is currently 1.3–1.5 s of complete
silence on most screens.

**1.1 One button component, used everywhere.**
`app/components/Pending.tsx` already has `SubmitButton`. It is imported by 3
files out of 56. Roll it out to the rest: disabled state, spinner, and
double-submit prevention. This is not cosmetic — PERFORMANCE.md records that a
second press on the service board *really did advance an appointment twice*.

**1.2 Optimistic updates on binary toggles.**
`useOptimistic` for the interactions that are a flip and cannot half-happen:

- care task tick (run sheet, room page)
- room state → Ready / Cleaning / Out of service
- appointment stage advance on the service board
- check-in / check-out

The row changes the moment it is pressed, and reverts with an explanation if the
server disagrees. This converts 1.5 s of dead air into 0 ms for the common case.

**Caveat worth naming:** an optimistic update that silently reverts is worse
than no optimistic update, because the user has already moved on and believes
the change stuck. Every revert must be visible and must say what happened. This
is why 1.3 comes with it rather than after it.

**1.3 A confirmation layer.**
A small toast system, backed by an `aria-live` region so it is spoken as well as
seen. "Saved", "Room 12 set to Cleaning", "Could not save — Mochi already
checked out". Today the only evidence a save worked is the page redrawing, which
is precisely the thing we are trying to stop doing.

**Verified by:** a new `scripts/verify-ux.mjs` asserting every server-action
form ships a pending state; `perf-action.mjs` for the felt latency.

---

### Phase 2 — Stop redrawing the world

*The part that genuinely makes it faster.*

**2.1 Narrow the revalidation.**
161 `revalidatePath` calls, 0 `revalidateTag`. Every mutation re-runs an entire
route. Ticking a checkbox costs 12 queries of redraw for a 2-query write.

Move the hot paths to tagged revalidation so a care tick invalidates the care
list, not the run sheet, the room, and the wall. Target: no mutation over 4
queries.

**2.2 The dashboard's repeated reads.**
One pass over `Appointment`, `Customer` and `Cat`, derived in memory into the
shapes the panels want, instead of 8 + 10 + 7 separate reads. `lib/shared-reads.ts`
already establishes the pattern (and the trap: React `cache` keys on argument
identity, so passing `new Date()` misses silently while looking like a fix).

Expected: 63 queries → roughly 25. At ~95 ms each that is the difference between
6 s and about 2.5 s.

**2.3 Stream the dashboard in pieces.**
Everything below the shell currently arrives in one lump at 3645 ms. Each panel
should arrive when it is ready, so the page fills in progressively instead of
flipping from skeleton to complete.

**2.4 Consider whether the dashboard should be the landing page at all.**
An honest question rather than a proposal: it is the most expensive page in the
OS and the first thing seen after login. The Morning Brief may be the better
landing for the owner. Flagged for §7.

**Verified by:** `perf-probe.mjs` and `perf-stream.mjs` before/after, recorded
in PERFORMANCE.md as the existing rounds were.

---

### Phase 3 — Make 83 pages findable

**3.1 A command palette (Ctrl/Cmd-K).**
The highest-value IA change available, and it requires *no* restructuring of the
existing navigation. One keystroke, type three letters, jump to any page — and,
if wanted, any customer, cat, room or invoice.

56 nav links across 8 collapsible groups means the thing you want is usually
behind a disclosure triangle you have to remember the name of. A palette makes
the hierarchy optional rather than mandatory.

**Open question (§7):** should it search *data* (customers, cats, sales) or only
*pages*? Data search is far more useful and considerably more work, and it has
an access-control dimension — results must respect `canAccess` and
`MANAGER_ONLY_PATHS`, or the palette becomes a way to see the names of things
you cannot open.

**3.2 Consistent page headers and breadcrumbs.**
Depth is currently invisible. `/rooms/12/settings` looks like `/rooms` once
you are on it.

**3.3 Recents and pins.**
Most staff use four screens. The nav treats all 56 equally.

---

### Phase 4 — The floor

*The largest gap between what the OS assumes and how it is used.*

**4.1 A responsive shell.**
Below `md`, the sidebar becomes an overlay drawer with a persistent bottom bar
carrying the three or four screens that role actually uses. Above `md`, exactly
what exists now. Persist the collapse preference.

**4.2 Phone-first passes on the three floor screens.**
The run sheet, the service board, and the boarding wall are used standing up,
one-handed, sometimes with a cat in the other arm. Touch targets, thumb reach,
and no horizontal scrolling. The boarding wall already scrolls its banks
sideways on narrow screens, which was flagged as unfinished when it shipped.

**4.3 Table discipline.**
18 of 34 table pages can push the body sideways at 375 px. Every wide table
scrolls inside its own container or becomes a card list.

---

### Phase 5 — The polish that reads as quality

Individually small, collectively the difference between "works" and "pleasant".

**5.1 Shape-matched skeletons.** 4 routes of 83 have one; the rest fall back to
a generic list shape. A skeleton that does not match what arrives causes a
visible jolt, which is worse than a plain spinner.

**5.2 Motion with a job.** Transitions that show where a thing came from. Never
decorative. `prefers-reduced-motion` is honoured in exactly 2 rules today.

**5.3 Empty states that teach.** An empty screen is the best available moment to
explain what the screen is for.

**5.4 Focus and keyboard.** One `focus-visible` rule exists in the whole
stylesheet. Every interactive element needs a visible focus ring, and the
common flows need to be completable without a mouse.

**5.5 Consistent destructive-action treatment.** Deletes and reversals should
look and behave the same everywhere.

---

## 5. What I deliberately would not do

Naming these so the review can overrule them rather than discover them later.

- **Not a visual redesign.** The palette, the type and the `.cd-*` system are
  considered and coherent. Changing them is churn that would feel like progress
  without being any.
- **Not a new component library.** shadcn/Radix/MUI would fight the existing
  system and double the vocabulary.
- **Not a restructure of the six segments.** That is the owner's mental model of
  the business, not an arbitrary menu. The palette makes it navigable without
  rearranging it.
- **Not client-side data fetching.** SWR/TanStack Query would fight the
  server-component model that makes this app fast to paint.
- **Not routing reads through Turso's pipeline endpoint.** PERFORMANCE.md
  explains why: reimplementing Prisma's type mapping corrupts money and dates
  silently.
- **Not a rewrite of the nav component.** It works; it needs a breakpoint.

---

## 6. Sequencing

**Revised after the §7 answers.**

| order | phase | felt improvement | risk | size |
|---|---|---|---|---|
| **0** | Landing page → Morning Brief | **very high** | none | **tiny** |
| 1 | Instant feedback + truthful skeletons | **very high** | low | medium |
| 2 | `/actions`, then the dashboard | high | medium | medium |
| 3 | Command palette, with data search | **very high** | low | medium–large |
| 4 | Tablet shell + the six photo screens | high | low | **medium** (was large) |
| 5 | Polish, icons, brand fonts | moderate | low | divisible |

**Phase 0 did not exist before the answers.** One routing change moves the
slowest page in the OS off the first screen anyone sees. It should be done
first, on its own, because it is close to free.

Three things moved:

- **Skeletons moved from Phase 5 into Phase 1**, because answer 6 makes them the
  mechanism rather than the garnish.
- **`/actions` overtook the dashboard** in Phase 2 — it is nearly as slow and is
  Front Desk's home screen rather than a once-a-day view.
- **Phase 4 shrank and rose**, because tablet at 768 px is a much smaller problem
  than phone at 375 px, and the camera work is already done.

Phases 0, 1, 3, 4 and 5 carry no data-integrity risk. Phase 2 changes
revalidation and therefore what a user sees after a write, so every suite
covering a touched route gets re-run.

### 6.1 A caution on Phase 3

Data search is the one item here that can leak. Results must be filtered by
`canAccess` **and** `MANAGER_ONLY_PATHS` on the server, not hidden in the client
— otherwise the palette becomes a way for a groomer to read customer names and
sale totals they cannot open a page for. Grouping results by section (answer 3)
makes this easier to get right, since each group maps to a path whose access is
already decided.

This is the only part of the plan I would want a verify suite written *before*
the feature, rather than alongside it.

---

## 7. Answers received — and what they change

*Answered by the owner, 2026-08-21. Recorded here because several of them change
the plan above, and one of them removes a problem outright.*

| # | question | answer |
|---|---|---|
| 1 | devices on the floor | **Tablets** primarily, desktop for managers, phone occasionally — specifically **for taking photos** |
| 2 | order of use | tablet → phone → desktop; desktop is mainly managers |
| 3 | palette searches data? | **Yes**, and results must be **grouped by which page/section they came from** |
| 4 | landing page | **The Morning Brief** |
| 5 | poor wifi | No — wifi is strong in the shop |
| 6 | is 1.5 s acceptable | **Yes, given a good loading screen** |
| 7 | brand fonts | **Yes — more of them, especially anything customer-facing** |
| 8 | (added) | Free online UI/UX resources, icons etc., are fair game |

### 7.1 Answer 4 removes most of the "slow" problem for free

`/brief` costs **400 ms and 3 queries** — one of the fastest pages in the OS.
Making it the landing page means the 6-second dashboard **stops being the first
thing anyone sees**.

That is worth stating plainly: a preference change achieves more here than the
first round of Phase 2 optimisation would have. The dashboard still deserves
fixing, but it drops from "the first impression of the product" to "a page
visited on purpose", and moves **below** the Action Inbox in priority.

**Phase 2 is re-ordered accordingly: `/actions` first, dashboard second.**

### 7.2 Answers 1 and 2 rescope Phase 4 substantially

The plan above assumed phone-first and a 375 px target. That was wrong.

- **Tablet is the primary staff device.** The breakpoint that matters is
  ~768–1024 px, not 375. At 768 px the current fixed 224 px sidebar leaves
  544 px, which is workable — so Phase 4 becomes *considerably* smaller than
  estimated. The drawer is still wanted, but it is a refinement rather than a
  rescue.
- **Phone matters for one thing: taking photos.** That is not "make every screen
  work on a phone". It is six screens:
  `/runsheet/[id]/checkin`, `/runsheet/[id]/checkout`, `/runsheet/[id]/log`,
  `/cats/[id]`, `/cats/[id]/assess`, `/finance/expenses`.

  Good news: `MediaUpload.tsx` already sets `capture: 'environment'` so the
  camera opens directly, and deliberately does *not* force it for documents so a
  supplier's emailed PDF can still be attached. **The hard part is already
  built.** What remains is making those six screens comfortable one-handed.

**Phase 4 drops from "large" to "medium", and moves up the order.**

### 7.3 Answer 6 shifts the target from speed to composure

"Fine if there is a good loading screen" changes what to optimise for. It makes
**§5.1 (shape-matched skeletons) a Phase 1 concern rather than polish**, because
it is now doing the work that raw speed was going to do.

It also raises the bar on those skeletons: 4 routes of 83 have one today, and a
skeleton that does not match what arrives causes a jolt that is worse than a
plain spinner. A "good loading screen" means *the shape of the thing you are
waiting for*, not a nicer spinner.

The §3 target changes from "every page under 1.5 s" to:

> **Every page shows a truthful skeleton within 200 ms, and no page leaves that
> skeleton on screen for more than ~2 s.** The current dead zone on `/` is
> 108 ms → 3645 ms.

### 7.4 Answer 7 has a bonus consequence worth knowing

The receipt PDF currently uses Helvetica. Embedding Inter and Space Mono is
straightforward (both are SIL Open Font Licence, which permits embedding —
**worth confirming before shipping**, but this is the licence's explicit
purpose).

The bonus: standard PDF fonts are limited to WinAnsi, which is why
`lib/receipt-pdf.ts` currently *strips* characters it cannot encode. That is a
latent problem for a Malaysian business — a customer named 陈美玲 would today
have their name silently dropped from their own receipt. **An embedded Unicode
font fixes that as a side effect**, which upgrades this from a styling change to
a correctness one.

### 7.5 Answer 8 conflicts with a documented convention — proposed resolution

AGENTS.md currently says: *"no emoji in the product UI. The sidebar uses a
hand-built monochrome SVG icon set... Add new icons to that file in the same
style (24×24 viewBox, `strokeWidth={1.7}`, rounded caps/joins) rather than
reaching for an emoji or a new icon library."*

That convention exists for a good reason — mixed icon sets are one of the fastest
ways to make a considered product look assembled from parts. The instruction to
use online resources is the owner's call and I will follow it, but I would
suggest doing it in a way that keeps the reason intact:

1. **Pick one set, not several**, and pick one whose drawing style already
   matches the hand-built icons: 24×24, stroke-based, ~1.5–2 px stroke, rounded
   caps. Lucide is the closest match and is permissively licensed; I would want
   to confirm the licence before committing.
2. **Keep `NavIcons.tsx` as the single import point**, so there is still one
   place that answers "what icons does this product use".
3. **Copy the icons in rather than pulling a runtime dependency**, so the bundle
   carries only what is used.
4. **Emoji stay out of the product UI.** Answer 8 was about icons; I have not
   read it as reversing the emoji rule. Say so if you want that reversed too.

Fonts, icons and illustration sources all need a licence check before shipping,
particularly for anything customer-facing like the receipt.

### 7.6 Still open

- **Question 2 as I meant it** was *which screens* staff use most, not which
  devices. I will infer it from `ROLE_HOME` and each role's granted paths —
  Boarding: run sheet, boarding wall, cats; Groomer: service board, cats; Front
  Desk: Action Inbox, POS, customers, appointments — and design the tablet
  bottom bar around those. Correct me if that ordering is wrong.
- **Questions 8–11 in §9.6** (the spreadsheet strand) are unanswered and still
  matter, particularly who maintains the financial model.

---

## 7b. Original questions, for reference

1. **What do staff actually use on the floor?** Phones, tablets, or a desktop at
   the counter? This decides whether Phase 4 is urgent or cosmetic. I have
   assumed phones matter; if everyone is at a counter, Phase 4 drops down the
   list.
2. **Which screens do staff use most, in order?** Phase 3.3 and Phase 4.1 both
   need this and I should not guess it.
3. **Should the command palette search data, or only pages?** See §3.1 — the
   access-control question is real.
4. **Is the dashboard the right landing page?** It is the slowest page in the OS
   and the first one seen. The Morning Brief might serve the owner better.
5. **Is poor wifi a real condition at the shop?** If so, offline tolerance
   changes several decisions in Phases 1 and 2.
6. **Is 1.5 s the right bar** for a full page render, or does it need to be
   faster? §3 is editable.
7. **Do you want the brand fonts in more places** (the receipt PDF currently uses
   Helvetica), or is the logo carrying the identity enough?

---

## 8. How each phase gets proven

Consistent with the practice in this repo — nothing is "done" because it looks
right.

- `scripts/perf-probe.mjs`, `perf-stream.mjs`, `perf-action.mjs` before and
  after each performance change, with the numbers written into PERFORMANCE.md.
- A new `scripts/verify-ux.mjs` asserting the structural claims that are easy to
  regress: every server-action form ships a pending state; no page scrolls
  sideways at 375 px; every route has a skeleton; the palette respects
  `canAccess`.
- Existing verify suites re-run for anything Phase 2 touches, since changing
  revalidation changes what a user sees after a write.
- The two-run gate (production build + dev build) before anything merges.

---

## 9. Meeting each professional in their own idiom

*Added after review. The principle raised was: each segment is used by a
different professional, so each segment should present the interface that
professional already thinks in — starting with a spreadsheet for the three
statements.*

The principle is right, and the OS is already following it in places without
having said so out loud. The finance answer is more advanced than it looks, and
the generalisation to other segments is real but much narrower than "put a
spreadsheet everywhere".

### 9.1 Finance is already a spreadsheet that does not behave like one

`app/finance/income-statement/StatementTable.tsx` describes itself, in its own
first comment, as an **"Excel-style workpaper"**. What exists today:

- twelve monthly columns per year
- **black = derived from operations, blue = hard-keyed by the accountant** — a
  real bookkeeping convention, already implemented
- an Edit → change → Save cycle on the keyed cells
- custom rows: add, delete, hide, restore, reorder (`StatementRowDef`,
  `StatementRowOrder`, `StatementHiddenRow`, `BalanceSheetCell`)
- an **Actuals vs Plan** view comparing live figures against the owner's model
- a forecast mode which *is* the owner's `CATDAY Income Statement.xlsx`,
  transcribed into `lib/finance-forecast.ts`

So the data model of a spreadsheet is built. What is missing is the *interaction*
of one:

| a spreadsheet has | the statement has |
|---|---|
| arrow-key / Tab / Enter cell navigation | click each input |
| paste a block from Excel | one cell at a time |
| fill down, fill right | retype |
| formulas (`=B4*0.24`) | fixed derivation in TypeScript |
| cell references between rows | none |
| undo / redo | none |
| a real `.xlsx` out and back | none (the model was transcribed by hand) |

**That is the actual gap, and it is an interaction gap, not an architecture
one.**

### 9.2 "Excel integration" is three different things

Worth separating, because only two are compatible with why this OS exists.

**(a) Embedding Microsoft Excel itself** — Office for the web, via Microsoft
Graph. Real Excel, real formulas, total familiarity.

**I would advise against this one**, and not on technical grounds. The workbook
has to live in OneDrive or SharePoint for Office for the web to open it. The
first line of this project's brief is that the owner *never has business data
living outside their own system* — that is the reason the OS exists rather than
being five SaaS subscriptions. Putting the three statements, which are the most
sensitive numbers in the business, into Microsoft's cloud inverts that. It also
adds a per-seat M365 licence and an OAuth dependency to the accountant's ability
to close a month.

**(b) Embedding a spreadsheet component** — a real grid with a formula engine,
running inside the app, data staying in Turso. This gives the feel of Excel
without the data leaving. Several mature options exist in this space (open-source
and commercial, with meaningfully different licence terms). **I have not verified
current licensing and would want to before recommending a specific one** — terms
in this category change, and some are free only for open-source projects, which
this is not.

**(c) Making the existing table behave like a grid, plus a real `.xlsx` round
trip.** Keyboard navigation, paste-from-Excel across a block of cells, fill
down/right, and export to a genuine workbook the accountant can model in, with
an import that brings back only the keyed cells.

**My recommendation is (c) first, then (b) if (c) proves insufficient.** (c) is
perhaps a fifth of the work, carries none of the licence or data-residency
questions, and — the part that matters — it cannot break the boundary described
next. If after using it the accountant still wants live formulas *inside* the
app, (b) becomes a well-informed decision rather than a guess.

### 9.3 The constraint any version of this must respect

This is the part I would most want reviewed, because getting it wrong quietly
destroys the value of the whole finance section.

A spreadsheet is a surface where **any cell can contain anything**. The three
statements are a **view of operational truth**: finance reads operations and
never writes to them, and accounting periods are derived from each record's own
date rather than stored. That is deliberate, it is documented, and it is what
makes the statements trustworthy.

If the accountant gets a free-form grid, three questions arrive immediately:

1. **If a derived cell can be typed over, is it still derived?** Overwrite
   March's revenue by hand and the statement stops being a view of the business
   and becomes a spreadsheet that happens to sit near it — which is the exact
   problem this OS was built to end.
2. **What happens when a sale is corrected afterwards?** The derived cell moves.
   Does the accountant's formula still hold, and does anyone find out?
3. **What does "the March statement" mean if two people have the grid open?**

The existing black/blue convention already answers all three, so the rule is:

> **Derived cells are read-only in the grid. Formulas may reference them; nothing
> may overwrite them. A keyed cell that shadows a derived one keeps showing what
> the OS thinks, the way it does today.**

Any spreadsheet surface that cannot enforce that is the wrong surface.

### 9.4 Where the idiom actually generalises

The principle is "the professional's own idiom", **not** "a spreadsheet
everywhere". Applied honestly, it argues for a grid in three segments and
against one in four.

| segment | the professional | their idiom | verdict |
|---|---|---|---|
| **Finance** | accountant | three-statement workpaper | **Strong.** §9.1. |
| **Inventory** | buyer / stock controller | stock sheet: bulk counts, reorder points | **Strong.** The cat inventory *arrived* as an .xlsx and was imported by a script. Bulk edit and paste would serve it directly. |
| **HR** | manager | roster grid, staff × days | **Good.** A shift roster genuinely is a grid, and building it as anything else is fighting the shape of the problem. |
| Marketing | marketer | campaign calendar, funnel | Moderate — but the idiom is a **calendar**, not a grid. |
| **Boarding** | carer | a wall and a checklist | **No.** The boarding wall already is their idiom. A grid would be worse. |
| **Grooming** | groomer | a job board | **No.** The service board is right. |
| **CRM** | front desk | a contact record, an inbox | **No.** A grid would actively hurt. |

Two things fall out of that table.

First, **the principle is already being honoured where it fits.** The boarding
wall is a picture of the cabinets because that is how a carer thinks; the service
board is a job board because that is how a groomer thinks. Nobody wrote that
principle down, but it is what those screens are.

Second, **one component would serve three segments.** A grid surface with
keyboard navigation, block paste, fill, and `.xlsx` round-trip is not a finance
feature — it is finance, inventory and rostering sharing one thing. That is what
makes it worth building properly rather than as a one-off for the statements.

### 9.5 What I would build, in order

1. **Grid interaction on the existing statement tables** — arrow keys, Tab,
   Enter, block paste from Excel, fill down/right, undo. No new dependency, no
   change to the derived/keyed boundary. This alone would make the section feel
   like the tool an accountant expects.
2. **A real `.xlsx` export** of the statements, formatted, with derived and keyed
   cells visually distinguished as they are on screen. Today the owner's model
   was transcribed into TypeScript **by hand**, which means it can silently drift
   from whatever they are actually using.
3. **Import back**, keyed cells only, with a diff shown before anything is
   written. Never a blind overwrite of a statement.
4. **Reuse the same grid for inventory bulk-edit and the HR roster**, which is
   where the investment pays for itself.
5. **Only then**, if live in-app formulas are still wanted, evaluate embedding a
   spreadsheet engine — with licensing verified, and with §9.3 as the acceptance
   test.

### 9.6 Open questions on this strand

8. **Who actually maintains the financial model** — the owner, an in-house
   bookkeeper, or an external accountant? An external accountant almost certainly
   wants (2) and (3), a real file to work in, more than they want a grid inside
   someone else's app.
9. **Does the model in `lib/finance-forecast.ts` still match the owner's
   spreadsheet?** It was transcribed by hand and is described as "two years old"
   elsewhere in the codebase. If it has drifted, item 2 above is urgent rather
   than nice.
10. **Are live formulas genuinely wanted, or is the need bulk entry?** These look
    similar and are very different amounts of work. Pasting a column of figures
    is (c); `=SUM(B4:M4)*1.06` recalculating live is (b).
11. **Is a per-seat Microsoft 365 licence acceptable at all?** If the answer is
    an easy yes, option (a) is worth re-examining despite §9.2 — but the
    data-residency point stands regardless of cost.

---

## 10. Rough estimate

Phases 1 and 3 together are the sweet spot: they are the two that change how the
OS *feels* rather than what it does, they carry the least risk, and neither
requires a decision from §7 to start.

Phase 2 should follow, because it is the one that makes the numbers honest.

Phase 4 needs question 1 answered first.

Phase 5 is genuinely divisible and can be done a piece at a time forever.
