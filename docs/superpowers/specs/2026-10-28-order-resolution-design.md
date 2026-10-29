# Order resolution: story 1 design

Status: approved 2026-10-28, then revised the same day against the evidence register
(`docs/EVIDENCE.md`). E-numbers cite rows in that register, and Q-numbers cite the open
interview questions.

## Why

> As a hub coordinator, when a grower's update changes my supply, I want to see which
> orders it breaks and fix them from the same screen, so every buyer has a correct
> order before the truck is packed.

**Evidence for the problem:**
- "Balancing supply and demand" was the top hub challenge in every national survey from
  2013 to 2019.
- Hubs resolve shortfalls with a routine: another member, then an outside source, then
  telling the buyer.
- They do it by phone, within hours.
- A hub that closed (FoodEx) could not see a farmer running out before a promised
  delivery.
- Platforms leave the fix to manual edits and phone calls.

**Evidence against it:** nobody has measured how often shorts happen or what they cost.
The market is about 300 small hubs with thin margins.

**Today the app stops at showing the impact.** The coordinator can approve a supply
change and see that Riverbend School Kitchen is now short, but then has to leave the app
to phone people and update a spreadsheet. This milestone moves that work into the app.
It finishes with a plan they can pack from.

**What success looks like in the demo:**
1. The coordinator approves the tomato cut and sees Riverbend go 60 lb short.
2. They ask Birch Hollow Gardens for more tomatoes, and ask Riverbend whether zucchini
   would do. Both messages come from checked templates. Muse Spark can redraft either
   one, with the same check.
3. They record the replies: Birch Hollow's by text, and Riverbend's as a phone call note.
4. They lock the plan and print a pick list for each grower and an order sheet for each
   buyer.
5. The overview shows what the day measured, for example: shortfalls caught before
   packing, and minutes from a grower's message to the buyer being told.

## Goals

1. **Every short order offers resolutions that are computed, not guessed** (E3, E4,
   E5). There are three:
   - **Ask for more.** The coordinator can ask any member grower or outside source
     listed in the hub's contacts. Growers who already hold a lot of the product come
     first.
   - **Offer the buyer a substitute** from unallocated supply.
   - **Tell the buyer the order will be short.**
2. **Consent comes in two forms** (E8, E9):
   - **Per order:** the buyer's recorded reply, either a quoted text or the
     coordinator's note of a call.
   - **Standing permission on file:** shown with where it came from. The planner
     already applies it without asking.
3. **Messages default to fixed templates** checked against the decision (E10, E11).
   - **Draft with Muse Spark** is an optional redraft that passes the same check.
   - Sending puts the message in an in-app outbox; nothing leaves the app (E13).
4. **Replies from growers:**
   - **A grower who has a lot:** the reply arrives in the review queue, linked to the
     request, and goes through normal review (E14).
   - **A grower or outside source with no lot:** the coordinator records the reply as
     a new confirmed lot, with the evidence (E5).
5. **Phone calls come in through the same door** (E1). **Log a call** turns the
   coordinator's note of a phone update into an inbox message that the model reads and
   the coordinator reviews.
6. **The coordinator locks the plan for packing** (E17, E18).
   - Unresolved orders block the lock, unless the coordinator chooses **Ship short**
     for them. That choice is recorded, and the sheets say the buyer was not told.
   - The lock lapses on any later change.
7. **The overview's "Needs your attention" list includes short orders,** with direct
   actions (E20).
8. **The app measures its outputs** (E24): shortfalls detected, how many were resolved
   before the lock and how, and minutes from a grower's message to the buyer's notice.
9. **The demo uses pounds and cases** (E23).

## Non-goals (this milestone)

- **Real delivery** by SMS, WhatsApp, email or a buyer portal (E13).
- **Surplus actions** (E21). These are deferred for time, not because surplus matters
  less.
- **Model reading of buyer replies.** The coordinator records them.
- **Commercial features:** credits, prices, invoices and routes (E6). The order sheet
  shows the short, so a credit can follow.
- **Standing consent across weeks.** The demo has one delivery day, and standing
  permission lives on the order.
- **Hosting fixes.** Authentication and per-visitor sandboxes remain the hosting
  blockers recorded in STATUS.

## Anti-goals (a failure even if it "works")

- A sent message states a quantity, product or date that is not in the decision, and
  nobody was warned.
- Any action notifies someone, reserves stock or changes an order without a named
  coordinator action.
- A substitute is used without the buyer's recorded consent or a standing permission
  on file.
- A locked plan looks valid after the supply under it has changed.
- A buyer is shipped short silently. Ship short must be chosen and recorded, and the
  buyer's sheet must say they were not told.
- Resolution logic lives in the UI.

## Constraints from the existing code

- **The planner** allocates by priority, then ID (E15, an assumption). It uses only
  substitutes listed in `approvedSubstitutions`, and `verifyPlan` re-checks every
  allocation. This milestone keeps all of that, and the UI states the rule.
- **The ledger** is the only path that changes the snapshot. Every change bumps the
  version, so any open review goes stale.
- **Workbench actions** are pure state transitions with a decision history. The store
  saves them with compare-and-swap.
- **Live model calls** are capped by `HARVEST_LIVE_CALLS`. Paid calls need the user's
  approval. The demo replays recorded output.

## Design

### Units: pounds

- `lb` is a supported unit, with its own base unit `lb`.
  - Pounds and grams are different base units, so a kg update to a lb lot asks for
    clarification. This follows the existing rule that counts are not converted to
    weight.
  - Amounts stay whole numbers. A fractional amount such as "12.5 lb" asks for
    clarification, as it already does for kg.
- A case's pack contents may be given in lb.
- **The model prompt** gains `lb` in its unit lists and schema enums, which makes it
  `PROMPT_VERSION` v4. The seed readings must then be re-recorded; that needs approval.
- **The evaluation scenario** (`evaluation/scenario.ts`) stays in kg, so existing tests
  and evaluations remain comparable.
- **The demo** uses its own lb snapshot (`src/demo.ts`). Every amount from the kg
  scenario is doubled and stated in lb:

  | Lots | Orders |
  |---|---|
  | lot-a tomato 120 lb | order-a 120 lb |
  | lot-b tomato 80 lb | order-b 80 lb |
  | lot-c cucumber 40 lb | order-c cucumber 60 lb, standing zucchini permission |
  | lot-d zucchini 0 lb | |

- **Demo messages** become:
  - "Only 60 lb of standard tomatoes for Friday, replacing the earlier 120 lb total."
  - Zucchini: four cases, with the reply "That's the whole lot, 10 lb in each case."
  - Cucumbers: another four cases, with the reply "6 lb in each."
  - A forecast of 20 lb of zucchini.
  - The injection message asks for 1000 lb.

### Contacts

The demo's contacts (`src/demo.ts`) list each grower and outside source:

```ts
type Contact = { id: string; name: string; kind: "member" | "outside" };
```

| ID | Name | Kind |
|---|---|---|
| grower-a | Alder Creek Farm | member |
| grower-b | Birch Hollow Gardens | member |
| grower-c | Cedar Row Farm | member, with no lots this week |
| outside-1 | Valley Produce Wholesale | outside |

The domain keeps IDs. Names come from the contacts list.

### Ledger additions (`src/orders.ts`, pure)

`Ledger.records: LedgerRecord[]` holds changes the coordinator records from a reply:

```ts
type Evidence = { messageId: string; channel: "text" | "call"; quote: string };
type LedgerRecord =
  | { id: string; kind: "substitute-accepted"; orderId: string; substitute: { product: string; acceptedGrades: string[] }; evidence: Evidence; recordedBy: string; beforeHash: string; afterHash: string }
  | { id: string; kind: "lot-added"; lot: Lot; evidence: Evidence; recordedBy: string; beforeHash: string; afterHash: string };
```

- `acceptSubstitute(...)` adds the substitute to the order's `approvedSubstitutions`.
- `addLot(...)` adds a confirmed lot.
- Both bump `snapshot.version` and the ledger version, so the planner sees the change
  and open reviews go stale (E16).
- **Where a permission came from:** an `approvedSubstitutions` entry with no matching
  record is "on file". One with a record is "agreed" on that date, by text or call.

**Shortages and options.** `shortages(l)` derives each short order from the plan, and
`options(l, orderId, contacts)` returns only feasible actions, in this order:

1. **Ask a grower who holds a lot.** Growers with a lot of the product in an accepted
   grade, on the same date and unit, ask for the full shortfall. The option is marked
   `reducedRecently` if that lot's last change lowered it.
2. **Ask a contact with no lot.** Other member growers come next, then outside sources.
   These are marked `hasLot: false`. A yes is recorded as a new lot.
3. **Offer a substitute.** This uses unallocated confirmed supply of another product
   that the order does not already allow, on the same date and unit, and covers at
   most the shortfall (E7, an assumption).
4. **Tell the buyer the order will be short.** This is always offered.

### Resolutions (`src/resolve.ts`) and the outbox

```ts
type Resolution = { id; orderId; kind: "ask-grower" | "offer-substitute" | "notify-short";
  facts: MessageFacts; text; draftedBy; check; fallback?; status: "drafted" | "sent" | "accepted" | "declined";
  messageId?; reply?: { channel: "text" | "call"; text: string; quote: string }; linkedItemId?; decisions: Decision[] };
```

**When an ask-grower is resolved:**
- **The grower holds a lot:** when the reply's linked inbox item is approved or
  dismissed.
- **The grower or source has no lot:** when the coordinator records a yes as a new lot
  (`recordSupplyReply`), or records a no.

**An offer** is resolved when the buyer's answer is recorded, either as a quoted text
or as a call note. If the buyer accepts, `acceptSubstitute` runs.

**A notice** is resolved once it is sent. The order shows "buyer told" for that amount.
If the shortfall later grows, the order is short again.

**Recording a call:** the call note itself is the evidence. It must be non-empty and
under 500 characters, and its quote is the whole note.

### Messages: templates first, Muse Spark optional, one checker

- **`MessageFacts`** holds exactly what a message may say: the recipient, the product,
  the substitute, the amount, the unit and the delivery day.
- **`template(facts)` is the default draft.** It always passes the checker.
- **`checkDraft(text, facts, knownProducts)` is deterministic.** It extracts every
  quantity, unit, weekday, date and known product name. It fails when:
  - any of them is not in the facts;
  - the product, amount or day is missing;
  - the text is empty or over 480 characters.

  Number words are refused, which keeps the checker simple.
- **Draft with Muse Spark** (prompt `draft-v1`):
  - It uses the recorded draft when the facts' digest matches the recording, or a live
    call within the allowance.
  - A draft that fails the check is discarded, and the template is kept, labelled with
    the reason.
- **Coordinator edits are re-checked** (E12):
  - A mismatch shows each problem by name next to the text, rather than a generic
    "check carefully" message (from the evidence on automation bias). It warns but does
    not block.
  - An empty text or the length limit blocks.
- **The outbox** records `{ id, to, text, draftedBy, sentBy, sentAt }`. The UI says
  "Recorded as sent (demo: not delivered)".

### Log a call

`logCall(w, growerId, note, actor, at)` receives a Source with ID `call-${n}` and the
coordinator's note as its text, marked as a call. It then goes through the normal
reading and review.

The reading prompt is unchanged: the model reads the note like any message. The
evidence quote is the coordinator's own words, and the review screen labels it
"Call note by <actor>".

### Packing lock

`lockPlan(w, by, at, { shipShort })` stores
`{ snapshotHash, snapshot, plan, lockedBy, at, shippedShort }`.

**The gate:**
- **Blocks:** each unresolved short order, unless `shipShort` is true. When it is, each
  of them goes into `shippedShort` as `{ orderId, amount, buyerTold: false }`.
- **Warns but does not block:** open inbox items.

**Lapse:** the lock is valid only while `snapshotHash` matches the live snapshot.
Otherwise the UI shows "Plan changed after locking. Review and lock again", and the
sheets are hidden.

**The sheets** are pure functions of the lock:
- a pick list per grower;
- an order sheet per buyer, with substitute lines, the shortfall, and "Shipped short:
  buyer not told" where it applies.

### Measures (`src/measures.ts`)

`measures(w)` returns:
- `shortsDetected`: distinct orders that were ever short this cycle, taken from the
  resolutions, plus orders short now.
- `resolvedBy`: counts for grower, substitute, notice and ship-short.
- `minutesToBuyerNotice`: for each order whose buyer got a notice or offer, the minutes
  from the grower message that caused the short to the send. The cause is the
  `receivedAt` of the item whose approval first made the order short.

The overview shows these under the heading "This delivery day". Nothing is claimed
beyond them (E24).

### UI

- **Overview:**
  - **"Needs your attention"** lists short orders first, each with **Resolve**, then
    inbox items.
  - **"This delivery day"** shows the measures.
  - The header gains a **Log a call** button.
- **Orders tab:**
  - **Left:** each order with its status.
  - **Centre:**
    - what the order wants against what it gets;
    - its substitute permissions, with where each came from;
    - option cards, grouped as "Growers with this product", "Other growers and
      sources" and "Substitute" or "Tell the buyer";
    - the order's thread and history;
    - the allocation rule, in small text.
  - **Right:** the draft panel:
    - the template text, labelled "Template";
    - **Draft with Muse Spark**;
    - an editable textarea, with named check problems;
    - **Send**, marked "Recorded as sent (demo: not delivered)".
  - **After sending:**
    - **For an offer:** record the buyer's reply as a text (paste it and quote the
      relevant part) or as a call note, then accept or decline.
    - **For a grower with a lot:** **Receive the grower's reply (demo)**, which links to
      the review item.
    - **For a contact with no lot:** record a yes with quantity and grade as a new lot,
      or record a no.
- **Pack tab:**
  - the gate checklist;
  - a **Ship short** checkbox, shown only when something is unresolved;
  - **Lock plan for packing**;
  - the sheets, with print styles and a lapsed banner.

### Demo script

**Precondition, in demo order.** In the app, press **Reset demo**, then run
`HARVEST_DEV=1 node scripts/demo-precondition.ts`, which approves these three with hand readings:
1. Cucumber approved after its reply: 64 lb, so the community pantry's order is covered
   without zucchini.
2. Zucchini approved after its reply: 40 lb, all unallocated.
3. The tomato cut approved: Riverbend is 60 lb short.

**Steps:**
1. Ask Birch Hollow Gardens for 60 lb, from the template, and send.
2. Birch Hollow replies "We can bring another 30 lb of standard tomatoes Friday." This
   is a recorded reading. Approve it, and Riverbend is 30 lb short. The recorded reading
   lives in `data/demo-extras.json`, which needs the paid recording awaiting approval.
   Without it, the reply arrives unread and the coordinator reads and approves it in Review.
3. Offer zucchini to Riverbend. Optionally redraft it with Muse Spark, then send.
4. Record Riverbend's answer as a call note: "Called kitchen manager, zucchini is fine
   for the rest." Riverbend is now covered, with 10 lb of zucchini left over.
5. Lock the plan and print the sheets.

**Buyers:** buyer-c becomes "Eastside Community Pantry", with standing zucchini
permission on file (E22).

**Model budget, which needs approval:**

| Calls | For |
|---|---|
| 7 | re-recording the seed readings at v4 |
| 1 | the reading of Birch Hollow's reply |
| 2 | optional drafts |
| up to 10 | an lb check on v4 |

That is about 20 calls, roughly $0.08.

## Testing

**Unit tests** (node:test) for:
- the lb unit;
- options, including contacts with no lot and outside sources;
- `addLot` and `acceptSubstitute`, and how they stale open reviews;
- call-note evidence;
- resolution transitions;
- `checkDraft` cases;
- the lock: the gate, ship short, and lapse;
- sheets that add up to the locked plan;
- measures.

**End to end:** one domain test of the whole demo story, plus a browser walk-through
with screenshots.

## Left to the builder

The layout spacing, the copy within the existing voice, the internal module split, and
the template wording.
