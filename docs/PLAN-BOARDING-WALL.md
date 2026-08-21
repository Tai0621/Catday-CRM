# Boarding UI — the cabinet wall as the interface

**Status: BUILT on the demo.** The plan below is unchanged from the draft so the
two can be compared; what was actually built, and the assumptions it had to
make, are in "As built" at the end. Companion to
[PLAN-CAT-INVENTORY.md](PLAN-CAT-INVENTORY.md); same house style — where I have
made a judgement call it says so and gives the reason, so you can overrule it
with the reason in front of you.

---

## 1. What you actually sent me

`效果图.pdf`, 23 pages, from the cabinet maker (猫咪宫殿 / Cat Palace), filed
under `2025\猫柜定制\马来西亚-karen sui`. It is a **manufacturing drawing set**,
one bundle per zone.

**These are front elevations, not floor plans.** Every page is 正视 (front view),
后视 (rear view) or a section — the wall of cabinets as you stand in front of it,
not a top-down plan of the room.

**That is better for this than a floor plan would be**, and it is worth saying
why: a carer standing in the boarding room sees exactly this arrangement. An
elevation is the thing in front of their eyes; a floor plan is a diagram they
have to translate. If the screen looks like the wall, nobody has to learn it.

### The pages you picked, and one correction

| Page | Is | Units |
|---|---|---|
| 1 | **1区** front elevation | 10 |
| 4 | **1区 *rear*** elevation (`后视`, page 4/7 of the same zone) | same 10, from behind |
| 8 | **2区** front elevation | 9 (3 × 3) |
| 12 | **3区** front elevation | 18 (6 × 3) |
| 16 | **4区** front elevation | 4 (2 × 2) |

Page 4 is the **back of Zone 1**, not a fifth zone. I think you meant one page
per zone — in which case the fifth is **page 20**, which is `6区`, the **暂存柜**
(staging cabinet): 6 cubbies with storage under them. Those are transit holding,
not accommodation, and §7 treats them differently on purpose.

If Zone 1 is genuinely double-sided — serviced from behind as well as in front —
that changes the design and I need to know. **Question 1.**

### The wall, as drawn

- **Zone 1 — 10 units, irregular.** Two double-height units at the far left and
  far right (arched cat-house, two shelf levels, drawers beneath) with eight
  single-height units filling the middle in a 3 / 2 / 3 stack. This is the
  "feature wall".
- **Zone 2 — 9 units, 3 × 3.** Round porthole door on the left half of each,
  viewing panel on the right. Uniform.
- **Zone 3 — 18 units, 6 × 3.** The standard bank. Uniform singles.
- **Zone 4 — 4 units, 2 × 2.** The big ones: porthole plus full-height window,
  storage cupboards below. The suites.
- **Zone 6 — 6 staging cubbies.** Not boarding.

**41 boarding units, 6 staging.** The demo database currently holds **61** rooms
(`Room 01`–`Room 54` plus `Suite 1`–`Suite 7`), which is placeholder seed data
and does not match the build. Reconciling those is part of the work, and it is
**Question 2**: is 41 the real number, or is this drawing one phase of a bigger
room?

---

## 2. The idea, stated precisely

The boarding landing page stops being a table of room names and becomes **the
wall**. Every enclosure is a button. Colour tells you its state at ten feet;
the label tells you which cat; clicking opens that room.

The thing this replaces is real: today a carer who wants to know "is Mochi in 12
or 14?" reads a list sorted by `sortOrder` and matches a number to a door. The
wall removes the translation step entirely.

---

## 3. The decision that shapes everything else

**Trace the drawing, or draw the wall from data?**

**A. Trace it.** Convert each elevation to SVG, keep the shelves, tunnels,
litter trays and arches, and make each enclosure's glass panel a clickable path.
Pixel-faithful to what the cabinet maker will install.

**B. Draw it from data.** Store each room's zone and position, render clean
rectangles in the same arrangement and the same relative sizes — double-height
units actually double-height, Zone 3 actually 6 × 3.

**I recommend B**, and I want to be straight that it is not literally "use the
attached as the interface":

1. **A traced drawing is frozen.** These are custom cabinets being built now.
   The first time a unit is added, split, or taken out of service, a traced SVG
   needs a developer and a new deploy. A data-driven wall needs someone to drag
   a tile.
2. **The drawing's detail is noise on an operations screen.** Shelf brackets and
   litter trays are what the joiner needs. What a carer needs from a 90-pixel
   tile is: occupied or free, which cat, anything wrong. Rendering the furniture
   costs contrast that the status colour needs.
3. **It has to survive a phone.** A traced elevation at 375px wide is unreadable;
   a data-driven zone can reflow.

What B keeps is the thing that matters: **the same shapes in the same places at
the same relative sizes**, so the screen is recognisably the wall. Zone 1's two
tall end units read as tall end units. Zone 4's four big suites read as four big
suites.

If you want the drawing itself, the honest middle is a **"show blueprint"
toggle** that fades the real elevation in behind the tiles — orientation when
you want it, out of the way when you are working. Cheap to add once the geometry
is data. I would build that second, not first.

---

## 4. What a tile has to say

The hardest part of this screen is restraint. A tile is roughly 90 × 70px on
desktop and there are 41 of them.

**One colour, one name, one badge.**

- **Colour = state**, reusing the existing room statuses so nothing new is
  invented: Available (teal wash), Occupied (rust), Cleaning (gold), Maintenance
  (flat grey). Those are already in `ROOM_STATUSES` and `app/rooms/page.tsx`.
- **Name = the cat**, not the room. `Mochi`, with the room number small and
  secondary. Carers navigate by animal; the room number is how the system
  navigates.
- **One badge, and only when it is true**, in this priority order:
  1. health flag raised in today's care log (red)
  2. leaving today (gold)
  3. care not finished and it is past mid-afternoon (rust)
  4. arriving today, room still being prepared (grey)

Everything else — nights remaining, the owner's name, the diet, the tasks —
belongs in the room, not on the wall. A tile that tries to say five things says
nothing at ten feet, which is the distance this screen is actually read from.

**A thin progress strip along the bottom edge** of an occupied tile showing
today's care completion. It is one of the few extra signals that earns its
pixels, because it is the question the run sheet exists to answer and it makes
the wall answer "what is left today" without opening anything.

---

## 5. Time — the part a wall view forgets

A picture of the wall shows **now**. Boarding's real questions are mostly not
about now:

> Is 12 free next Tuesday? Who leaves tomorrow? Where do I put the Friday arrival?

So the wall gets a **date strip across the top** — today and the next thirteen
days, tap one and the wall repaints as that day: who will be in each room, which
rooms are free, which are turning over. Today is the default and is always one
tap away.

That is not decoration; it **merges `/rooms` and `/rooms/calendar` into one
screen**. The calendar stays for the two-week grid view — it is better for "show
me the shape of the month" — but the daily question stops needing a second page.

---

## 6. What clicking a room opens

Today `/rooms/[id]` is an **admin form** — name, type, capacity, status,
sort order. That is a settings page, and it is the wrong destination for a carer
who just tapped a cat.

The room view should open on the **stay**, with the settings demoted to a
"Room settings" link for managers:

- who is in it — cat, photo, owner, contact
- **today's care checklist**, tickable right there (the run sheet already
  generates these; this is the same tasks, in room context)
- AM / PM log buttons and any red flags raised
- feeding and medication from the cat's own record — the thing a carer needs
  and currently has to leave the page to read
- the stay: in, out, nights, deposit, what is owed
- check out → the existing checkout flow
- move this cat to another room

An empty room opens on the opposite: what is booked into it next, and a button
to put an unassigned arrival in it.

---

## 7. Data model

Two additions. Both additive, no rebuild of a live table.

```prisma
// A bank of cabinets, as drawn: 1区, 2区, 3区, 4区, and the staging cabinet.
// The wall is rendered zone by zone, in this order.
model RoomZone {
  id        String  @id @default(cuid())
  code      String  @unique   // "Z1" … matches 1区 on the drawing
  name      String            // "Feature wall", "Standard bank"
  kind      String  @default("Boarding") // Boarding | Staging
  cols      Int               // grid the zone is laid out on
  rows      Int
  sortOrder Int     @default(0)
  rooms     Room[]
}
```

```prisma
// on Room
zoneId   String?
zone     RoomZone? @relation(...)
gridCol  Int?      // 1-based column in the zone's grid
gridRow  Int?
colSpan  Int  @default(1)
rowSpan  Int  @default(1)   // 2 for Zone 1's tall end units and Zone 4's suites
```

CSS Grid renders that directly — `grid-column: <col> / span <colSpan>` — so the
wall is a dozen lines of layout code and no geometry lives in the source.

**Why not a JSON blob of coordinates on the zone?** Because a room's position is
a fact about that room, and Prisma can then answer "which room is at Z3 R2 C4"
without parsing anything. It also means the arrange-the-wall screen is an
ordinary form.

**Rooms with no zone still work.** They fall into an "Unplaced" strip under the
wall — which is exactly what you want during the transition, and what stops a
half-finished layout from hiding a room that has a cat in it. That failure mode
— a cat in a room the screen does not draw — is the one thing about this feature
that could actually hurt an animal, so the fallback is not optional.

**Staging cubbies** (`kind: 'Staging'`) render on the wall but never accept a
boarding booking. They are where a cat sits between arriving and its room being
ready, or between checkout and collection.

---

## 8. What happens to the four existing pages

| Page | Becomes |
|---|---|
| `/rooms` | **the wall** — the new boarding landing |
| `/rooms/[id]` | the **stay** view; room settings move behind a manager link |
| `/rooms/calendar` | unchanged — the two-week grid still answers a different question |
| `/runsheet` | unchanged — it is the task list; the wall links into it and vice versa |

Plus one new manager-only screen, `/rooms/layout`, to place rooms in zones.

Nav under Operations & Sales → Boarding becomes: **Boarding Wall**, Run Sheet,
Room Calendar, Rooms (settings). One line changed in `lib/nav-catalogue.ts`.

---

## 9. Phone, and paper

**Phone is the primary device on the floor.** 41 tiles do not fit. Zone tabs —
`Z1 · Z2 · Z3 · Z4 · Staging` — one zone at a time at full width, tiles big
enough to hit with a thumb. The date strip stays, scrolled horizontally.

**Paper matters more than it sounds.** Catteries print the day's wall and stick
it by the door. A print stylesheet that lays all zones on one A4 with cat names
and today's tasks is a genuinely used artefact, and it is nearly free once the
wall renders from data.

---

## 10. What could go wrong

**The mapping is the whole product.** If Room 12 is drawn where Room 14
physically is, a carer feeds the wrong cat — and unlike a wrong number in a
report, nobody notices. Mitigations:

1. Every tile shows the room's own number, small but always. The picture is a
   shortcut, never the only identifier.
2. Arranging the wall is a deliberate one-time act with a printed check: the
   layout screen offers "print this and walk the room".
3. The list view never goes away. It is faster for search, it is what a screen
   reader reads, and it is the fallback when the wall looks wrong.

**Second risk: the wall becomes a pretty page nobody works from** — because the
real work (ticking care tasks) still lives elsewhere. That is why §6 puts the
checklist *inside* the room view rather than linking out to the run sheet.

---

## 11. Build order

| Phase | Contents | Notes |
|---|---|---|
| 1 | `RoomZone`, the position columns, migration, `/rooms/layout` arrange screen | additive; nothing visible changes yet |
| 2 | Seed the five zones and 41 + 6 units from the drawing | needs Question 2 answered |
| 3 | The wall at `/rooms` — tiles, status colour, cat name, click through | the deliverable |
| 4 | The stay view at `/rooms/[id]`, with today's care checklist | where the value is |
| 5 | Date strip — the wall for any of the next 14 days | merges the daily calendar question |
| 6 | Phone layout, print sheet | |
| 7 | *Optional* — blueprint underlay toggle, drag-a-cat-between-rooms | only if wanted |

Each phase ships on its own and leaves the system working. `verify-boarding-wall`
covers: every active room appears exactly once, an unplaced room still appears,
a room with a checked-in cat shows that cat, the date strip shows a future
booking in the right room, and staging cubbies refuse a boarding booking.

---

## 12. Questions

1. **Is Zone 1 double-sided** — serviced from the back as well as the front
   (page 4 is its rear elevation)? If yes, does a unit have two doors, or is the
   back purely construction?
2. **Is 41 boarding units the real number?** The demo has 61 placeholder rooms.
   Is this drawing the whole room, or one phase?
3. **What are these units called on the floor?** The drawing has no numbers. Do
   you number them 1–41 continuously, or per zone (Z1-01, Z3-14)? Whatever gets
   painted on the actual doors is what the system should show.
4. **Zone 2's porthole units and Zone 4's big ones — do they price differently?**
   Right now every room is `Standard` at capacity 2 with 7 `Suite`s. The drawing
   suggests at least three tiers (single, porthole, suite) and two double-height
   units in Zone 1.
5. **Do the staging cubbies need to be on the wall at all**, or are they a back
   room detail nobody tracks?
6. **How many cats can actually share a unit?** `capacity` is 2 for everything
   today, which I doubt is right for Zone 3's singles or Zone 4's suites.

---

## As built (v1.3.0, on the demo)

Phases 1–6 are in, plus the arrange screen. Where the plan asked a question, the
build assumed an answer — each one reversible, each one still open:

| # | Question | Assumed |
|---|---|---|
| 1 | Zone 1 double-sided? | **No** — the rear elevation is treated as construction only. One unit, one door. |
| 2 | Is 41 the real number? | **Yes for the banks.** The demo's 61 rooms are *placed*, not replaced: 41 fill the drawing, 20 stay in the Unplaced strip. Nothing was deleted, so no booking was orphaned. |
| 3 | Numbering | **Left alone.** The seed places the existing `Room 01…` names rather than renaming anything — whatever is painted on the real doors should win, and I do not know what that is. |
| 4 | Pricing tiers | **Untouched.** `unitKind` is presentation only; it never decides price or bookability. |
| 5 | Staging on the wall | **Yes**, as a zone with `kind: 'Staging'` — drawn, but never counted as bookable capacity. |
| 6 | Capacity per unit | **Untouched.** |

### What changed

| Route | Now |
|---|---|
| `/rooms` | the wall — the boarding landing page |
| `/rooms/[id]` | the **stay**: who is in it, today's care tickable in place, feeding and medication, the balance |
| `/rooms/[id]/settings` | the old edit form, manager-only |
| `/rooms/list` | **redirects to `/rooms`.** The table is now an "All rooms" section at the bottom of the wall — same job, one tab, and one source for the counts |
| `/rooms/arrange` | new, manager-only: banks and unit positions |
| `/rooms/calendar`, `/runsheet` | unchanged |

Schema: `RoomZone`, plus `zoneId / gridCol / gridRow / colSpan / rowSpan /
unitKind` on `Room` — all nullable, so an unplaced room still renders.

### The units are drawn as the cabinets

`app/components/CabinetUnit.tsx` renders each unit with the anatomy from the
maker's elevation: cream carcass, slatted vent capsule, glass door with a centre
mullion and hinge circles, the grey arch, the pale-green litter tray, and the
grey panel + porthole on Zones 2 and 4. **Only the glass takes the status
colour** — the cabinet is constant furniture, which is how the wall reads in
life and stops shelf brackets competing with the one signal that must carry.

This is still drawn from data, not traced: `unitKind` picks the recipe, and
zone/col/row/span place it. The §3 argument stands.

### Verification

`verify-boarding-wall` — 22/22. The first two assertions are the ones that
matter: every active room appears on the wall exactly once, and an unplaced room
still appears. A cat in a room the screen does not draw is the only way this
feature could hurt an animal.

Also covered: the date strip repaints for a future day, a unit links to its
room, the room page opens on the stay rather than the settings form, settings
reject an invalid session, staging cubbies add nothing to bookable capacity
(measured as movement — add a cubby, count, flip it to Boarding, count again),
and the arrange screen refuses to put two rooms in one cell.

### Still to do

- The blueprint-underlay toggle (§3) and drag-a-cat-between-rooms (§11 phase 7).
- The print stylesheet (§9). The arrange screen tells you to print and walk the
  room; it will currently print the whole page chrome with it.
- Phone layout is responsive but not yet zone-tabbed (§9) — on a narrow screen
  each bank scrolls horizontally instead.
