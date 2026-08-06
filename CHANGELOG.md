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
- **C1 — copilot dock.** The AI assistant moved from a destination you navigate to into a dock on
  every page, and it knows where you are: suggestions on the run sheet are about tonight's stays,
  suggestions in Finance are about the month's numbers. Scope is advisory — it points the model at
  the likely tools without restricting what can be asked.
  Spend is controlled by a **daily token budget** in Business Settings, checked *before* each call
  and recorded after against real token counts, accumulated across every round of a tool loop.
  **A budget of zero switches the assistant off entirely** — the dock disappears rather than
  offering an input that errors, which is also how a tenant that never wanted AI turns it off
  without a deploy.
  Every customer- and cat-reading tool now filters `erasedAt` at the **query** layer, so Track A's
  erasure guarantee holds inside the assistant too.
- **C5 — nightly analyst brief.** A scheduled job writes one brief per business day, just after local
  midnight: three observations about yesterday and three things to do today, each linking to a real
  page. It appears at the top of the dashboard and is archived under **Morning Brief**.
  **Every number is computed by the OS; the model only reads them.** The facts — revenue by stream,
  visits, no-shows, occupancy, month-to-date pace, receivables, low stock, staff hours, the urgent
  action band — come from the same read-only builders the pages use, and the whole snapshot is stored
  alongside the narration, so a brief read three weeks later can still be checked against what it was
  written from.
  Revenue is compared against the **same weekday over the previous four weeks**, not against the day
  before or a flat monthly mean — a Saturday measured against a Tuesday makes every weekend look like
  a triumph.
  New `lib/timezone.ts` gives the rest of the OS tenant-local calendar days. The job fires at 16:30
  UTC, which is 00:30 in Kuala Lumpur, so UTC date arithmetic would have pushed the first eight hours
  of each trading day into the previous one and quietly mis-stated every figure in the brief.
  Costs about one Haiku call a day, is idempotent by date so a cron retry never pays twice, and fails
  closed: no API key means no brief rather than a faked one, and a token budget of zero switches it
  off with the rest of the AI. Budget *exhaustion* does not stop it — the ceiling exists to cap
  unbounded interactive use, and losing the morning brief because someone asked the assistant twenty
  questions would make the most valuable output the least reliable.
  `?dryRun=1` returns the facts tonight's brief would be built from without writing or spending
  anything, which is how a figure that looks wrong gets checked.
- **C2 — write tools behind a confirm gate.** The assistant stops answering and starts doing, but
  never unattended. Five drafts are now possible — a WhatsApp message, a booking, a daily care log,
  a reorder threshold, an expense — and each one **writes nothing**. It parks a proposal; a human
  reads the real content on a card and presses Confirm; only then does the write happen, and it goes
  through the *same server action the manual form submits to*, so validation cannot drift between
  the two callers. The manual paths for expense, reorder, care log and outreach were extracted into
  file-level actions to make that literally true rather than approximately true.
  Proposals are stored server-side, not round-tripped through the browser: that makes Confirm
  single-use (a double click cannot book twice), makes the `AuditLog` row record what the model
  actually proposed, and leaves a record of what was *declined* — the more interesting half, since a
  draft nobody ever confirms is a tool that should not exist. They expire after 30 minutes, because
  "book her in for tomorrow at 2" is wrong on Thursday.
  The model works in **names, never ids**: an ambiguous "Luna" is a refusal, not a coin flip.
  M10's floors hold on the new surface — a drafted message goes through the same consent check and
  the same global frequency cap as the group worklist, and is logged as the same `GroupSend` row.
  Every copilot-drafted customer message is treated as marketing even when it reads as operational,
  because the alternative is letting the sender classify its own intent.
  **Permanently human-only:** POS checkout, transaction delete or edit, loyalty points, wallet
  balance, payroll, commission, statement cells, customer erasure. Not a phase-two list — there is
  no tool for any of them, and the verification script asserts there is none.
- **M4 — review engine.** A sentiment-gated request under **Marketing → Reviews**: a public
  token-linked page asks how the visit went *before* showing anything, then routes a happy customer
  to the public review link and an unhappy one into an `Incident` raised in the same transaction, so
  a complaint becomes something the team can fix rather than a one-star review nobody can. Funnel
  reporting covers asked → answered → positive → clicked through. This does not suppress negative
  reviews — anyone can still review publicly at any time; it stops the business *soliciting* one from
  a customer it has just let down.
- **M5 — referral engine.** Referral codes, link tracking, and wallet credit for both sides under
  **Marketing → Referrals**, payable only once the referred customer's first visit is genuinely
  complete. Credit follows data-integrity rule 2 exactly — ledger entry and cached balance move in
  one `db.$transaction` with the referral's own status — and is deliberately **not** wired into POS
  checkout, since rule 3 would then require unpicking two customers' ledgers on every corrected sale.
  Guards against self-referral, double-referral and circular pairs.
- **M10 — customer groups & targeted marketing.** Six live audiences under
  **Marketing → Customer Groups** (at-risk, lapsed 90+, gold-eligible, new this month, long-coat
  overdue, boarding-only), each re-evaluated on open rather than stored as a list, with a send
  worklist that renders the message per recipient and logs each confirmed send.
  Three guardrails are enforced in code, not by convention: **consent is a floor** — `evaluateGroup()`
  counts everyone for analysis, `sendableMembers()` is the only path to outreach and always requires
  consent and non-erasure; a **global frequency cap** (14 days) applied across all groups, because a
  per-campaign limit cannot see the other campaigns; and **health data is not targetable** — cat
  health notes, medication and treatment state are absent from the rule vocabulary and never read.
  Sending is an assisted worklist, not a bulk blast: the WhatsApp integration is inbound-only, and
  outbound at scale needs approved templates and throttling.
- **M2 — marketing attribution.** C3 answered "did a booking follow this nudge?"; this answers "how
  much was it worth?". The Action Inbox and the message variants now read as a marketing P&L —
  attributed revenue per action type, and revenue per message sent per variant, which is the number
  that actually decides between two arms (a variant can convert more often and still be worth less
  per send). Cost per message is configurable in Business Settings.
  Attribution is **last-touch**: when several nudges precede one sale, only the most recent one
  inside its window is credited, so a single RM 200 groom can never appear as RM 600 of marketing
  revenue. It is also **attributed, not incremental** — a customer who would have booked anyway
  still counts — and the UI says so, because measuring incrementality needs a holdout group.
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

- **Tenant registry and migration fan-out.** `clients.json` (gitignored) plus
  `npm run migrate:all` apply a migration across every tenant database. Tenants share a deploy but
  not a database, so pushing before every tenant is migrated would break all of them at once. Runs
  sequentially and stops at the first failure.
- **Environment awareness.** `lib/environment.ts` derives production / demo / local from `VERCEL_ENV`,
  so a preview branch is a demo automatically and cannot present itself as production. Non-production
  deployments carry a standing `DEMO` banner and are `noindex`; production renders exactly as before.
  Groundwork for splitting the live OS from a demo deployment — see
  [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md).

### Changed
- **Skeleton loading screens** replace the centred spinner. Placeholders mirror the shape of the
  page being fetched — card grid for cats, banded queues for the Action Inbox, table rows elsewhere —
  so the layout no longer jumps when content lands. Shimmer degrades to a still placeholder under
  `prefers-reduced-motion`, and the old spinner's hardcoded business name is gone (it would have
  shown the first client's brand to every other tenant).
- Action type labels in the inbox now render in sentence case to match the band headings, with
  `VIP` kept upright.
- Roadmap extended with **C9** (monthly per-department reports, facts computed by the existing
  statement builders and only narrated by the model) and **M10** (customer groups and targeted
  marketing, sequenced ahead of M1).
- Demo harness refreshed for this release: `prisma/demo-schema.sql` regenerated from the live schema
  (43 tables), and the seeder now plants Action Inbox outcome history and message variants. The
  outcomes are derived from the seeded appointment history — a converted one sits just before a real
  booking, a missed one inside a genuine booking gap — so the rates the demo displays are computed by
  the same conversion join the live app runs rather than hardcoded.

### Fixed
- **White-label leak**: `lib/version.ts` hardcoded `'Cat Day OS'`, so a second client would have been
  told they were running the first client's system. Product identity (`Bizkit`) and tenant identity
  (`config.business.name`) are now separate.
- The demo now seeds a **fictional** business (Velvet Paw) rather than a live client's branding —
  showing a real client's business shape to prospects is a confidentiality problem, not a tidiness
  one.
- `scripts/verify-actions-learning.mjs` asserted a literal `n=10`, which only held against an empty
  database. It now measures a before/after delta, so it is valid against demo and production alike.
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
