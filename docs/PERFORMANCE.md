# Why a page is slow, and what actually helps

Measured 2026-08-13 against the demo database, from a laptop in Malaysia
(~95 ms to Turso in `aws-ap-northeast-1`). The absolute numbers below are that
laptop's; on Vercel `hnd1` the round trip is a fraction of it. The *ratios* are
what transfer.

## The one fact everything follows from

**Every Prisma query is a separate, serialised round trip. `Promise.all` buys
nothing.**

```
single query          251ms
20 sequential        1907ms  (95ms each)
20 via Promise.all   2365ms  (118ms each)   ← slower, not faster
```

`@prisma/adapter-libsql` takes a mutex around every statement (`performIO`), so
concurrency at the call site is decorative. A page's cost is therefore close to
**query count × round trip**, and the count is the only lever that moves it.

`scripts/perf-rtt.mjs` re-runs that comparison.

### What does not work

- `Promise.all` — measured above.
- `db.$transaction([...])` as a batch — 1948 ms for the same 20 reads.
- Batching underneath the adapter — the mutex is above the libsql client, so a
  batching proxy on `client.execute` never sees two calls at once.
- Prisma's `log: ['query']` — with a driver adapter the query event never
  fires. It reports **nothing**, which reads as "no queries" rather than as a
  broken switch. This cost real time; hence `DB_TRACE` below.

The one thing that *is* dramatically faster is Turso's own pipeline endpoint —
20 statements in a single HTTP request took **109 ms** versus ~1900 ms through
Prisma. That is what `scripts/migrate-*.mjs` and `scripts/verify-*.mjs` already
speak. Routing app reads through it would mean reimplementing Prisma's column
type mapping by hand, and getting that wrong corrupts money and dates silently,
so it is deliberately **not** done. Noted here so the next person can stop
re-deriving it.

## Measuring

```bash
source .env.demo.sh && DB_TRACE=1 npx next start -p 3100 > .tmp-perf.log &
source .env.demo.sh && node scripts/perf-probe.mjs           # every page
source .env.demo.sh && PERF_ONLY=/ node scripts/perf-probe.mjs  # one page, per table
source .env.demo.sh && node scripts/perf-action.mjs          # what a button costs
source .env.demo.sh && node scripts/perf-stream.mjs          # when each part arrives
```

`DB_TRACE=1` prints every round trip and its duration. It is off by default and
costs nothing when unset.

**`perf-probe.mjs` needs `dotenv`** — `APP_PASSWORD` lives in `.env` and the
server reads it the same way. A probe without it logs in with an empty password,
gets a 307 to `/login` on every page, and reports one query per page: a broken
probe that looks like a beautifully optimised app.

## Where the time went (2026-08-13)

| page | queries | note |
|---|---|---|
| `/` | **78** | the outlier by 6× |
| `/runsheet` | 12 | |
| `/finance/income-statement` | 11 | few queries, but each is a heavy aggregate |
| median page | 6 | |

A **button** is worse than it looks. Ticking one care task cost 14 queries: two
to save it, twelve to redraw the page around it, because `revalidatePath`
re-renders the whole route.

The dashboard's 78 were not N+1 loops. They were (a) two aggregators —
`getDashboardData()` and `buildActionQueue()` — independently asking for the
same cats, appointments, check-outs, unpaid visits and expiring memberships, and
(b) Prisma issuing one statement per `include` level, so a `findMany` with three
relations is four round trips.

## What was changed

1. **`lib/shared-reads.ts`** — the five reads both aggregators wanted, once,
   behind React `cache`. 78 → 61 queries. Nothing there takes a `Date`: `cache`
   keys on argument identity, and two callers each doing `new Date()` miss the
   cache silently while looking exactly like a fix.
2. **The action queue streams** (`<Suspense>` around `TodaysActions`). It derives
   the entire Action Inbox to show five rows, and nothing else on the page waits
   on it. The rest of the dashboard now paints without it.
3. **Buttons acknowledge the click** (`app/components/Pending.tsx`). This makes
   nothing faster; it removes the dead air, and stops the second press that on
   the service board really did advance an appointment twice.
4. **The action queue stopped loading customer history to count it.** It read
   every customer *with* every appointment they had ever had and a year of
   transactions, then counted the rows in JavaScript. Four facts were wanted —
   last visit, whether anything is booked ahead, how many visits, twelve-month
   spend — and every one is an aggregate. On the demo that is **1,930 rows → 66**;
   the point is the shape, since the old cost grew with the length of the
   business's history and the new one grows with the number of customers.
   Summed database time for the dashboard fell 39% (94.1s → 57.7s across its
   queries). Query *count* is unchanged: three relation loads became three
   aggregates. `scripts/verify-action-facts.mjs` pins the four boundaries,
   because an aggregate that is off by one sends a real message to a real
   customer — a win-back to someone booked in for next week, a Gold invite from
   spend that aged out — and nothing else in the system would notice.

Result on the dashboard — the body a person reads:

```
                     before    after
revenue + panels     5184ms   3170ms
action queue         5183ms   5703ms   (arrives after, instead of blocking)
```

## If more is needed

In rough order of payoff, none of it done yet:

- The `Appointment` table is read five separate times per dashboard render in
  five different shapes. One read plus in-memory derivation would collapse most
  of them.
- `/finance/income-statement` is the opposite shape: 11 queries, ~725 ms each.
  That one is index and aggregate work, not round trips.
- Server actions could return only what changed instead of revalidating the
  whole route.

## Round 2 (2026-08-21) — the relation fan-out

Same laptop, same demo database, so these are comparable with the numbers above.

### What was found

The first round deduped the reads the dashboard's two aggregators shared. It did
not touch the thing underneath: **Prisma issues one statement per relation**, so

```ts
include: { customer: { include: { memberships: { include: { tier } } } },
           cat: true, room: true }
```

is not one query, it is six. Five aggregates each carrying their own `include`
is how a page reads `Customer` five times.

A probe of the role landing pages also found a second slow page that the first
round missed, because the earlier probe did not cover it:

| page | before | who lands here |
|---|---|---|
| `/` | 5952 ms / 63 q | the owner, once a day |
| **`/actions`** | **5211 ms / 47 q** | **Front Desk, every sign-in** |

`/actions` is the worse of the two in practice.

### What changed

`lib/shared-reads.ts` now reads each entity table **once** into a `Map` and
stitches the relations in memory. The returned shapes are identical to what the
`include`s produced, so no caller changed.

```
                  before          after
/                 5952ms / 63q    4632ms / 54q     -22%
/actions          5211ms / 47q    3297ms / 38q     -37%
/actions summed   46.3s           21.0s            -55%

dashboard stream  shell    108ms      102ms
                  content 3645ms     2646ms
                  complete 6277ms    5310ms
```

Per table on `/actions`: Customer 5→2, Cat 5→3, Membership 2→1, Tier 2→1.

`must()` guards each stitch. `Appointment.customerId` and `.catId` are NOT NULL
foreign keys and the indexes are unfiltered whole-table reads, so a miss is a
dangling foreign key rather than a "maybe" — it throws with the offending id
instead of rendering a card that says `undefined`.

### What was NOT done, and why

**The seven remaining `Appointment` reads are close to optimal.** They are seven
genuinely different filters and aggregates (today, check-outs today, unpaid,
whole-table visit history, `_max` last visit, `_count` visits, future bookings).
Collapsing them into one read means loading every appointment row with every
column and deriving in memory — which trades away the scaling property the first
round deliberately bought (cost growing with customer count, not with the length
of the business's history). Not worth ~300 ms.

**`revalidateTag` does not apply here.** Ticking a checkbox still costs 14
queries: 2 to write and 12 to redraw. Those twelve are not a stale cache being
refilled — they are the route rendering again, because these pages read the
database directly rather than through a cache that could carry a tag. There is
nothing to invalidate more narrowly. Making that button cheaper means making
`/runsheet` cheaper, which is the same work as above, not a revalidation change.

### Still open

- The dashboard's dead zone is 102 ms → 2646 ms. Each panel needs its own
  Suspense boundary and its own read; today they all wait on one
  `getDashboardData()`.
- `/finance/income-statement` remains index and aggregate work, not round trips.
