# v1.3.0 Plan — Inventory: physical products + cat inventory

**Status: BUILT on the demo, awaiting the owner's review.** The plan below is
unchanged from the draft so the two can be compared; what was actually built,
and the nine decisions it had to assume, are recorded in "As built" at the end.

Read [AGENTS.md](../AGENTS.md) first. This document is a design proposal, not a
specification — where I have made a judgement call I have said so and given the
reason, so you can overrule it with the reason in front of you. The decisions
that are genuinely yours are collected at the end.

---

## 1. What changes, in one paragraph

`/products` becomes `/inventory`, which governs two kinds of stock: **physical
products** (unchanged — the product management is good) and **cats**, which are
live stock the business owns, breeds, and sells. Cats stay in the existing `Cat`
table, so a cat you own keeps every feature a customer's cat already has —
photos, health record, boarding, care tasks — and when you sell it, the animal's
whole history transfers to the buyer instead of being re-typed.

---

## 2. What your workbook actually contains

I parsed `1. CD_Cat Inventory 2026.xlsx`. This is what the system has to hold:

| | |
|---|---|
| Cats with a SKU | **64** |
| Adult / Kitten | 50 / 14 |
| Marked `REHOME PLAN` | **31** |
| Pregnant | 2 (Pumpkin, Kelly) |
| FIP | 2 (Zephyr, Bailey) |
| Intact | 43 of 64 |
| Same-DOB groups that are almost certainly litters | 8 |

**SKU scheme:** `CD-<BREED3>-<NNN>` — BSH 25, MNS 10, DRX 8, MNL 7, EXO 6,
BLH 2, SRL 2, PER/HHP/RAG/AME 1 each. The system should generate the next
number automatically and let you override it.

**Four data problems the import has to survive.** These are in the real file;
they are not criticism, they are what happens to any spreadsheet after two
years, and they are the reason the import must be a reviewed dry run rather
than a load:

1. **22 of 64 DOBs are not dates** — bare values like `86`, `107`, `101`, and
   one `8/11/20222`. Two are blank. I do not know whether `86`/`107` are ages in
   months, a lost formula, or something else. **This is question 1 for you.**
2. **Breed is free text and has drifted.** `Golden Bristish` (13) and
   `Golden British` (8) are the same breed split by a typo — 21 cats that no
   report will ever group correctly. Also `Muchkin`/`Munchkin`, `Sellkirk`/
   Selkirk, `British` vs `British Short hair`. Fix: a canonical breed list, with
   the SKU prefix derived from it. Free-text breed is how this happened.
3. **`Neutered` / `Spayed` are used as gender markers, reversed.** Every male in
   the sheet is `Spayed` and every female `Neutered`; standard veterinary usage
   is the opposite. Fix: store one `desexedAt` date and derive the *word* from
   the cat's sex. The ambiguity then cannot recur.
4. **`Category` (Adult/Kitten) is typed by hand** and will rot the moment a
   kitten has a birthday. Derive it from DOB.

The **Costing** sheet is a different shape entirely and matters more than it
looks: one vet visit, 57 cats, `RM45 vaccine + RM40 transport + RM5 deworm =
RM2,890`. That is a **batch cost allocated across many cats**, and it is the
model for nearly every real cost a cattery incurs. Section 6 handles it.

The **Housecall Vet List** is a supplier list (vet, area, contact, price per
vaccine, deworm by weight, travel charge). Useful, but it is a contact list, not
inventory. I propose leaving it out of v1.3.0 — see section 12.

---

## 3. The core decision: where do the shop's own cats live?

Three options. I recommend the third.

**A. Reuse `Cat`, hang all 64 off a "house customer".** Everything works for
free. But 64 shop cats then appear in the customer cat list, the dashboard
counts, marketing segments, retention analysis — and the Action Inbox would try
to WhatsApp a customer that does not exist. Unacceptable on its own.

**B. A separate `HouseCat` table.** Clean separation, and it duplicates every
piece of cat machinery you already own: photos, health gate, boarding, care
tasks, room occupancy, assessments. `CareTask` and `DailyCareLog` both key off
`Appointment → Cat`, so a house cat in a room needs a parallel path through all
of it. And when you sell the cat, its history does not follow it.

**C. One `Cat` table, plus a `CatStock` sidecar row that makes a cat stock.**
*Recommended.* A cat with a `CatStock` row is inventory; a customer's pet has
none. This is purely additive — the ~existing customer cats are not touched by
the migration at all.

The argument that decides it: **a cat you sell is the same animal afterwards.**
With a sidecar you keep the `Cat` row, point `customerId` at the buyer, and
close the `CatStock` row (status `Sold`, kept for history — the "deletes are
soft for anything with financial history" rule). The buyer inherits the
vaccination record, the photos, the whole file. With a separate table you would
copy the animal into a second table and hope nothing was lost.

Second reason: becoming inventory is then an **explicit act of creating a row**,
not a nullable column on every cat in the database that a bad update could set.

### The house customer

`Cat.customerId` is `NOT NULL`, and SQLite cannot drop a `NOT NULL` on an FK
column without a full table rebuild — not something to do to a live table for
cosmetic reasons. So house cats point at a single seeded customer row,
`Cat Day — House`, marked with a new `Customer.isHouse` flag (one additive
column, safe).

**That flag is the whole isolation story, and getting it wrong is the most
likely way this feature causes damage.** Section 10 is the register of every
place that must exclude it.

---

## 4. Schema

New models. Every field is nullable unless it genuinely cannot be, because the
import has to accept an imperfect spreadsheet without inventing data.

```prisma
// A cat the BUSINESS owns — breeding stock, kittens for sale, retired
// residents. A customer's pet has no CatStock row; that absence is what
// "not inventory" means, and it is why a stray UPDATE cannot make a
// customer's cat sellable.
model CatStock {
  id             String   @id @default(cuid())
  catId          String   @unique
  cat            Cat      @relation(fields: [catId], references: [id])
  sku            String   @unique          // CD-BSH-001
  role           String   // Breeder | ForSale | Retired | Resident
  status         String   // InStock | Reserved | Sold | Rehomed | Deceased
  acquiredAt     DateTime?
  acquiredFrom   String?                   // cattery, breeder, or "own litter"
  acquisitionRM  Float    @default(0)      // the ONLY figure that reaches the balance sheet — see §8
  askingRM       Float?
  reservedForId  String?                   // Customer holding it
  depositRM      Float?
  reservedUntil  DateTime?
  microchipNo    String?
  registrationNo String?                   // TICA / CFA / MCC
  litterId       String?
  litter         Litter?  @relation(fields: [litterId], references: [id])
  soldAt         DateTime?
  soldToId       String?                   // Customer
  saleRM         Float?
  exitAt         DateTime?                 // rehomed or died
  exitReason     String?
  notes          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  costs          CatCost[]
  @@index([status, role])
}

// Litters — 8 already exist in the workbook as same-DOB groups. Drives
// supply forecasting: how many kittens are sale-ready in 12 weeks.
model Litter {
  id         String    @id @default(cuid())
  code       String    @unique   // L-2025-07-24-BSH
  damId      String?             // Cat — the queen
  sireId     String?             // Cat, when the stud is ours
  sireName   String?             // free text when it is not
  expectedAt DateTime?           // confirmed pregnancy, before birth
  bornAt     DateTime?
  bornCount  Int?
  survivingCount Int?
  notes      String?
}

// Per-cat direct costs: vaccination, deworm, neuter, vet treatment, transport,
// registration. This is a MANAGEMENT ledger for pricing — read §8 before
// wiring it to the balance sheet, because capitalising these double-counts.
model CatCost {
  id        String   @id @default(cuid())
  catStockId String
  stock     CatStock @relation(fields: [catStockId], references: [id])
  date      DateTime
  category  String   // Vaccination | Deworm | Neuter | VetTreatment | Transport | Registration | Other
  amountRM  Float
  batchId   String?
  batch     CatCostBatch? @relation(fields: [batchId], references: [id])
  expenseId String?  // the Expense row it was booked under, when there is one
  vendor    String?
  notes     String?
  @@index([catStockId, date])
}

// One vet event covering many cats — your Costing sheet, as data.
// 57 cats x RM45 + RM40 transport + RM5 deworm = RM2,890.
model CatCostBatch {
  id        String   @id @default(cuid())
  date      DateTime
  vendor    String?
  totalRM   Float
  method    String   // PerCat | EvenSplit
  notes     String?
  expenseId String?
  costs     CatCost[]
}
```

Additive columns on existing models:

| Model | Column | Why |
|---|---|---|
| `Customer` | `isHouse Boolean @default(false)` | the isolation predicate |
| `Cat` | `lastVaccinatedAt DateTime?` | the workbook's "Latest Vaccine Date"; `vaccinationExpiry` already holds "Next" and already drives alerts |
| `Cat` | `rabiesAt DateTime?` | tracked separately in the workbook |
| `Cat` | `desexedAt DateTime?` | replaces the reversed Neutered/Spayed text |

**No vaccination-history table.** Your sheet keeps latest + next, and the
`CatCost` rows of category `Vaccination` give you a dated history for free.
If you later want a history for cats that were vaccinated at no cost, that is a
`CatHealthEvent` model — cheap to add then, speculative now.

Migration: one idempotent `scripts/migrate-cat-inventory.mjs`, per the Prisma 7
+ Turso rule. `prisma migrate` does not work here.

---

## 5. Naming: `/products` → `/inventory`, and the trap in it

```
/inventory              overview — products at cost + livestock, low stock, cats available
/inventory/products     the existing page, moved unchanged
/inventory/cats         new: the cat inventory list
/inventory/cats/[id]    one cat's stock record (its animal record stays at /cats/[id])
/inventory/litters      litters and expected kittens
```

Nav: a new **Inventory** sub-group inside Operations & Sales, replacing the
single `Products` link. That is the existing `NavGroup` shape — no new nav
machinery, unlike the Intelligence drop-down.

**The trap.** `/products` appears in four places that must all move together,
and one of them is *data*:

1. `lib/nav-catalogue.ts` — the link
2. `proxy.ts` `MANAGER_PATHS` (line 24)
3. `lib/roles.ts` `MANAGER_ONLY_PATHS` (line 23)
4. **`StaffRoleDef.paths` and `.layout` rows already in the database**

Miss (4) and every staff role that had Products loses it silently — and because
`pathAllowed` is prefix-matched, a redirect from `/products` does *not* rescue
them: they get bounced from `/inventory/products` by the role check before the
redirect matters. The migration script must rewrite the stored role paths. A
`/products → /inventory/products` redirect is still worth keeping for
bookmarks, but it is not the fix.

---

## 6. The three linkages you asked about

### 6.1 "They eat — does feed cost really need to be included?"

**My answer: track the consumption, do not allocate it per cat.** Three reasons,
in order of how much they matter:

1. **You cannot observe it.** Sixty-four cats share bowls. Per-cat grams is a
   number the system would invent, and an invented number that looks precise is
   worse than no number, because it gets trusted and then used to price a cat.
2. **The accounting is wrong.** Feed is a period cost — overhead — not part of
   the carrying value of the animal. Capitalising it into a cat's cost would
   overstate both your assets and your profit.
3. **The useful version is cheap.** Total livestock feed ÷ average head count =
   **cost per cat per month**. That is defensible, it needs no new data entry,
   and it answers the question you are actually asking, which is whether the
   cattery earns its keep.

What to build instead: a new `StockMovement` reason **`HouseUse`** on the
existing product ledger. When kibble leaves the shelf for the cattery rather
than for a customer, it decrements stock exactly as a sale does, but posts to a
**Livestock Feed** expense category instead of revenue. One new reason on
machinery you already have — no new tables, and inventory-at-cost stays correct.

The costs that *are* worth tracking per cat are the lumpy ones — vaccination,
deworm, neuter, vet treatment, transport. Those are `CatCost`, and your Costing
sheet is already exactly that.

### 6.2 Rooms, run sheet, and care

A house cat in a boarding room is recorded as an **`Appointment` of a new type
`Residency`**: house customer, that cat, that room, `price 0`, `status
CheckedIn`, `endsAt` null.

That single choice buys, with no new code:

- **The room calendar shows the room as taken**, so you cannot double-book a
  paying guest into a room a house cat lives in. This is the most valuable
  linkage in the whole feature and it is free.
- **The run sheet generates daily `CareTask`s** for house cats alongside guests
  (`app/runsheet/page.tsx:29` widens to `type: { in: ['Boarding','Residency'] }`).
- `DailyCareLog` and the boarding health gate work unchanged.

I considered putting `roomId` on `CatStock` instead. It is cleaner on paper and
I rejected it: `CareTask.appointmentId` is `NOT NULL` and part of a unique
constraint, so house-cat care tasks would need an SQLite table rebuild on a live
table — real risk, for a worse result. Two sources of room occupancy is also
exactly the kind of split that drifts.

**The cost of the choice, which must be paid explicitly:** a `Residency` is an
appointment, and appointments feed revenue, utilisation, and the Action Inbox.
Every one of those must exclude type `Residency`, or your average sale value
quietly collapses toward zero. That is a verify suite, not a hope — §11.

### 6.3 What you are missing

Ranked by how much I think each is worth.

1. **A sale-readiness gate.** The one screen you will use daily: *which cats can
   I actually sell today?* Blockers — under 12 weeks old, no first vaccination,
   not dewormed, no microchip, already reserved, role is `Breeder`/`Resident`.
   Warnings — intact, no registration papers. This mirrors
   `boardingHealthGate()` in `lib/health.ts` exactly; same shape, same idea.
2. **Sell through the POS, not a separate screen.** `TransactionLine.catId`
   already exists. A cat sale therefore lands in revenue, on the customer's
   record, in the receipt, in the monthly close — with a new cart kind `cat` and
   a new revenue category `Cat Sale`. Building a second, parallel sale path is
   how a business ends up with two sets of numbers.
3. **The reversal.** Data-integrity rule 3: everything a checkout creates, a
   deleted sale must undo. Deleting a cat sale must set the `CatStock` back to
   `InStock` and return `Cat.customerId` to the house customer. Non-negotiable,
   and it is the thing most likely to be forgotten.
4. **Deaths, recorded not deleted.** FIP is already in your data twice. A death
   is a welfare record and a cost write-off, and it must never be a `DELETE`.
   `status: Deceased`, a date, a cause.
5. **Rehoming is not selling.** 31 of your 64 cats are marked `REHOME PLAN` —
   retired breeders leaving at low or no price. Same exit path, different
   disposition, and it should not be reported as sales revenue.
6. **Reservation with a deposit.** A buyer puts money down on a kitten weeks
   before collection. `status: Reserved`, `depositRM`, `reservedUntil` — and an
   expiry that releases the hold, or the deposit list becomes a graveyard.
7. **Your DVS breeder licence.** Malaysia's Animal Welfare Act 2015 licenses
   breeding and sale of animals. The OS already has a `License` model with
   renewal alerts — this belongs there, not in a new table. Worth two minutes to
   confirm the licence details are captured before you list cats anywhere public.
8. **Microchip and registration numbers**, because transfer of ownership needs
   them and pedigree papers move the price.
9. **The sale contract and health guarantee** as a document per sale —
   `MediaAsset` with `ownerType: 'catsale'`, the same machinery Finance →
   Records uses for invoices.
10. **Litters as forecasting.** Two queens are pregnant now. "Kittens
    sale-ready in 12 weeks" is a supply plan, and it falls out of `Litter` +
    the readiness gate for free.
11. **Derive Kitten/Adult from DOB** rather than storing it. One fewer thing to
    rot.

Deliberately **not** proposed for v1.3.0: a public "cats available" page, a
supplier/vet directory, genetic test tracking (PKD/HCM), and per-cat weight
history. Each is defensible later; none is load-bearing now, and the feature is
already large.

---

## 7. Screens

**`/inventory`** — two tiles: products (units, at cost, low-stock count) and
cats (head count, available, reserved, cost base). One line for total inventory
value, which is what the balance sheet reads.

**`/inventory/cats`** — the list. Columns: SKU, photo, name, breed, sex, age
(derived), role, status, days in stock, asking price, readiness. Filters by
role, status, breed, and "ready to sell". Search by name or SKU.

**`/inventory/cats/[id]`** — the stock record: acquisition, cost ledger with a
running total, readiness gate with its blockers spelled out, litter and
lineage, current room, and the sale/rehome/death actions. Links across to the
animal's own file at `/cats/[id]`, which keeps the medical and grooming history
where it already lives. **Two pages, one animal** — the stock record answers
"what is this worth and can I sell it", the cat page answers "how is this cat".

**`/inventory/litters`** — litters, expected dates, and a forecast of when each
kitten becomes sale-ready.

**Action Inbox additions** — vaccination due on a house cat, a reservation about
to expire, a kitten crossing into sale-ready, a cat in stock beyond an ageing
threshold. These are genuinely useful and use the existing card machinery.

---

## 8. Finance — and the double-count trap

This is the part that is easy to get quietly, expensively wrong.

**Recommendation: expense cat costs as incurred; carry cats on the balance sheet
at acquisition cost only.**

The trap: if a vet bill is booked as an `Expense` (it hits the income statement)
*and* capitalised into the cat's carrying value (it hits the balance sheet as an
asset), the same ringgit is counted twice and profit is overstated. The two
consistent treatments are:

- **(a) Expense as incurred.** Vet, vaccine, transport, feed all hit the P&L in
  the month they are paid. `CatCost` becomes a *management* ledger — it tells
  you what a cat cost so you can price it, and touches no statement. The balance
  sheet carries cats at acquisition cost only. Home-bred kittens carry at nil,
  which is conservative and correct.
- **(b) Capitalise into cost, release as COGS on sale.** More precise, and it
  requires excluding those expense rows from the income statement — new
  complexity in the one part of the system where being wrong is worst.

**I recommend (a).** It is what a Malaysian SME accountant will do anyway, it
keeps the income statement untouched, and it never overstates profit. You still
get "this cat cost me RM380 in vet bills" for pricing — you just do not call it
an asset.

Concretely:

- New auto line on the balance sheet, **`a.livestock` "Livestock (cats at
  cost)"** = Σ `acquisitionRM` for cats with `status: InStock`. Auto, so it
  renders black, alongside `a.inventory`.
- New revenue category **`Cat Sale`**, so cat income is visible next to
  Grooming, Boarding and Retail rather than buried in Other.
- New expense categories **`Livestock Feed`** and **`Livestock Vet`**.
- Selling a cat reduces `a.livestock` by that cat's acquisition cost and books
  the sale as revenue. Both happen automatically from the status change; nothing
  new is written to operations. Finance still only reads.

---

## 9. The sale flow, end to end

1. `/inventory/cats` → a cat that passes the readiness gate → **Reserve** with
   a deposit, or **Sell now**.
2. Reserve: `status: Reserved`, `reservedForId`, `depositRM`, `reservedUntil`.
   The Action Inbox chases the hold before it expires.
3. Sell: the cat goes into the POS cart as kind `cat`. Checkout writes the
   `Transaction` and a `TransactionLine` with `catId`, category `Cat Sale`,
   awards loyalty points as any sale does, and in the same atomic batch:
   `CatStock.status: Sold`, `soldToId`, `saleRM`, and **`Cat.customerId` moves
   to the buyer**. The animal is now their pet, with its whole history.
4. Documents — contract, health guarantee — attach to the sale as `MediaAsset`.
5. **Deleting that transaction reverses all of it**: status back to `InStock`,
   `Cat.customerId` back to the house customer, sale fields cleared. This goes
   into the existing `deleteTransaction()` alongside the stock, points and
   wallet reversals it already does.

Rehoming and death take the same exit path with different dispositions, and
neither produces a `Transaction` unless money changed hands.

---

## 10. The isolation register

House cats and the house customer must not leak into customer-facing views.
This is the highest-risk part of the change, so it is a list, not a principle.

| Where | What leaks | Fix |
|---|---|---|
| `lib/shared-reads.ts` `allCatsWithVisits` | whole-table `Cat` scan feeding the dashboard **and the Action Inbox** | exclude house cats |
| `lib/actions.ts` | birthday, win-back, grooming-due cards → WhatsApp to a customer that does not exist | exclude; but **keep** vaccination-due, which is a real action on a house cat |
| `app/cats/page.tsx` | 64 shop cats in the customer cat list | exclude |
| `/customers` and customer counts | a fake customer in the list and in every count | exclude `isHouse` |
| Marketing segments, groups, campaigns | messaging the house customer | exclude |
| Retention / loyalty / memberships | a customer with 64 cats and no spend distorts every cohort | exclude |
| Revenue, utilisation, average sale value | `Residency` appointments at RM0 | exclude type `Residency` |
| `lib/shared-reads.ts` `appointmentsToday` | no type filter — a residency shows as an arrival on its move-in day | exclude type `Residency` |
| Run sheet, room calendar, care tasks, health gate | — | **include** — this is the point |

The safest shape is one predicate in one place that every caller reuses, not
`isHouse: false` copy-pasted into thirty queries. `scripts/verify-house-isolation.mjs`
seeds a house cat and asserts it is absent from each customer-facing surface and
present on each operational one.

---

## 11. Verification

Per the repo's standing bar, each of these seeds real rows, drives real HTTP,
asserts exact values, and cleans up in a `finally`:

| Suite | Proves |
|---|---|
| `verify-cat-inventory` | CRUD, SKU generation and uniqueness, status transitions, derived age |
| `verify-cat-sale` | POS sale moves ownership, books `Cat Sale` revenue — **and deleting it reverses every part** |
| `verify-cat-readiness` | the gate blocks an under-age, unvaccinated, or reserved cat, and passes a ready one |
| `verify-house-isolation` | the whole of §10, in both directions |
| `verify-residency` | a residency occupies a room, appears on the run sheet, generates care tasks, and contributes **exactly RM0** to revenue |
| `verify-cat-costs` | batch allocation splits RM2,890 across 57 cats to the ringgit; the balance sheet does **not** double-count it |
| `verify-inventory-nav` | the rename, including that a staff role which had Products still reaches `/inventory/products` |

Re-run afterwards, because they touch shared logic: `verify-three-statement`,
`verify-schema-fixes`, `verify-txn-delete`, `verify-txn-reversal`,
`verify-runsheet-progress`, `verify-action-facts`, `verify-roles`.

---

## 12. Build order

Each phase is independently shippable and leaves the system working.

| Phase | Contents | Risk |
|---|---|---|
| **1 · Rename** | `/products` → `/inventory/products`, nav sub-group, `proxy.ts` + `roles.ts` + **stored role paths**, redirect, `verify-inventory-nav` | low, but the role-path migration is the sharp edge |
| **2 · Spine** | `CatStock`, `Litter`, house customer, `Customer.isHouse`, the three `Cat` columns, migration script | low — purely additive |
| **3 · Import** | dry-run importer with a review report; the 22 bad DOBs land in a "needs attention" list rather than being guessed | medium — see §2 |
| **4 · Screens** | `/inventory`, `/inventory/cats`, `[id]`, readiness gate | low |
| **5 · Isolation** | §10 in full, `verify-house-isolation` | **highest** — do not defer this behind the screens |
| **6 · Rooms & care** | `Residency` type, run sheet, room calendar, revenue exclusions | medium |
| **7 · Costs** | `CatCost`, `CatCostBatch`, `HouseUse` stock reason, expense categories | low |
| **8 · Sale** | POS `cat` kind, `Cat Sale` revenue, reversal in `deleteTransaction()`, litters, Action Inbox cards | medium — the reversal is the part to get right |
| **9 · Finance** | `a.livestock` on the balance sheet | low, once §8 is settled |

Phase 5 before phase 6 is deliberate. Once residencies exist, house cats are
inside the operational data; if the exclusions are not already in place, the
first symptom is a wrong number in a report nobody re-checks.

---

## 13. Decisions I need from you

1. **What are the `86` / `107` DOB values?** 22 cats. Ages in months, a broken
   formula, or something else? If unknown, the import files them as "DOB
   unknown" and the readiness gate treats them as un-sellable until you enter
   one — safe, but it is 22 rows of manual work.
2. **Confirm the SKU prefixes.** `MNL` currently covers both Minuet and some
   Munchkins, and `HHP` holds one Domestic Long Hair. I can normalise on import
   or keep them exactly as they are.
3. **Feed costing — do you accept herd-level only?** (§6.1) If you want per-cat,
   tell me what you can actually measure and I will build to that instead.
4. **Accounting treatment — (a) expense as incurred, or (b) capitalise?**
   (§8) I recommend (a). This is the one decision worth showing your accountant.
5. **Rehoming price.** Are retired breeders rehomed free, at a nominal fee, or
   does it vary? It changes whether rehoming needs a POS path at all.
6. **Minimum sale age.** I have assumed 12 weeks, which is the common standard.
   Yours may differ.
7. **Who can see cat inventory?** Manager-only like Products, or should
   reception see availability? Acquisition cost and margin should stay
   manager-only either way.
8. **Is there a DVS breeder licence to record?** (§6.3 item 7)
9. **Vet supplier list — in or out?** I have left it out. It is a contact list,
   and adding a supplier model to serve one sheet is scope I would rather spend
   on the sale flow.

---

## As built (v1.3.0, on the demo)

Everything in §12's build order is in, plus the batch-cost screen. The nine
questions in §13 had to be answered to build at all — these are the assumptions,
each reversible, each flagged where the owner said nothing:

| # | Question | Assumed | How to change it |
|---|---|---|---|
| 1 | `86` / `107` DOBs | **Not dates.** Imported as unknown; 24 cats carry "Date of birth unknown" and cannot pass the sale gate | enter a DOB on the cat's record |
| 2 | SKU prefixes | **Kept exactly as the workbook has them** | they are editable per cat |
| 3 | Feed costing | **Herd-level only** — a `Cattery −` movement on the product ledger, shown as cost per cat per month | §6.1 |
| 4 | Accounting | **(a) expense as incurred**; the balance sheet carries cats at acquisition cost only | §8 |
| 5 | Rehoming price | **Optional fee**, recorded but not booked as a sale | `exitCat` |
| 6 | Minimum sale age | **12 weeks** (`MIN_SALE_AGE_DAYS`) | one constant |
| 7 | Who can see it | **Manager only**, like Products — `/inventory` is in `MANAGER_ONLY_PATHS` | `lib/roles.ts` + `proxy.ts` |
| 8 | DVS breeder licence | **Not recorded** — no details supplied | add it at `/admin/licenses` |
| 9 | Vet supplier list | **Left out** | — |

Two more decisions the build forced, worth knowing:

- **Desexing dates are blank for every imported cat.** The workbook records
  `Neutered`/`Spayed` but never *when*, and the import will not invent a date.
  The flag is preserved in each cat's notes; the readiness gate therefore warns
  "Intact — agree desexing with the buyer" until a real date is entered.
- **Acquisition cost is RM 0 for all 64**, because the workbook does not record
  what any cat cost. Livestock consequently carries at nil on the balance sheet
  — conservative and correct, but it means the cattery is currently invisible as
  an asset until costs are entered.

**One thing the workbook could still give us**: the Master List leaves sex blank
for 22 cats, but *"Latestt Vaccines List (2)"* has a sex for most of them. I did
not cross-fill, because the two sheets disagree in places and a guess written
into the database looks identical to a fact. Say the word and it becomes a
one-line import option.

### Verification

| Suite | Result |
|---|---|
| `verify-cat-inventory` | 24/24 — gate, costs, balance-sheet isolation, house isolation, residency |
| `verify-cat-sale` | 22/22 — sale, ownership transfer, guards, full reversal |
| Full production sweep | 61 pass · 0 fail · 15 skip |
| Full dev sweep | 13 pass · 0 fail |

Two **pre-existing** suites failed and were fixed; neither was caused by this
work, and both were the test rather than the app:

- `verify-pos-autocharge` seeded an in-progress visit at a fixed 08:00, so it
  failed on any run before 8am — the POS correctly does not offer a visit whose
  time has not come.
- `verify-appointments` built "today" from the UTC calendar date minus eight
  hours, which lands on *yesterday* between midnight and 8am local, so the diary
  had no Today group to find.

Both now derive their times from the moment the suite runs.
