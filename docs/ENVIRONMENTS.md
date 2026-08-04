# Environments — production vs demo

## The problem this solves

There is one Vercel project, one branch (`main`), and one Turso database. Every push to `main`
auto-deploys to `catday-crm.vercel.app`, which is the **live OS the business runs on**. Unreleased
work — a half-built report, a schema change mid-migration — appears there the moment it is pushed.

That is fine while the OS has one user who is also the developer. It stops being fine the moment
someone is relying on it, and it is unacceptable once a second client is on it.

## Target shape

| | Production | Demo |
|---|---|---|
| Branch | `main` | `develop` |
| Deploys | tagged releases only | every merge |
| URL | `catday-crm.vercel.app` | see *Naming the demo URL* below |
| Database | production Turso | **separate** Turso database |
| Data | the real business | seeded sample data |
| Crons | backup, retention, EOD analysis | none (Vercel runs crons on production only) |
| Banner | none | permanent `DEMO` bar |
| Indexed by Google | yes | no (`robots: noindex`) |

The app derives which it is from `VERCEL_ENV` (see `lib/environment.ts`) — a new preview branch is
automatically a demo and cannot silently present itself as production.

---

## The one step that must come first

**Before creating the `develop` branch, narrow the existing environment variables to Production
scope.**

If `DATABASE_URL` and `DATABASE_AUTH_TOKEN` are currently set for *All Environments* — which is
Vercel's default and almost certainly the case here — then the very first preview deployment will
connect to the **live business database**. Someone demoing would be editing real customers.

Get the scoping right first. Everything else in this document is reversible; that is not.

---

## Setup

### 1 · Create the demo database

A second Turso database in the same region as production (`aws-ap-northeast-1`, which is why
`vercel.json` pins `hnd1` — see AGENTS.md). Take note of its URL and auth token.

### 2 · Scope the environment variables

In **Vercel → Settings → Environment Variables**:

1. Edit each existing secret so it applies to **Production only**: `DATABASE_URL`,
   `DATABASE_AUTH_TOKEN`, `APP_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`,
   `WHATSAPP_*`, `GOOGLE_FORMS_SECRET`.
2. Add the **Preview**-scoped set:

| Variable | Preview value |
|---|---|
| `APP_ENV` | `demo` |
| `DATABASE_URL` | the demo database |
| `DATABASE_AUTH_TOKEN` | the demo token |
| `APP_PASSWORD` | a *different*, shareable demo password |
| `SESSION_SECRET` | a different secret — a demo session must never be valid in production |
| `ANTHROPIC_API_KEY` | same key is fine; consider a lower `AI_ASSISTANT_MODEL` budget |
| `BLOB_READ_WRITE_TOKEN` | ideally a second Blob store, so demo uploads never land in real media |

`CRON_SECRET` is not needed on preview — Vercel runs cron jobs on production deployments only.

**`SESSION_SECRET` must differ.** The session token is an HMAC over `SESSION_SECRET`
(`lib/auth.ts`); sharing it would make a demo cookie a valid production cookie.

### 3 · Build the demo database schema

Migration scripts read `.env` through `dotenv`, which does **not** override variables already set in
the process. So an inline override wins:

```bash
DATABASE_URL='libsql://<demo>' DATABASE_AUTH_TOKEN='<demo-token>' node scripts/provision-client.mjs
```

Then seed it — `scripts/seed-baseline.mjs` for a bare tenant, or the demo dataset for a populated
one. The same override applies to every future `scripts/migrate-*.mjs`: **run each migration against
demo as well as production**, or the demo drifts and starts failing in ways production does not.

### 4 · Create the branch

Only after steps 1–3:

```bash
git checkout -b develop && git push -u origin develop
```

### 5 · Point a domain at it

**Vercel → Settings → Domains**, add the demo domain and assign it to the `develop` branch.

### 6 · Let people in

Preview deployments are protected by Vercel Authentication by default, which requires a Vercel
account to open. For a demo anyone can be shown, either disable Deployment Protection for preview or
issue a shareable link. **Check this before a demo session, not during one.**

---

## Naming the demo URL

`demo.catday-crm.vercel.app` cannot be created — third-level subdomains under a project's
`vercel.app` name are not user-assignable. The real options:

| Option | URL | Notes |
|---|---|---|
| Second `vercel.app` name | `catday-crm-demo.vercel.app` | Free and immediate, if unclaimed. Recommended for now. |
| Automatic branch URL | `catday-crm-git-develop-<scope>.vercel.app` | Exists already once `develop` is pushed. Stable, but ugly to hand to a client. |
| A real domain | `demo.catday.my` / `app.catday.my` | The right long-term answer, and it also gets production off a `vercel.app` address — which matters once the OS is sold to a second client. |

---

## Daily workflow after this

```
feature work ──► develop ──► demo URL          (show it, break it, iterate)
                    │
                    └─ merge ──► main ──► production   (tagged releases only)
```

- Day-to-day pushes go to `develop`. The client's live OS does not move.
- A release is a deliberate act: merge `develop` into `main`, bump the version, tag, push.
  See [VERSIONING.md](VERSIONING.md) for the release checklist.
- The local default branch is `master` and GitHub's is `main`, so release pushes stay
  `git push origin master:main --follow-tags`. Once `develop` exists it is simpler to rename the
  local branch to match, rather than keep a third name in the mix.

## Verification scripts

`scripts/verify-*.mjs` seed and delete real rows. They default to `VERIFY_BASE=http://localhost:3100`
against whatever `.env` points at — which is **production**. Once the demo database exists, point
local `.env` at demo for routine verification and keep production credentials for deliberate release
checks only.
