# Environments — product, tenants, demo

## Product vs tenant

**Bizkit** is the product: one codebase, one version line, one release process.
**Cat Day** is a tenant: one deployment, one database, its own branding.

The rule: a tenant's staff never see the word "Bizkit" except where we choose to put it. Everything
staff-facing reads from `config.business.name` (Track B). The product name appears only in the
version stamp on Admin → Business Settings, which is what a support conversation starts from.

`lib/version.ts` exports `PRODUCT_NAME` and `PRODUCT_RELEASE` for that stamp. It previously
hardcoded `'Cat Day OS'`, which would have told the second client they were running the first
client's system.

## Topology

One Vercel project per tenant, all deploying from this one repo:

```
bizkit-demo     →  develop  →  demo.bizkit.<tld>      →  demo database
bizkit-catday   →  main     →  catday.bizkit.<tld>    →  Cat Day's database
bizkit-<next>   →  main     →  <next>.bizkit.<tld>    →  their database
```

Each project holds its own `DATABASE_URL`, `APP_PASSWORD` and `SESSION_SECRET`, so isolation is
enforced at the Vercel project boundary and a config mistake on one tenant cannot reach another.

**Do not collapse this into one hostname-routed multi-tenant app.** The code is single-tenant on
purpose (see the comment in `lib/config.ts`), auth is one `APP_PASSWORD` per deployment, and "your
business data never lives outside your own system" is the product's actual selling point. Routing
tenants by hostname would trade that for hosting convenience.

Tenants start on a `*.bizkit.<tld>` subdomain, which costs nothing and can be provisioned instantly.
A tenant who wants their own domain (`app.catday.my`) adds a CNAME — a five-minute change, not a
blocker.

## Migration fan-out — the part that breaks everything if skipped

Deploys are **shared**: every tenant project builds from `main`, so one push updates them all at
once. Databases are **not** shared: each tenant needs the schema change applied individually.

Deploy before migrating and every tenant breaks simultaneously.

`clients.json` (gitignored — it holds every tenant's database token; see `clients.example.json`) is
the registry. `scripts/migrate-all.mjs` fans a migration out across it:

```bash
npm run migrate:all -- --list                                 # show the registry
npm run migrate:all -- scripts/migrate-<feature>.mjs          # every tenant
npm run migrate:all -- scripts/migrate-<feature>.mjs --only=demo
```

It spawns the ordinary migration scripts unchanged with the tenant's credentials injected — dotenv
does not override variables already in the environment, so the injection wins over `.env`. It runs
sequentially and **stops at the first failure**, so a partial rollout ends at a known tenant rather
than in several places at once.

**The release order is: migrate every tenant → verify → then push.** Never the reverse.

---

## Production vs demo

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
