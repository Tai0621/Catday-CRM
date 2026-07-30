# Provisioning a new client instance

The OS is **single-tenant**: every client gets their own isolated deployment —
their own database, their own Blob store, their own credentials, their own
branding. Nothing is shared between clients. This is the runbook for standing one
up.

The repeatable, scriptable part (schema + baseline catalog) is automated by
`scripts/provision-client.mjs`. The account-level steps (creating the database and
the Vercel project) are done by you, once per client.

---

## 1. Create the client's database (Turso)

```bash
turso db create <client-slug>            # e.g. acme-cats
turso db show <client-slug> --url        # → DATABASE_URL (libsql://…)
turso db tokens create <client-slug>     # → DATABASE_AUTH_TOKEN
```

Keep the DB in a region close to the client; the app's Vercel region should match
(Cat Day uses `hnd1` for a Tokyo Turso — see AGENTS.md).

## 2. Provision the schema + baseline catalog

From a checkout of this repo:

```bash
PROVISION_DATABASE_URL="libsql://<client-slug>-…turso.io" \
PROVISION_DATABASE_AUTH_TOKEN="<token from step 1>" \
CLIENT_NAME="Acme Cats" \
node scripts/provision-client.mjs
```

This generates the full schema DDL from `prisma/schema.prisma` (the single source
of truth — no hand-maintained init script), applies it to the new database, seeds
the neutral baseline (membership tiers, a starter service menu, two rooms), and —
if `CLIENT_NAME` is set — writes the business name. It's idempotent, so re-running
after a schema change tops up any missing tables without touching existing data.

> It refuses to run if `PROVISION_DATABASE_URL` equals this app's own
> `DATABASE_URL`, so you can't clobber an existing instance by mistake.

## 3. Create the Vercel project

- New Vercel project pointing at this repo, region set to match the DB.
- Set the environment variables (mirror `.env.example`):

  | Variable | Notes |
  |---|---|
  | `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | the client DB from step 1 |
  | `APP_PASSWORD` | the owner's manager password |
  | `SESSION_SECRET` | random 32+ byte secret (rotating it logs everyone out) |
  | `CRON_SECRET` | random secret; required for the scheduled crons |
  | `ANTHROPIC_API_KEY`, `AI_ASSISTANT_MODEL`, `WHATSAPP_ANALYSIS_MODEL` | AI features |
  | `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp webhook (optional) |
  | `GOOGLE_FORMS_SECRET` | intake webhook (optional) |
  | `BLOB_READ_WRITE_TOKEN` | Vercel Blob store for photos/receipts |

  Generate secrets with e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  Never reuse one secret's value for another.

## 4. Brand it

Log in as manager → **Admin → Settings**. Everything customer-visible flows through
these values (the "productization seam" in `lib/config.ts`), so nothing here needs
a code change:

- **Business Identity** — name, tagline, legal name, registration no., contact.
- **Branding** — logo (light + dark sidebar), accent colour, text colour.
  Logos accept a URL or a `/public` path. The accent/text colours re-theme the
  buttons, links, inputs and login screen via CSS variables. (Deeper palette
  customisation beyond the accent is a code-level change to the `SEGMENTS` and the
  per-page styles — the seam themes the primary brand surfaces.)
- **Localization** — currency code/symbol/locale, timezone.
- **Tax** — regime + corporate rate.
- **Data & Privacy** — financial-record retention window (drives erasure purge).

## 5. Staff & go-live

- Add staff accounts + PINs (**Human Resource → Staff**).
- Adjust the service menu, membership tiers and rooms seeded in step 2.
- Fill in the data-controller contact in the public privacy notice context
  (`docs/PRIVACY.md` §6).
- Hand over the manager password.

---

## What "white-label" covers today

- ✅ Business identity, contact, legal details — everywhere, via config.
- ✅ Logo (login + sidebar) — config-driven URL/path.
- ✅ Accent + text colour — config-driven CSS variables across buttons, links,
  inputs, login.
- ✅ Currency, locale, timezone, tax regime — via config + `fmtMoney`/`fmtDate`.
- ✅ AI assistant + customer-facing WhatsApp templates — use the configured name.
- ⏳ Full palette theming (segment colours + every inline-styled page) remains
  Cat Day's default palette; re-skinning beyond the accent is a code change.
  This is the deliberate boundary of the current seam.
