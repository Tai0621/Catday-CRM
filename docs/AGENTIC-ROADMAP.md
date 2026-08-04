# Track C — The Agentic OS

Competitive research on **Amboras** (YC S26, `amboras.com`) and a concrete plan for which of its
ideas belong in this OS.

---

## Part 1 — What Amboras actually is

Amboras is **not** a pet-care or CRM product. It is an *AI-native e-commerce platform* — a Shopify
replacement — founded 2025 in San Francisco by Imad and Amin Mokadem (both ETH Zurich), team of 3,
YC Spring 2026 batch. Prior track record: a board-game business scaled to ~$200K/month, and
EcomCoder (a Shopify dev tool, ~1,000 users).

Positioning: *"the store builder that runs itself" / "e-commerce, version two."*

So there is **no feature-for-feature comparison to make**. What is worth stealing is its
**operating model**, not its feature list. That model has four pillars:

### Pillar 1 — AI is the interface, not a page

> "Every page of the admin panel has a dedicated AI assistant. On the Orders page, the AI
> specializes in order management. On the Products page, it's ready to write copy and generate
> images. You can type or speak your instructions and the AI executes them directly."

The key phrase is **executes them directly**. This is an agent that takes action, not a chatbot that
answers questions. Legacy platforms bolt AI on as a plugin; Amboras makes it the primary control
surface — you describe an outcome instead of navigating menus.

Also notable: **parallel onboarding agents** — brand naming, product creation, and promotion setup
run concurrently rather than as a wizard.

### Pillar 2 — A closed self-improving loop

The system continuously:
1. reads first-party analytics (sessions, funnels, revenue — no third-party pixels),
2. generates variants of hero sections, offers, layouts, copy, pricing, bundles,
3. ships them as live A/B tests,
4. **promotes the winners automatically**, and
5. feeds the outcome back into its model of the ideal customer.

Their framing of the problem is the sharpest part: static storefronts that never adapt, A/B testing
that takes weeks of designer + developer time, and a "plugin and agency tax" for CRO.

Claimed result: **"over 80% CVR lift on the first version Amboras puts live."** Treat this as
unverified vendor marketing — it is a beta-cohort self-report with no methodology, no baseline
definition, and no sample size.

### Pillar 3 — Generative cold start

One sentence in → live storefront in under two minutes. The AI proposes a brand name, generates
products with 150–200 word descriptions, variant configurations and pricing, builds the checkout,
and enhances uploaded product photos into studio packshots. Free migration from Shopify/Woo/
BigCommerce in ~48h including 301 redirects.

Zero-to-running is treated as an AI problem, not a setup wizard problem.

### Pillar 4 — Consolidation ("no plugin tax")

Storefront, backend (products/inventory/orders/returns/promotions), payments (125+ methods),
transactional + marketing email from the merchant's own domain, domains/SSL/CDN, reviews, SEO —
all first-party. Pricing $39 → $105 → $399/mo → custom, metered by **stores and seats**, no
transaction fee, 30-day "no sales = full refund" guarantee. Higher tiers unlock autonomous A/B
testing, white-label, and brand-voice fine-tuning.

### Where Amboras is weak

- ~1 year old, minimal third-party validation, thin documentation.
- Autonomy is safe *because the blast radius is cosmetic* — a bad hero variant costs conversions for
  a day. Nothing in their loop can corrupt a ledger.
- Vendor-hosted. The customer's data lives on Amboras infrastructure.

---

## Part 2 — What transfers, and what must not

Our OS is a **capacity-constrained service business** OS, self-hosted, with double-entry finance,
loyalty/wallet ledgers, and PDPA obligations (Track A). Three consequences:

**The objective function is different.** Amboras optimizes conversion rate. We cannot sell more
grooming slots than we have groomer-hours, or more boarding nights than we have rooms. Our
equivalent target is **occupancy × margin per available hour**, plus retention (rebooking rate,
churn). Copying "optimize CVR" literally would be optimizing the wrong number.

**Full autonomy is off the table for anything that moves money or touches a customer.** Data-
integrity rules 2 and 3 in `AGENTS.md` exist because unreversed side effects erode trust in the
numbers. An agent must never call `checkout()`, `deleteTransaction()`, `awardPoints()`, wallet
mutations, or payroll. The correct pattern is **propose → human confirms → existing server action
executes → audit row written**.

**PDPA constraint.** Any AI tool that reads customer data must exclude `Customer.erasedAt != null`
records, or Track A's erasure guarantee leaks through the assistant.

| Amboras pillar | Our translation | Verdict |
|---|---|---|
| AI assistant on every admin page | Page-scoped copilot dock across the OS | **Adopt** |
| Agent takes action directly | Agent *proposes*, human confirms, audited | **Adopt, modified** |
| Generative A/B testing of storefront copy | A/B testing of WhatsApp win-back / rebook copy | **Adopt** |
| Auto-promote winning variant | Auto-rerank Action Inbox by observed outcome | **Adopt** |
| Autonomous analytics reading | Nightly written brief for the owner | **Adopt** |
| One-sentence store generation | One-paragraph *business* generation for new clients | **Adopt — biggest resale lever** |
| AI image enhancement | Cat photo cleanup for before/after grooming shots | **Nice-to-have** |
| First-party analytics, you own the data | Already our entire thesis — self-hosted, single-tenant | **Already ahead** |
| Autonomous execution on money | — | **Reject** |
| Optimize for CVR | Optimize occupancy × margin/hour + retention | **Reject as stated** |

---

## Part 3 — The plan

Eight items, ordered by value-per-unit-risk. C3 and C4 are the highest-leverage and need almost no
new AI spend.

### C1 · Copilot dock — AI on every page

**Today.** `app/ask/` is one destination page. `lib/ai/ask.ts` exposes 8 read-only tools
(`inactive_customers`, `cats_with_health_note`, `revenue_by_stream`, `search_customer`,
`cat_history`, `top_customers`, `membership_summary`, `occupancy_today`), 5 tool rounds, Haiku.
You must leave what you are doing and go ask.

**Build.** A persistent `<Copilot />` dock in `app/layout.tsx` (client component, collapsed by
default) that posts the current route and entity id to `/api/ask`. The system prompt gains page
scope — on `/runsheet` the copilot knows it is the boarding-round assistant; on `/finance/*` it is
the accounts assistant; on `/customers/[id]` it already has that customer in context and shouldn't
need `search_customer`.

**Notes.** Reuse `askCatday()`, don't fork it — add a `context` parameter. Add the `erasedAt` filter
to every tool that reads `Customer`. Add `ai.dailyTokenBudget` and `ai.enabled` to `SETTING_FIELDS`
in `lib/config.ts` so a client can cap or kill spend.

**Verify.** `scripts/verify-copilot.mjs` — drive `/api/ask` with a page context, assert the answer
cites live seeded data, assert an erased customer never appears in a response.

---

### C2 · Write tools behind a confirm gate

**The leap Amboras made:** the assistant stops answering and starts doing. **The leap we cannot
make:** doing it unattended.

**Build.** A two-phase tool protocol. Mutating tools return a typed `Proposal`, never a write:

```ts
type Proposal =
  | { kind: 'whatsapp';    customerId: string; body: string }
  | { kind: 'appointment'; catId: string; type: string; scheduledAt: string; roomId?: string }
  | { kind: 'careNote';    appointmentId: string; period: 'AM' | 'PM'; fields: Record<string,string> }
  | { kind: 'reorder';     productId: string; reorderLevel: number }
  | { kind: 'expense';     category: string; amount: number; note: string }
```

The copilot renders each proposal as a preview card with a **Confirm** button. Confirm calls the
*existing* server action — the same code path the manual UI uses, with the same validation. On
execution, write an `AuditLog` row carrying the prompt, tool, and arguments.

**Allowed:** draft WhatsApp message, draft appointment, draft care-log entry, adjust reorder level,
draft expense.
**Forbidden, permanently:** POS checkout, transaction delete/edit, loyalty points, wallet balance,
payroll, commission, statement cells, customer erasure. These stay human-only.

**Verify.** `scripts/verify-copilot-write.mjs` — assert a proposal alone changes nothing in the DB;
assert confirm produces exactly the same row shape as the manual path; assert an `AuditLog` row
exists; assert a forbidden tool is not reachable.

---

### C3 · Learn from the Action Inbox ← **start here**

**We are already collecting the training data and throwing it away.** Every Action Inbox card logs
`ActionLog { actionKey, type, customerId, status: Done|Snoozed|Dismissed, createdAt }`. That is a
labelled dataset of *which suggestions staff actually act on* — and the queue currently ignores it
entirely, ranking by a hardcoded `priority: 1..9` in `lib/actions.ts`.

This is Amboras's "promote the winner", retargeted from hero images to staff suggestions. It needs
**zero AI spend**.

**Build** `lib/actions-learning.ts`:
- **Acceptance rate** per action type = `Done / (Done + Snoozed + Dismissed)`.
- **True conversion** per type — join `ActionLog` → `Appointment`/`Transaction` on `customerId`
  within an outcome window (21d for `WinBack`/`GroomingDue`, 7d for `RebookCheckout`, 14d for
  `MembershipExpiry`). Did the nudge actually produce a booking?
- **Re-rank** the queue by observed conversion instead of the static priority, with a floor so a new
  action type still gets exposure (never let a type reach zero impressions — that's how a bandit
  starves itself).
- **Auto-suppress** types below an acceptance threshold after a minimum sample, surfaced as a
  dismissible note rather than a silent disappearance.
- **"What's working" panel** on `/actions`: *WinBack 22% · Birthday 4% · VaccinationExpiry 61%*.

**Schema.** Add `@@index([type, createdAt])` on `ActionLog` (migration script per the Turso
pattern). No new columns needed for C3.

**Verify.** `scripts/verify-actions-learning.mjs` — seed a history where one type converts and
another never does; assert ranking order flips; assert the low performer is suppressed only after
the minimum sample; clean up.

---

### C4 · Generative message A/B testing

**Today.** `ActionCard.waMessage` is one hardcoded template per action type. Every win-back message
Cat Day has ever sent is the same sentence, and nobody knows whether it works.

**Build.** 2–3 copy variants per action type. Assign deterministically by hashing `customerId` (so
the same customer always sees the same voice — no whiplash). Record the variant on the `ActionLog`
row. Measure with C3's conversion join. Promote the winner into the default once a variant clears a
significance bar; keep a challenger slot open so the loop never closes.

Variants can be AI-generated (one Haiku call, manager reviews before the variant goes live — the
"first draft, human refines" pattern Amboras itself recommends), or hand-written. Either way the
*measurement* is the valuable half.

This is the closest true analogue to Amboras's core loop, and WhatsApp is the right surface for it
in Malaysia.

**Schema.** `ActionLog.variant String?` + `ActionVariant` table (`type`, `label`, `body`,
`isActive`, `isDefault`).

**Verify.** `scripts/verify-message-variants.mjs` — assert deterministic assignment, assert variant
recorded on log, assert winner promotion only fires above the sample floor.

---

### C5 · Nightly analyst brief

**Today.** `/api/cron/eod-analysis` runs daily at 16:00 UTC but only parses unprocessed WhatsApp
messages into leads. Nothing reads the *business*.

**Build** `/api/cron/daily-brief` (add to `vercel.json`, guard with `CRON_SECRET` exactly like the
existing job). It assembles yesterday's facts from the existing read-only builders —
`lib/dashboard.ts`, `lib/finance.ts`, `lib/inventory.ts`, `lib/actions.ts` — revenue by stream,
occupancy %, no-shows, at-risk customers, low stock, margin mix, staff hours — makes **one Haiku
call**, and writes a `DailyBrief` row: three observations and three recommended actions, each
linking to a real page in the OS.

The owner opens the OS in the morning and reads what changed and what to do, instead of hunting
across six dashboards. This is Amboras's "reads your analytics autonomously", minus the part where
it acts on them.

**Cost.** ~1 call/day. Fails closed if `ANTHROPIC_API_KEY` is absent — brief is skipped, not faked.

---

### C6 · Generative onboarding — **the resale lever**

**Today.** `scripts/provision-client.mjs` + `scripts/seed-baseline.mjs` (Track B) create a database
and a bare baseline. Everything a new client actually needs — services, prices, rooms, tiers,
templates — is manual.

**Build.** The Amboras cold-start, applied to a business instead of a store. New client describes
their business in a paragraph — *"cat grooming and boarding, Penang, 6 boarding rooms, 2 groomers,
RM80–200 per groom, we also sell food and litter"* — and parallel agents propose:

- a service catalogue with names, durations, and price bands,
- room/kennel inventory,
- membership tiers and loyalty earn/burn rates,
- expense categories mapped to the chart of accounts,
- WhatsApp message templates in the local language,
- brand palette (see C7).

Each group is reviewed and edited by the owner before it is committed, then handed to
`provision-client.mjs`. Time-to-first-useful-day drops from days to under an hour.

This is what converts the OS from *Cat Day's system* into *a product other businesses can buy* —
the stated goal. Sequence it after C1/C2 so the proposal-and-confirm UI already exists to reuse.

---

### C7 · Brand autopilot

Track B already added `brand.{logoUrl, logoDarkUrl, primary, ink}` to `lib/config.ts` and wired the
CSS variables. The only missing piece is the generator: extract a dominant palette from the client's
uploaded logo, propose `primary`/`ink`, check contrast against the cream/ink base, show a live
preview, let them accept or override. Small, self-contained, and it makes white-labelling feel
instant during a sales demo.

---

### C8 · Photo enhancement *(nice-to-have)*

Amboras auto-generates studio packshots from merchant snapshots. Our analogue: clean up
before/after grooming photos — crop, straighten, normalise exposure, consistent framing. Cat Day's
before/after shots are its best marketing asset and they are currently phone snaps in bad lighting.
Media plumbing (`MediaAsset`, private Blob, `/api/media/[id]/file`) already exists; this is an
image-processing step on upload, not new architecture.

---

---

### C9 · Monthly department reports

Six reports, one per business segment, generated on the 1st for the month just closed. The bigger
sibling of C5 — where the daily brief is a nudge, this is the record.

#### The rule that shapes the whole design

**The model never computes a number.** Facts are computed by the existing read-only builders,
stored, and *then* narrated. The AI writes prose *about* figures it was handed; it never produces
one.

This is not fussiness. `lib/finance.ts`, `lib/balance-sheet.ts` and `lib/cash-flow.ts` are the same
code that renders the statements — if a report's revenue figure came from a language model it could
disagree with the income statement, and the moment an owner shows an accountant a number the OS
invented, the system is finished. Storing the facts next to the narrative makes every report
reproducible: you can always see exactly what the prose was written from.

A **numeric grounding check** enforces it — every number the model emits is matched against the
stored facts, and a mismatch flags the report rather than publishing it.

#### What each department reports on

| Department | Facts drawn from |
|---|---|
| **Operations & Sales** | appointments by type/status, no-show and cancellation rate, room occupancy, average stay length, groomer-hour utilisation (`lib/slots.ts`), revenue per available room-night |
| **Human Resource** | hours per staff (`TimeEntry`), lateness, leave taken vs balance, commission earned (`lib/commission.ts`), hiring pipeline movement |
| **Finance** | three-statement summary, revenue by stream, gross margin, net profit, cash movement, A/R and A/P aging (`lib/aging.ts`), plan-vs-actual against `MonthlyTarget` |
| **Customers · CRM** | new vs returning, **segment migration** (who moved Regular → At-risk), churn count, LTV distribution, tier movement, points issued and redeemed, wallet float, incidents |
| **Marketing** | C3 action performance, C4 variant results, consent base size, campaign ROI once M1/M2 land |
| **Administrative** | licences due and lapsed, asset additions and depreciation, audit-log volume, backup health, data-protection actions |

Segment migration is the single most valuable line here. It is the earliest signal the business is
leaking customers, and nothing in the OS surfaces it today.

#### Build

- `MonthlyReport` — `{ month "YYYY-MM", department, factsJson, narrative, status, generatedAt, model }`,
  unique on `(month, department)`, following the existing period-string convention.
- `lib/reports/facts/<dept>.ts` — pure and read-only, one per department. **Finance still never
  writes to operations.**
- `lib/reports/narrate.ts` — one Haiku call per department producing a headline, three observations
  and three recommended actions, each linking to a real page. Uses the M8 voice profile.
- `/api/cron/monthly-report`, `CRON_SECRET`-guarded, added to `vercel.json`. Six calls a month.
- `/reports`, manager-only (add to `MANAGER_PATHS`), with regenerate-from-stored-facts.

**Phase it: facts first, narrative second.** The fact tables are useful on their own and carry zero
AI risk. If the key is missing or the budget is spent, the report still generates with its facts and
the narrative is marked ungenerated — fail closed on the AI, never on the report.

---

## Part 3b — Track M: the Marketing segment

Marketing is segment 5 of six in the OS, and today it contains exactly one page: `app/academy/`.
It is the thinnest part of the system — and it is also where Amboras concentrates most of its
feature surface (AI SEO, generated emails, ad creative, promotion builder, reviews, brand-voice
fine-tuning, multilingual). This is the best-matched borrowing opportunity in the whole product.

**What we already have to build on:** `Customer.marketingConsent` / `marketingConsentAt` /
`marketingConsentSource` (Track A), the five-way customer segmentation in `lib/intelligence.ts`
(New / Regular / VIP / At-risk / Lost), the loyalty and wallet ledgers, `MediaAsset` with private
Blob storage, the WhatsApp webhook + `WhatsAppLead` extraction, and the `Incident` module.

**What we don't have:** any `Campaign`, `Review`, referral, or `language` model; and almost no
public surface — `PUBLIC_PATHS` is just `/careers`, `/r/` (digital receipts) and `/privacy`.

### Two non-negotiable constraints

**Consent gating is a legal requirement, not a setting.** Malaysia's PDPA 2010 requires consent for
direct marketing plus a working opt-out. Every campaign query in Track M must filter
`marketingConsent = true AND erasedAt IS NULL` at the **database layer**, not in a prompt. Track A
built these fields; Track M is the first thing that actually consumes them.

**WhatsApp is not a free broadcast channel.** Outside the 24-hour customer-service window, the
WhatsApp Business API requires pre-approved message templates, marketing templates are billed per
conversation, and aggressive sending gets numbers rate-limited or banned. Any "blast the segment"
feature must be built as *approved template + throttle + per-conversation cost estimate*, or it will
work in the demo and get the client's number blocked in production. Our current integration is
inbound-only (webhook) — outbound at scale is a genuine piece of work, not a config change.

### The objective function, again

Amboras optimizes conversion rate on infinite inventory. A grooming salon has **fixed groomer-hours
and a fixed room count**. A promotion that fills already-full Saturday slots destroys margin; the
same promotion aimed at empty Tuesday mornings is nearly pure contribution. So our campaign engine
must be **capacity-aware** — this is the single most important adaptation in Track M, and it is
something Amboras structurally cannot do.

---

### M1 · Campaign Studio — capacity-aware promotion builder

**Amboras.** *"Three promotional offers from a single prompt in under a minute."*

**Ours.** Same generator, constrained by two things Amboras has no concept of: **open capacity** and
**true margin**. The owner describes an intent — *"fill Tuesday and Wednesday boarding in
September"* — and the studio proposes 2–3 offer structures, each annotated with:

- which slots it targets, drawn from `lib/slots.ts` and room availability,
- projected margin impact using real service costs and commission rates (`lib/commission.ts`),
- the audience it should go to, drawn from `lib/intelligence.ts` segments,
- estimated WhatsApp conversation cost for that audience size.

An offer that would cannibalise already-booked peak slots gets flagged, not proposed.

**Schema.** `Campaign` (name, intent, offerType, discount, validFrom/To, targetSegments, status
`Draft|Approved|Running|Ended`, ownerApprovedAt) and `CampaignRecipient` (campaignId, customerId,
variant, sentAt, respondedAt, convertedTransactionId).

**Never automatic.** Generate → owner reviews and edits → owner approves → send. Same
propose-and-confirm discipline as C2.

---

### M2 · Campaign attribution — the marketing P&L

**Amboras.** First-party analytics, no third-party pixels, "you own the data."

**Ours.** We're already ahead architecturally — self-hosted, single-tenant, every transaction in our
own database. What's missing is the *loop closing*: nothing today connects a message sent to money
received.

**Build.** Campaign → recipients → replies → bookings → completed appointments → revenue → margin,
ending in a single number: **RM returned per RM spent**, per campaign. Link `Transaction` →
`Campaign` via the redemption path (a campaign code on the POS line, or attribution by recipient +
window).

This reuses C3's conversion-join machinery exactly. Build C3 first and M2 is mostly wiring.

The payoff is that marketing stops being a vibe. Right now nobody at Cat Day can say whether the
last promotion made money.

---

### M3 · Content Studio — before/after grooming posts

**Amboras.** AI image enhancement into studio packshots, plus on-tone copy generation.

**Ours.** Cat Day's single best marketing asset is its before/after grooming photos, and they are
currently phone snaps sitting in `MediaAsset` doing nothing. Build: pick a completed groom → the
studio pairs the before/after images, auto-crops to 1:1 and 9:16, normalises exposure, and drafts a
caption in the brand voice (M8) with the cat's name, breed, and service.

**The consent gate is the feature.** No customer's cat is ever suggested for publication unless
`marketingConsent = true`. A visible consent badge on every draft, and a one-click revoke that
pulls the cat from the content pool. This is both a legal requirement and, honestly, a selling point
— it is the kind of thing a premium brand's customers notice.

Output is a **draft for the owner to post**, not an auto-publish. Direct social posting can come
later; the bottleneck is asset creation, not the upload click.

---

### M4 · Review engine

**Amboras.** Built-in review collection and display.

**Ours.** For a physical business in KL, Google reviews are the highest-leverage marketing channel
that exists, and there is no automation for it today. Build: after a completed grooming, a
sentiment-gated request — ask *"how did today go?"* first, route positive answers to a Google review
link, route negative ones straight into the existing `Incident` flow so a complaint becomes a service
recovery instead of a one-star review.

Track request → response → review conversion rate, and feed that rate back through C3's ranking so
the timing tunes itself.

---

### M5 · Referral engine

Not an Amboras feature, but the natural extension of their retention loop into a service business
where word-of-mouth dominates. We already have append-only `LoyaltyEntry` and `WalletEntry` ledgers
with the ledger-plus-cached-balance pattern — referral credit fits that model exactly, on both
sides. Referral code per customer, credit on the referred party's first completed visit, fully
measurable, fully reversible.

**Follow data-integrity rule 2 exactly**: ledger entry and balance update in one `db.$transaction`,
never a bare balance increment.

---

### M6 · Public presence + local SEO — **the second resale lever**

**Amboras.** AI SEO — automatic schema, sitemaps, conversion-tuned metadata — plus the storefront
itself.

**Ours.** We have essentially no public surface, which means (a) no funnel to measure and (b) nothing
for a new client to point their Google Business Profile at. Build a white-label public page per
tenant — services, prices, hours, gallery from M3's approved content, reviews from M4, and a booking
request form — with `LocalBusiness` and `Service` structured data, sitemap, and metadata generated
from the tenant's own config.

It draws its branding from the Track B `brand.*` config seam, so it white-labels for free. And it
finally gives us a real top-of-funnel to measure: page view → booking request → confirmed
appointment → showed → rebooked.

Pair with **C6**: a client onboarding by describing their business gets a live, indexable, bookable
page out of the same generation pass. That is Amboras's "under two minutes to live" promise,
translated to a service business.

---

### M7 · Academy as a funnel, not a page

Marketing segment = Academy today, and Academy is one static page. Amboras's bundling / upsell /
subscription thinking applies directly: workshops are lead generation for grooming, and attendees
are the warmest possible membership prospects. Track workshop attendee → first grooming booking →
membership conversion, and the Academy stops being a brochure and becomes the top of a measurable
funnel.

---

### M8 · Brand voice profile

**Amboras.** Brand-voice fine-tuning, gated behind their $399/mo tier.

**Ours.** A stored voice profile in `lib/config.ts` — tone, formality, language mix, emoji policy,
signature phrases, and an explicit do-not-say list — consumed by *every* generator in the system:
C4's message variants, M1's campaign copy, M3's captions, M4's review requests.

This is small to build and it is the difference between AI marketing output that sounds like the
business and output that sounds like ChatGPT. Build it early; it is connective tissue for
everything else in this track.

---

### M9 · Multilingual

**Amboras.** Automatic multilingual content generation and translation.

**Ours.** Malaysia is genuinely trilingual in this market — English, Bahasa Malaysia, Mandarin — and
a message in the customer's own language converts better than a translated afterthought. Add
`Customer.language`, default from the source channel, and have every generator in M8's orbit produce
in that language natively rather than translating English.

This is a real localisation advantage in the home market, not a copied feature.

---

### M10 · Customer groups & targeted marketing

The audience half of marketing. **Sequences before M1** — targeting is useful immediately even with
hand-written copy, and the Campaign Studio then only has to supply the offer.

#### A group is a saved query, not a saved list

Groups re-evaluate every time they are opened. A frozen list is how a win-back gets sent to someone
who visited yesterday.

Rules are a **typed, validated vocabulary** — never free SQL — over what the OS already knows:
segment and churn risk (`lib/intelligence.ts`), membership tier, lifetime and trailing-12-month
spend, visit count, days since last visit, grooming overdue (`lib/grooming-reminder.ts`),
vaccination expiring, cat coat type / life stage / breed, boarding-only vs grooming-only,
acquisition source, language (M9).

Evaluation runs in two stages: filter on real columns in the database first, then run
`buildCustomerIntel` over the survivors. Segment and cadence are *derived*, not stored, so the
column filter is what keeps this fast on a growing customer base.

#### Three guardrails

**1 · Consent is a floor, not a rule.** Two separate functions: `evaluateGroup()` for counting and
analysis, `sendableMembers()` for outreach — and the send path always ANDs
`marketingConsent = true AND erasedAt IS NULL` regardless of what the group's rules say. Asking
"how many at-risk customers do we have" needs no consent; messaging them does.

**2 · A global frequency cap.** A customer who lands in five groups receives five messages in a week
and is lost. One hard cap across all groups, enforced at send time, not per campaign.

**3 · Health data is never a targeting rule.** `healthNotes` and `medication` are excluded from the
rule vocabulary entirely. "We noticed your cat has kidney disease, here's an offer" is a PDPA
problem and brand damage that does not get recovered.

#### Sending — an honest scope

Ship this as an **assisted send worklist**, not a bulk blast button.

The WhatsApp integration is inbound-only. Outbound at scale needs the Business API with pre-approved
marketing templates, per-conversation billing and throttling, and a banned business number is
unrecoverable. A worklist that walks staff through the group one customer at a time — per-customer
rendered copy, each send logged — delivers real targeting now. True bulk send is a separate piece,
scoped honestly rather than faked.

Every send records `{ groupId, customerId, variant, sentAt }`, so **M2 attribution can join it
later**: targeting becomes measurable, not merely convenient.

Seeded system groups: At-risk · Lapsed 90+ · Gold-eligible · New this month · Long-coat overdue ·
Boarding-only. Routes live under `/marketing/groups`, which starts giving that segment a real home.

---

## Part 4 — Sequencing

| Phase | Items | Why this order |
|---|---|---|
| **1** | C3 · M8 | C3 costs nothing (data already collected) and immediately makes the Action Inbox smarter. M8 (brand voice) is tiny and every later generator depends on it. Do both first. |
| **2** | C4 → M2 | C4 builds on C3's conversion join; M2 is the same join pointed at campaigns. The first *real* self-improving loop in the OS. |
| **3** | M10 → M4 · M5 | Customer groups first — targeting pays off immediately even with hand-written copy, and everything after it targets better. Then the review engine and referrals: high marketing ROI, no AI dependency, both reuse existing ledgers and the Incident flow. |
| **4** | C1 → C2 | Copilot dock (read-only, low risk) first, then write tools once the confirm-gate UI is proven. |
| **5** | M1 · M3 | Campaign Studio and Content Studio both reuse C2's propose-and-confirm UI and M8's voice profile. M1 consumes M10's audiences and needs the WhatsApp outbound/template work — scope that honestly. |
| **6** | C5 → C9 | Nightly brief, then the monthly department reports. C5's daily brief is the fact-builders' first customer, so build the facts once and use them at both cadences. |
| **7** | C6 → M6 → C7 | Productization: generative onboarding, public presence page, brand autopilot. Do this block together when resale becomes the priority — a client should get a live branded bookable page from one description. |
| **8** | M7 · M9 · C8 | Academy funnel, multilingual, photo polish. |

**If you only do three things:** C3, M8, M2. They are cheap, they compound, and together they turn
both the Action Inbox and marketing from guesswork into something measured.

## Part 5 — Risks

- **Token cost.** Every AI feature must respect `ai.enabled` and `ai.dailyTokenBudget` from
  `lib/config.ts`, and fail closed (feature absent) rather than open (feature broken) when the key
  is missing or the budget is spent. Default to Haiku; only escalate a model where quality is
  demonstrably the bottleneck.
- **Hallucinated writes.** Mitigated structurally by C2's propose/confirm split — the model never
  holds a write handle. Do not weaken this for convenience.
- **PDPA.** Erased customers must be filtered at the *tool* layer, not the prompt layer. Prompts are
  advisory; `where` clauses are not.
- **Staff trust.** An auto-suppressed action type or an auto-promoted message variant must be
  visible and reversible in the UI. A system that silently changes its own behaviour is a system
  people stop believing. Show the reasoning and the sample size.
- **Marketing consent (PDPA).** Every campaign audience query filters
  `marketingConsent = true AND erasedAt IS NULL` in the `where` clause. A consented customer who
  later opts out must drop out of in-flight campaigns, not just future ones.
- **WhatsApp account risk.** Outbound marketing needs approved templates, throttling, and a
  per-conversation cost estimate shown *before* sending. Getting a client's business number banned
  is an unrecoverable failure — treat send volume as a guarded resource, not a slider.
- **Publishing a customer's cat without permission.** M3 must gate on consent at the query layer and
  show the consent state on every draft. This is the one place where an AI feature could cause real
  reputational damage to the client.
- **A number the OS invented.** C9's reports will be read by an owner and shown to an accountant.
  Facts are computed by the existing statement builders and stored; the model narrates them and
  never calculates. The grounding check is not optional polish — it is the feature's licence to
  exist.
- **Message fatigue.** M10 makes it trivial to reach the same person through several groups at once.
  The frequency cap is global and enforced at send time; a per-campaign cap would not catch it.
- **Optimizing the wrong number.** Guard against C3/C4 maximising *staff clicks* instead of
  *business outcomes*. The conversion join is the real metric; acceptance rate is only a proxy and
  should never be the sole ranking signal.
