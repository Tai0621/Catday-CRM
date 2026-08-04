# Changelog

All notable changes to the Cat Day Business OS.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning policy — what MAJOR / MINOR / PATCH mean for this product — is in
[docs/VERSIONING.md](docs/VERSIONING.md).

---

## [1.2.0] — Unreleased

The agentic and marketing cycle. Planned scope is in
[docs/AGENTIC-ROADMAP.md](docs/AGENTIC-ROADMAP.md) (Track C — Agentic OS, Track M — Marketing).

### Added
- **C3 — the Action Inbox learns from its own record.** `ActionLog` has been collecting every
  Done/Snoozed/Dismissed outcome since the inbox shipped and nothing read it back. The queue now
  ranks on that evidence: time-decayed acceptance, plus a real conversion join (did a booking or
  payment actually follow the card, inside a per-type window). A new **What's working** panel on
  `/actions` shows each type's conversion rate, acceptance and sample size, and names any type being
  held back. Guardrails: evidence moves a type by at most ±1.5 priority so an unpaid bill can never
  sink below a birthday; types below the minimum sample are left neutral so new ones keep exposure;
  and "Do now" types are never suppressed.
- **C4 — message A/B variants.** Every win-back message the business has sent was the same sentence
  and nobody knew whether it worked. Competing copy can now run per action type
  (`WinBack`, `RebookCheckout`, `GroomingDue`), assigned deterministically by hashing the customer so
  one household never sees three different voices, and scored on the same conversion join C3 uses.
  New **Marketing → Message Variants** page shows each arm's conversion, acceptance and volume, and
  recommends a winner only when both arms have enough *closed* conversion windows and the leader
  beats the runner-up by a clear margin. Promotion stays a manager's click — this is copy a customer
  reads. Ships inert: a type with no variants keeps its built-in message, so nothing changed until
  `scripts/seed-action-variants.mjs` is run.
- **M8 — brand voice profile.** Tone, languages, emoji policy, signature moves and a never-say list
  in Business Settings, rendered into prompts by `lib/brand-voice.ts` and consumed by the AI
  assistant. One profile every future generator (campaign copy, captions, message variants) imports
  instead of inventing its own personality.
- Version control: `CHANGELOG.md`, `docs/VERSIONING.md`, annotated git tags, and the running OS
  version surfaced in Admin → Business Settings.

### Changed
- Action type labels in the inbox now render in sentence case to match the band headings, with
  `VIP` kept upright.
- Demo harness refreshed for this release: `prisma/demo-schema.sql` regenerated from the live schema
  (43 tables), and the seeder now plants Action Inbox outcome history and message variants. The
  outcomes are derived from the seeded appointment history — a converted one sits just before a real
  booking, a missed one inside a genuine booking gap — so the rates the demo displays are computed by
  the same conversion join the live app runs rather than hardcoded.

### Fixed
- `scripts/verify-carelog.mjs` asserted the pre-1.1.0 run-sheet button labels and had been failing
  since they were relabelled.

---

## [1.1.0] — 2026-07-31

Compliance and productization. The first version fit to sell to a second client.

### Added
- **Data protection (Track A)**
  - Customer data export — right of access and portability (`lib/data-export.ts`,
    `GET /api/customers/[id]/export`).
  - Customer erasure — anonymise-then-purge, honouring the 7-year financial retention window so the
    books stay intact (`lib/retention.ts`, `/api/cron/retention`).
  - Consent provenance — `marketingConsentAt` / `marketingConsentSource` on every customer.
  - Public privacy notice at `/privacy`, and a written data map in `docs/PRIVACY.md`.
- **Multi-client provisioning and white-label branding (Track B)**
  - `scripts/provision-client.mjs` and `scripts/seed-baseline.mjs` — a new tenant database is built
    from `prisma/schema.prisma` itself, so the schema stays the single source of truth.
  - Brand configuration (`brand.logoUrl`, `logoDarkUrl`, `primary`, `ink`) driving CSS custom
    properties app-wide, so the OS re-skins per client without a code change.
  - `docs/PROVISIONING.md`.
- Cat photo thumbnails on the cats list, served through the authenticated media proxy.

### Changed
- Run sheet: the daily health log moved below the care checklist and given prominence — it was being
  missed where it sat.
- Run sheet, boarding checklist, and daily log pages: per-task and per-field icons for at-a-glance
  scanning during a round.
- Cat Day cat-face tab icon replacing the framework default.
- Local demo refreshed to cover every module in this release.

### Removed
- Orphaned `Cat.photos` column — cat images live in `MediaAsset` on private Blob storage and load on
  demand, which also removes a large payload from list queries.

---

## [1.0.0] — 2026-07-29

The Cat Day Business OS, operationally complete: a single self-hosted system running the business
across all six segments, replacing the scattered third-party SaaS it would otherwise need.

### Added
- **Operations & Sales** — appointments with two booking lanes and automatic pricing, service board,
  slot engine, room tracker and calendar, guided check-in/out, POS checkout with product catalogue,
  receipts and a deposit money trail, 54 Standard + 7 Suite rooms with multi-cat capacity.
- **Boarding SOPs** — customer health and compliance records, feeding profiles, the three-section run
  sheet, structured daily care logs, and red-flag alerting on concerning entries.
- **Finance** — the full three-statement model: income statement with an Actuals/Forecast toggle and
  accountant-editable cells (black = derived, blue = keyed), balance sheet, cash flow, A/R and A/P
  aging, and a driver-based Financial Plan with scenario analysis.
- **Customers & CRM** — customer intelligence and segmentation, the Action Inbox, Wallet, loyalty
  engine, Cat Day Privé membership, Founding Cats, Private Club, incidents.
- **Human Resource** — staff PIN logins with roles, attendance and clock-in with anti-buddy-punch,
  leave requests and approvals, per-service groomer commission, application forms and candidate
  pipeline.
- **Administrative** — Business Settings (the configuration seam), Fixed Asset Register feeding the
  three statements, Licenses & Renewals feeding the Action Inbox.
- **Media** — private Vercel Blob storage behind an authenticated proxy; grooming before/after
  capture on the assessment screen.
- **AI assistant** — read-only tool-calling assistant answering questions from live CRM data.
- **WhatsApp** — inbound webhook, message analysis into leads, and tokenized public digital receipts.
- **Inventory** — stock ledger with reorder alerts.
- Command-centre dashboard with revenue, mix, and booking-tempo charts.
- Six-segment navigation matching the owner's mental model.

### Security
- Salted scrypt staff PINs and HMAC-signed v3 session tokens.
- Login rate limiting.
- Audit trail.
- Health check endpoint, branded error boundaries, automated database backups on a schedule.
- CI workflow and PII-scrubbed Sentry error monitoring.

### Performance
- Vercel region co-located with Turso in Tokyo — cut dashboard load from ~6s to ~0.5s.
- Slimmed whole-table queries and added indexes on hot paths.
- Instant navigation loading state.

---

[1.2.0]: https://github.com/Tai0621/Catday-CRM/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Tai0621/Catday-CRM/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Tai0621/Catday-CRM/releases/tag/v1.0.0
