# Handoff — 2026-08-16

Read [AGENTS.md](../AGENTS.md) first; it is the durable engineering brief. This
file is only what a new session needs that AGENTS.md does not already say:
where things stand right now, and what is still open.

---

## Where things stand

**v1.2.0 is published to production.** `main`, `develop` and the tag `v1.2.0`
all sit on `9025ac6`. Working tree clean.

The production database was migrated **before** the deploy — the order matters,
it had 0 of 14 tables and deploying first would have broken the live business.
It now reports 14/14. Re-check any time, read-only:

```bash
node scripts/migrate-release-1.2.0.mjs --check
```

**Verification: 71 suites pass**, none fail. A complete gate is two runs (see
AGENTS.md) — some suites need a dev build, and two want opposite answers about
whether an AI key is configured. The runner SKIPS with a reason rather than
failing anything it cannot fairly run.

---

## Open, in priority order

### 1. `GOOGLE_FORMS_SECRET` is missing in production — confirmed

Probed directly; it answers `503 {"error":"Webhook not configured"}`. The
endpoint ingests customer PII and is deliberately fail-closed, so the Google
Form intake is simply not accepting anything right now. After setting it and
**redeploying** (Vercel does not hot-reload env into a running deployment):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://catday-crm.vercel.app/api/google-forms
# 401 = set and enforcing · 503 = still missing · writes nothing either way
```

### 2. Confirm `BLOB_READ_WRITE_TOKEN` and `CRON_SECRET` are the RIGHT values

Both exist in Vercel; the owner was unsure they are correct. One request tests
both — same cron gate, no AI tokens spent, and its work is a Blob write:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST https://catday-crm.vercel.app/api/cron/backup \
  -H "Authorization: Bearer <CRON_SECRET>"
```

| response | meaning |
|---|---|
| 401 | `CRON_SECRET` mismatch — wrong value, stray newline from pasting, or scoped to Preview not Production |
| 503 `BLOB_READ_WRITE_TOKEN not set` | cron secret correct; Blob var not visible to Production |
| 500 `Backup failed` | cron secret correct; Blob token present but **invalid** |
| 200 `{"ok":true,…}` | **both correct** (and you get a real backup) |

Free alternative for the cron half: Vercel → Deployments → the production
deployment → **Cron Jobs**, which shows Vercel's own authenticated call and its
status. `daily-brief` and `monthly-report` are new in v1.2.0 and may not have
fired yet; `eod-analysis` and `backup` have history.

The Blob token must be injected by **Storage → Blob → Connect Project**, not
pasted: it is bound to one store, so a hand-copied or stale token looks
plausible and fails on every upload.

### 3. QA regression on v1.2.0

The owner intends to hand this to the QA agent. Point it at the **demo** for
anything that writes — `scripts/_guard.mjs` makes every verify suite refuse to
run against the live database — and at production only for read-only checks.

Two things nobody has done by hand yet, because they need production config:

- upload a real invoice PDF against an expense, then confirm it appears under
  **Finance → Records** filed under that expense's own month
- confirm the Intelligence drop-down's spacing against the segment headers
  (its behaviour is pinned by `verify-intelligence-nav`, its looks are not)

### 4. Two suites skip locally until `.env` grows

`verify-consent` needs `GOOGLE_FORMS_SECRET`; `verify-media-live` needs
`BLOB_READ_WRITE_TOKEN`. Local `.env` has six keys. Neither is a defect.

---

## Traps that cost real time this session

All of these are now documented at the top of the scripts that hit them, but a
new session should know they exist before disbelieving a red result.

**A red verification run usually means the harness, not the app.** Six of the
seven suites fixed at the end of this session were the test being wrong about
the app; only one was a fixture. Check these before concluding a feature broke:

1. **`next start` does not load `.env`** here — its banner has no
   `Environments:` line, unlike `next dev`. A hand-started server inherits
   whatever the shell carried, which once produced a server whose
   `APP_PASSWORD` matched no file on disk. Always start via
   `scripts/start-demo.mjs`, which prints a password fingerprint the runner can
   be compared against.
2. **The dev server uses a throwaway password.** `dev-turso-demo.mjs`
   authenticates with `dev-local`, not the real one. The runner detects this and
   adopts it; a script run by hand against a dev server will not.
3. **A full sweep trips the app's own brute-force protection** — eight failed
   logins in fifteen minutes blocks the IP, after which every later suite
   reports "no auth cookie". In-memory locally, so restarting the server clears
   it. If failures cluster late in the alphabet, suspect this first.
4. **Absolute financial assertions do not survive a shared database.** The demo
   carries real bills, real debtors and ~RM19,800 of stock. Assert **movement**:
   read the figure, remove the seed, read again.
5. **Streamed pages defeat naive matching.** `app/loading.tsx` puts every route
   behind Suspense, so `<main>` holds the skeleton and the real content arrives
   later; and React's SSR splits adjacent text nodes with `<!-- -->` markers, so
   `default cycle 18d` is never literally present. In the RSC payload the number
   is a separate JSON token again.
6. **Every Prisma query is a serialised round trip** — `Promise.all` buys
   nothing, the adapter holds a mutex per statement. See
   [PERFORMANCE.md](PERFORMANCE.md) before adding queries to a hot path.

---

## One thing I got wrong, so it is not repeated

I ran three verification suites against the **live production database** by
exporting a password without the matching `DATABASE_URL` — `.env` holds
production, so the default for a hand-run script was the dangerous one. Nothing
was lost; the cleanup in `finally` ran and I verified production was clean
afterwards. It was luck, not design.

`scripts/_guard.mjs` now makes that impossible: it is imported by all 73 suites
and exits if `DATABASE_URL` names the live database.

---

## Parked / next

- The owner signalled the next topic themselves: **integration work — landing
  page, WhatsApp**.
- **Multi-client feature flags** remain parked. Resume only on the trigger
  phrase *"lets discuss the multiple clients plan"*.
- The demo's AI panels stay in their fail-closed state until a working
  `GROQ_API_KEY` is set on the `bizkit-demo` Vercel project; the current key
  returns 403. Production is unaffected — it runs Anthropic.
