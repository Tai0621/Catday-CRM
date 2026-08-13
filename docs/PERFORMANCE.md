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

Result on the dashboard — the body a person reads:

```
                     before    after
revenue + panels     5184ms   3170ms
action queue         5183ms   5703ms   (arrives after, instead of blocking)
```

## If more is needed

In rough order of payoff, none of it done yet:

- `buildActionQueue` loads **every customer** with their full appointment
  history, a year of transactions, their memberships and their cats — five round
  trips and a payload that grows with the business. It is the largest single
  cost left on the dashboard.
- The `Appointment` table is read five separate times per dashboard render in
  five different shapes. One read plus in-memory derivation would collapse most
  of them.
- `/finance/income-statement` is the opposite shape: 11 queries, ~725 ms each.
  That one is index and aggregate work, not round trips.
- Server actions could return only what changed instead of revalidating the
  whole route.
