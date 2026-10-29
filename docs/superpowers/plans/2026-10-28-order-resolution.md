# Order Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a hub coordinator resolve short orders inside the app, and lock a plan
they can pack from. The coordinator can:
- ask a member grower or an outside source for more;
- offer the buyer a substitute;
- tell the buyer the order will be short.

Consent and replies are recorded with evidence. Measured outputs are shown, and the demo
runs in pounds and cases.

**Architecture:**
- **Pure domain modules:** `demo`, `orders`, `messages`, `draft`, `resolve`, `pack`
  and `measures`. Each is a function from state to state, like the existing ledger and
  workbench.
- **The ledger gains `records`** for changes the coordinator records from replies:
  accepted substitutes and added lots. The planner and the staleness rules apply
  unchanged.
- **The Next.js server actions** wrap these through the existing `act()`
  compare-and-swap. There are two new pages: Orders and Pack.

**Tech Stack:**
- Node 24 running TypeScript directly; `node:test`; `tsc --noEmit`.
- Next.js 16.4.3 and React 19.3.1, with server actions.
- `node:sqlite`.
- Meta Model API (`muse-spark-1.3`).

**Spec:** `docs/superpowers/specs/2026-10-28-order-resolution-design.md`. The evidence
behind it is in `docs/EVIDENCE.md`, which cites rows E1–E24 and questions Q1–Q15.

## Global Constraints

- **Model settings:** every call uses `DEMO_SETTINGS` from `src/seed.ts`
  (`reasoningEffort: "minimal"`, `maxCompletionTokens: 2000`).
- **Prompt versions:** the reading prompt becomes `v4` (v3 plus pounds). The draft
  prompt is `draft-v1`.
- **No real delivery.** "Send" records to an outbox, and the UI says "Recorded as sent
  (demo: not delivered)".
- **No action notifies, reserves or changes an order without a named coordinator
  action.** Substitutes are allocated only with `approvedSubstitutions`: either on file,
  or added by `acceptSubstitute` from a recorded reply.
- **Shipping short must be chosen and recorded.** It is never silent.
- **Drafts:** at most 480 characters, with digits rather than number words.
- **Model calls:** none live in tests or the build. Recording and evaluation calls need
  the user's explicit budget approval, estimated at about 20 calls.
- **Never print the API key.** Load it only with
  `node --env-file=$HOME/.config/harvest-relay/meta.env`.
- **Commits:**
  - No Claude attribution trailers.
  - No personal names in tracked files.
  - Run the personal-name check (pattern kept outside the repo) before pushing.
- **Citations:** every new user-facing rule cites its E-row in a code comment, where the
  rule is not obvious.
- **Done means all of these pass:** `npm test`, `npm run typecheck`,
  `npx tsc --noEmit -p tsconfig.app.json` and `npx next build`.

## Review Focus

1. **The shortfall grows after the buyer was told** (told 30 lb, then a cut makes it
   50 lb). The order is short again, and the lock gate blocks. Tested in Task 7.
2. **A reply is recorded on an unsent or already-answered resolution.** It is refused,
   and the state is unchanged. Tested in Task 7.
3. **The same substitute is accepted twice, or one the order already allows.** It is
   refused, with no duplicate permission. Tested in Task 3.
4. **The plan changes after locking.** The lock reads lapsed, and no sheets come from
   it. Tested in Task 8.
5. **A call note or draft is empty, or over the limit.** It is refused. Tested in
   Task 7.

---

### Task 1: Pounds as a unit, and prompt v4

**Files:**
- Modify: `src/quantity.ts`:
  - `BaseUnit = "g" | "lb" | "each"`;
  - `Quantity.unit` adds `"lb"`;
  - `normalize` maps `lb` to `{amount, unit:"lb"}`;
  - a pack unit may be `"lb"`.
- Modify: `src/interpret.ts`:
  - `UNITS` and `PACK_UNITS` add `"lb"`.
  - Add `PROMPTS.v4`: v3 with each "Use only units g, kg, each or case" line changed to
    "Use only units g, kg, lb, each or case. Write pounds (lb, lbs, pound, pounds) as
    lb.", and pack contents "in g, kg, lb or each".
  - `PROMPT_VERSION = "v4"`.
  - `REPLY_PROMPT` adds lb the same way.
  - `grams()` passes `lb` through unchanged.
- Modify: `app/lib/format.ts`. `weight(amount, unit)` gains `"lb"` and returns
  `${amount} lb`.
- Modify: `app/actions.ts`. Its `value()` regex accepts `lb|lbs`, normalised to `lb`.
- Test: `tests/quantity.test.ts` (new) and `tests/interpret.test.ts`.

**Interfaces:**
- Produces: `BaseUnit` including `"lb"`. Every later task uses lb in the demo and the
  messages.

- [ ] **Step 1: Write failing tests.**
  - `normalize({amount:30, unit:"lb"})` deep-equals `{amount:30, unit:"lb"}`.
  - `normalize({amount:4, unit:"case", pack:{amount:10, unit:"lb"}})` is
    `{amount:40, unit:"lb"}`.
  - `reviewUpdate` of a kg quantity against a lb lot raises a `unit` question.
  - `responseSchema` includes `"lb"` in the quantity unit enum.
  - Replaying a v4 reading with `{amount:30, unit:"lb"}` returns `proposed`.
- [ ] **Step 2: Run** `node --test tests/quantity.test.ts tests/interpret.test.ts`. It
  should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npx tsc --noEmit -p tsconfig.app.json`.
  - Fix any `BaseUnit` exhaustiveness errors in the app, for example the `weight()`
    callers.
  - Existing v3 tests that assert `PROMPT_VERSION` text update to v4.
- [ ] **Step 5: Commit:** `git commit -m "Support pounds as a unit; reading prompt v4"`.

### Task 2: Demo hub in pounds, with contacts

**Files:**
- Create: `src/demo.ts`:
  - `demoSnapshot(): Snapshot`, in lb. The values are fixed by the spec's Units table.
    - Orders: order-a 120 lb, priority 2; order-b 80 lb; order-c cucumber 60 lb, with
      `approvedSubstitutions` zucchini standard.
    - Lots: lot-a tomato 120 lb; lot-b tomato 80 lb; lot-c cucumber 40 lb; lot-d
      zucchini 0 lb. All are standard grade, for 2026-10-30, and confirmed.
  - `type Contact = { id: string; name: string; kind: "member" | "outside" }`
  - `CONTACTS: Contact[]`, from the spec's Contacts table.
  - `BUYERS: Record<string,string>`: buyer-a "Northside Grocery Co-op", buyer-b
    "Riverbend School Kitchen", buyer-c "Eastside Community Pantry".
- Modify: `src/seed.ts`:
  - `SEED` uses the spec's lb messages and replies.
  - `seedWorkbench` uses `demoSnapshot()`.
- Modify: `app/lib/format.ts`. `grower()` and `buyer()` read `CONTACTS` and `BUYERS`.
- Test: `tests/demo.test.ts` (new).

**Interfaces:**
- Produces: `demoSnapshot`, `CONTACTS`, `BUYERS` and `Contact`.

- [ ] **Step 1: Write failing tests.**
  - `validateSnapshot(demoSnapshot())` passes.
  - `proposeAllocations(demoSnapshot()).unfilled` deep-equals
    `[{orderId:"order-c", amount:20, unit:"lb", …}]`. That is cucumber 60 against
    40 lb, with no zucchini yet.
  - `seedWorkbench(undefined)` has 5 items, all without a proposal.
  - Every `SEED` text contains "lb" or "cases".
- [ ] **Step 2: Run** `node --test tests/demo.test.ts`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Demo hub in pounds and cases, with grower and outside contacts"`.

### Task 3: Ledger records for accepted substitutes and added lots

**Files:**
- Modify: `src/updates.ts`:
  - `Ledger.records: LedgerRecord[]`.
  - `createLedger` initialises it.
  - `commitUpdate` carries it through; its final `structuredClone` drops unknown keys.
  - Export `Evidence` and `LedgerRecord`, in the spec's shapes.
- Create: `src/orders.ts`
- Test: `tests/orders.test.ts`

**Interfaces:**
- Produces:
  - `acceptSubstitute(l: Ledger, orderId: string, substitute: {product: string; acceptedGrades: string[]}, evidence: Evidence, recordedBy: string): Ledger`
  - `addLot(l: Ledger, lot: Lot, evidence: Evidence, recordedBy: string): Ledger`
  - `permissionSource(l: Ledger, orderId: string, product: string): { kind: "on-file" } | { kind: "agreed"; record: LedgerRecord }`
  - Record IDs are `record-${n}`. Each call adds 1 to `l.version` and to
    `snapshot.version`.

- [ ] **Step 1: Write failing tests.** Use `scenario()` (kg) with `shortage()`
  approved.
  - **acceptSubstitute**, called with order-b, zucchini standard,
    `{messageId:"in-1", channel:"call", quote:"Zucchini is fine"}` and
    "Hub coordinator":
    - the order's permissions include zucchini;
    - `records.length` is 1;
    - the version is the old version + 1;
    - the input is deep-unchanged.
  - **It throws** for:
    - a second identical call: `/already allowed/`;
    - `"order-x"`: `/Unknown order/`;
    - an empty quote: `/quote/`;
    - the order's own product: `/own product/`.
  - **addLot** with
    `{id:"lot-e", growerId:"grower-c", product:"tomato", grade:"standard", quantity:{amount:10, unit:"kg"}, deliveryOn:"2026-10-30", confirmed:true}`:
    - adds the lot;
    - `shortages` falls by 10 kg (assert through `proposeAllocations(...).unfilled`).
  - **addLot throws** for a duplicate lot ID: `/Duplicate lot/`.
  - **permissionSource:**
    - order-c / zucchini gives `on-file`;
    - order-b / zucchini, after accepting, gives `agreed`.
  - **commitUpdate** keeps `records`.
- [ ] **Step 2: Run** `node --test tests/orders.test.ts`. It should fail.
- [ ] **Step 3: Implement.**
  - Clone the snapshot, change it, bump `snapshot.version`, then `validateSnapshot`.
  - Record `beforeHash` and `afterHash`.
  - Trim the quote to at most 500 characters. `recordedBy` is at most 160 characters.
  - `channel` must be `text` or `call`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Record accepted substitutes and added lots as ledger records"`.

### Task 4: Shortages and feasible options

**Files:**
- Modify: `src/orders.ts`
- Test: `tests/orders.test.ts`

**Interfaces:**
- Consumes: `proposeAllocations`; `normalize` and `BaseUnit`; `Contact` (Task 2).
- Produces:
  - `type Shortage = { orderId: string; buyerId: string; product: string; deliveryOn: string; unit: BaseUnit; short: number }`
  - `shortages(l: Ledger): Shortage[]`, sorted by `orderId`.
  - `type Option =`
    - `| { kind: "ask-grower"; contactId: string; hasLot: true; lotId: string; amount: number; unit: BaseUnit; reducedRecently: boolean }`
    - `| { kind: "ask-grower"; contactId: string; hasLot: false; contactKind: "member" | "outside"; amount: number; unit: BaseUnit }`
    - `| { kind: "offer-substitute"; product: string; grade: string; covers: number; unit: BaseUnit }`
    - `| { kind: "notify-short"; amount: number; unit: BaseUnit }`
  - `options(l: Ledger, orderId: string, contacts: Contact[]): Option[]`
    - Ordered as: has-lot asks (by lot ID), then members with no lot, then outside
      sources, then substitutes, then notify.

- [ ] **Step 1: Write failing tests.** Use `scenario()` with `shortage()` approved, and
  contacts grower-a, grower-b, grower-c (member) and outside-1 (outside).
  - `shortages` deep-equals
    `[{orderId:"order-b", buyerId:"buyer-b", product:"tomato", deliveryOn:"2026-10-30", unit:"g", short:30000}]`.
  - **Has-lot asks:**
    - grower-a / lot-a has `reducedRecently: true`;
    - grower-b / lot-b has `reducedRecently: false`;
    - both have amount 30000.
  - **No-lot asks:**
    - grower-c with `hasLot: false, contactKind: "member"`;
    - outside-1 with `contactKind: "outside"`.
  - **Substitute:** none, because zucchini is 0.
  - **The last option** is `{kind:"notify-short", amount:30000, unit:"g"}`.
  - **After `surplus(l, true)` is approved:**
    `{kind:"offer-substitute", product:"zucchini", grade:"standard", covers:20000, unit:"g"}`
    is present.
  - **After accepting zucchini:** order-b is short 10000, with no zucchini offer.
  - **A covered order:** `options(l, "order-a", contacts)` is `[]`.
- [ ] **Step 2: Run** `node --test tests/orders.test.ts`. It should fail.
- [ ] **Step 3: Implement.**
  - `reducedRecently` is true when the lot's latest non-forecast `UpdateEvent` has
    `lotAfter` below `lotBefore`.
  - Substitutes come from `plan.unallocated` that is confirmed, on the same date and
    unit, with a product that is neither the order's nor already allowed. They are
    grouped by product and grade, and `covers = min(short, sum)`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Derive short orders and options across growers, outside sources and substitutes"`.

### Task 5: Message facts, templates and the checker

**Files:**
- Create: `src/messages.ts`
- Test: `tests/messages.test.ts`

**Interfaces:**
- Produces:
  - `type MessageFacts = { kind: "request" | "offer" | "notice"; to: { kind: "grower" | "buyer"; id: string; name: string }; product: string; substitute?: string; amount: number; unit: BaseUnit; deliveryOn: string }`
  - `type Check = { ok: boolean; problems: string[] }`
  - `checkDraft(text: string, f: MessageFacts, knownProducts: string[]): Check`
  - `template(f: MessageFacts): string`
  - `factsDigest(f: MessageFacts): string`
  - `display(amount: number, unit: BaseUnit): string`
- **Display rule:**
  - `lb` shows as `N lb`;
  - `g` shows as kg (`30000` becomes `30 kg`, and `15500` becomes `15.5 kg`);
  - `each` shows as `N each`.
  - The day is the UTC weekday name of `deliveryOn`.

- [ ] **Step 1: Write failing tests.** Use facts
  `{kind:"offer", to:{kind:"buyer", id:"buyer-b", name:"Riverbend School Kitchen"}, product:"tomato", substitute:"zucchini", amount:30, unit:"lb", deliveryOn:"2026-10-30"}`
  and products `["tomato","cucumber","zucchini"]`.
  - `checkDraft(template(f), f, P).ok` holds for each of request, offer and notice.
  - "Could you take 30 lb of zucchini instead of tomatoes on Friday?" is ok.
  - "30lbs" is ok.
  - A kg-unit facts object with "15kg" is ok.
  - Each of these fails, and its problem matches the pattern given:

    | Text change | Problem pattern |
    |---|---|
    | `40 lb` | `/40 lb/` |
    | `30 kg` | `/30 kg/` |
    | `Thursday` | `/Thursday/` |
    | mentions `cucumbers` | `/cucumber/` |
    | no amount | `/amount/` |
    | `thirty pounds` | `/number in words/` |
    | a bare `2 cases` | `/2/` |
    | `October 29` | `/October 29/` |
    | 481 characters | `/480/` |
    | `""` | `/empty/` |

  - `factsDigest` is stable across key order, and changes with `amount`.
- [ ] **Step 2: Run** `node --test tests/messages.test.ts`. It should fail.
- [ ] **Step 3: Implement the checker.**

```ts
// Every quantity, day, date and product in the text must come from the facts (E11), and
// the product, amount and day must all appear. Number words are refused outright.
const WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|dozen|half)\b/i;
// quantities: /(\d+(?:\.\d+)?)\s*(kg|kilos?|kilograms?|g|grams?|lbs?|pounds?|each)\b/gi → (amount, base unit); kg→g ×1000; must equal (f.amount, f.unit)
// any other digit run left after removing quantities and allowed dates → problem naming it
// weekdays: every /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i must equal the delivery weekday; at least one required
// month-day dates (/\b(January|…|December)\s+\d{1,2}\b/, /\d{4}-\d{2}-\d{2}/) must equal deliveryOn
// products: each known product matched as /\bstem(e?s)?\b/i must be f.product or f.substitute;
//   required: f.substitute for offers, f.product otherwise
```

  - **Templates** (exact copy):
    - **request:** `Hi ${name}, could you bring another ${qty} of ${product} for ${Day}? Reply with how much you can do. Thanks!`
    - **offer:** `Hi ${name}, we're ${qty} short on ${product} for ${Day}. Would ${substitute} work for that ${qty}? Reply yes or no.`
    - **notice:** `Hi ${name}, your ${product} order for ${Day} will be ${qty} short. We're sorry for the change.`
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Add message facts, templates and the draft fact checker"`.

### Task 6: Optional Muse Spark drafting

**Files:**
- Modify: `src/interpret.ts`. Export
  `chat(request: ChatRequest, o: InterpretOptions): Promise<{ raw: string; usage?: Usage } | Failure>`,
  which honours `o.enabled` and the budget. Also export `Failure`.
- Create: `src/draft.ts`
- Test: `tests/draft.test.ts`

**Interfaces:**
- Consumes: Task 5; `replay`, `DEMO_MODEL` and `DEMO_SETTINGS`.
- Produces:
  - `DRAFT_PROMPT_VERSION = "draft-v1"`
  - `buildDraftRequest(f, model, maxCompletionTokens, effort): ChatRequest`
    - Uses `response_format` json_schema `{text: string}`, strict.
    - The user content is only `JSON.stringify({ ...f, day, quantity })`.
  - `type Draft = { text: string; by: string; check: Check; fallback?: string; usage?: Usage }`
  - `templateDraft(f: MessageFacts, knownProducts: string[]): Draft`, with
    `by: "Template"`.
  - `draftMessage(f, knownProducts, o: InterpretOptions, label: string): Promise<Draft>`
    - It never throws on model failure.
    - On any failure, it returns `templateDraft` with a `fallback` reason.
- **System prompt** (exact): `You write one short, plain, friendly text message from a small food hub coordinator. Use only the facts given: the recipient name, product, substitute if any, quantity and day. Write quantities with digits and units exactly as given. Do not promise prices, delivery times or anything not in the facts. Return JSON {"text": "..."}.`

- [ ] **Step 1: Write failing tests,** using
  `replay('{"text":"Hi Riverbend School Kitchen, could you take 30 lb of zucchini for Friday instead of tomatoes?"}')`:
  - The result has `by === label` and `check.ok`.
  - A reply with `40 lb` returns `by === "Template"` and a `fallback` matching
    `/40 lb/`.
  - `enabled:false` returns the template, with a fallback matching `/disabled|off/`.
  - A throwing transport returns the template.
  - The serialised request contains no `buyer-a` and no `priority`.
- [ ] **Step 2: Run** `node --test tests/draft.test.ts`. It should fail.
- [ ] **Step 3: Implement.** Parse `raw` as JSON with a string `text` of at most 2000
  characters. Anything else counts as a failure.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Optional Muse Spark redraft behind the fact checker"`.

### Task 7: Resolutions, replies, the outbox and Log a call

**Files:**
- Modify: `src/workbench.ts`:
  - `Workbench` gains `resolutions: Resolution[]`, `outbox: OutboxMessage[]`,
    `lock?: Lock` (a type-only import from `pack.ts`) and `calls: number`.
  - `createWorkbench` initialises them.
  - `InboxItem` gains `requestId?: string`.
  - Export `stamp` and `text` for reuse.
- Create: `src/resolve.ts`
- Test: `tests/resolve.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6; `receive` and `preview`.
- Produces:
  - **Types:**
    - `Resolution`, as in the spec. IDs are `res-${n}`.
    - `ResolutionDecision = { at; actor; kind: "drafted" | "redrafted" | "edited" | "sent" | "reply-recorded" | "grower-replied" | "supply-recorded"; note? }`
    - `OutboxMessage = { id: "out-${n}"; resolutionId; to; text; draftedBy; sentBy; sentAt }`
  - `factsFor(w, orderId, option: Option, names: Record<string,string>): MessageFacts`
  - `startResolution(w, orderId, option, facts, draft: Draft, actor, at): Workbench`
    - Refuses when the order is not short, or the option is no longer offered.
  - `redraft(w, resId, draft: Draft, actor, at)`. Only while drafted.
  - `editDraft(w, resId, text, actor, at)`
    - An empty text or more than 480 characters throws.
    - Other problems are stored in `check`.
  - `sendMessage(w, resId, actor, at)`. Requires `drafted`, and appends to the outbox.
  - `recordBuyerReply(w, resId, reply: { channel: "text" | "call"; text: string; quote?: string; accept: boolean }, actor, at)`
    - Requires a sent offer.
    - **Text:** the quote is required and must be a substring of the text.
    - **Call:** the note is the evidence, and the quote is the note.
    - The reply gets ID `in-${n}`.
    - Accepting calls `acceptSubstitute`.
  - `receiveRequestedReply(w, resId, source: Source, at)`. Requires a sent has-lot
    ask, calls `receive`, and links the item both ways.
  - `recordSupplyReply(w, resId, reply: { channel; text; quote?; yes: boolean; amount?: number; grade?: string }, actor, at)`
    - Requires a sent no-lot ask.
    - A yes calls `addLot`, with lot ID `lot-${contactId}-${n}`, the order's product,
      date and unit, `confirmed: true`, and `growerId` set to the contact.
    - The status becomes `accepted` for a yes and `declined` for a no.
  - `logCall(w, growerId, note, actor, at)`. Calls `receive` with
    `{id: "call-${calls+1}", revision: 1, growerId, text: note}`, then increments
    `calls`.
  - `type OrderStatus = "covered" | "short" | "resolving" | "buyer-told" | "substitute-agreed"`
  - `orderStatus(w, orderId): OrderStatus`

    | Status | When |
    |---|---|
    | `covered` | not short |
    | `substitute-agreed` | not short, and an accepted offer helped |
    | `buyer-told` | short, and a sent notice's amount is at least the shortfall |
    | `resolving` | short, with an open resolution: drafted, or sent and not yet answered |
    | `short` | otherwise |

    A has-lot ask is no longer open once its linked item is approved or dismissed.
  - `unresolved(w): string[]`. The orders whose status is `short` or `resolving`.

- [ ] **Step 1: Write failing tests.** Use the demo snapshot. Approve cucumber (from
  its reply), zucchini and the tomato cut with `propose()` readings, so that order-b is
  60 lb short.
  1. Start an ask to grower-b (has a lot, 60 lb) and send it. The outbox has 1 message,
     and the status is `resolving`.
  2. `receiveRequestedReply` with
     `{id:"msg-tomato-more", revision:1, growerId:"grower-b", text:"We can bring another 30 lb of standard tomatoes Friday."}`.
     - The item's `requestId` is `res-1`.
     - Approving the add-quantity of 30 lb leaves order-b 30 lb short.
  3. Offer zucchini, which covers 30 lb, and send it. Then
     `recordBuyerReply({channel:"call", text:"Called kitchen manager, zucchini is fine for the rest.", accept:true})`.
     - The status is `substitute-agreed`, and `unresolved` is `[]`.
     - `permissionSource` is `agreed`, with channel `call`.
  4. **A no-lot ask:** on a fresh short state, ask outside-1 and send. Then
     `recordSupplyReply({channel:"text", text:"Yes, 20 lb Friday", quote:"20 lb", yes:true, amount:20, grade:"standard"})`.
     A new lot exists, and the shortfall falls by 20.
  5. **Review Focus 1:** a sent notice of 30 lb, then a cut that makes the shortfall
     50 lb. The status is `short`.
  6. **Review Focus 2:** a reply on a drafted offer throws `/not been sent/`. A second
     reply throws `/already/`. The state is unchanged in both.
  7. **Review Focus 5:**
     - `editDraft` with `""` throws `/empty/`, and with 481 characters throws `/480/`.
     - A call note of `""` throws `/note/`.
     - An edit to "40 lb" is stored with `check.ok === false`, and sending it still
       succeeds.
  8. **Staleness:** after an accepted substitute, an open item's
     `preview(...).stale === true`.
  9. **logCall:** with "Alder Creek called: 20 lb more tomatoes Friday", it creates
     item `call-1` from grower-a.
- [ ] **Step 2: Run** `node --test tests/resolve.test.ts`. It should fail.
- [ ] **Step 3: Implement** with the clone-then-mutate pattern. Limits: 200
  resolutions, 500 outbox messages, and a 500-character note.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass, including
  the existing workbench tests.
- [ ] **Step 5: Commit:** `git commit -m "Resolutions, outbox, recorded replies and Log a call"`.

### Task 8: Packing lock with Ship short, and the sheets

**Files:**
- Create: `src/pack.ts`
- Test: `tests/pack.test.ts`

**Interfaces:**
- Consumes: `unresolved` and `shortages`; `proposeAllocations`, `verifyPlan` and
  `snapshotHash`.
- Produces:
  - `type Lock = { snapshotHash; snapshot; plan; lockedBy; at; shippedShort: { orderId: string; amount: number; unit: BaseUnit; buyerTold: false }[] }`
  - `lockGate(w): { blocking: string[]; warnings: string[] }`. The blocking list holds
    unresolved order IDs, and the warnings list holds inbox items that are open,
    pending or returned.
  - `lockPlan(w, by, at, opts: { shipShort: boolean }): Workbench`. It throws
    `/resolve/` when blocking and `!shipShort`.
  - `lockState(w): "none" | "valid" | "lapsed"`
  - `pickLists(lock)`: one entry per grower, with lines
    `{lotId, product, grade, total, unit, to: {orderId, buyerId, amount, kind}[]}`.
  - `orderSheets(lock)`: one entry per order:
    `{buyerId, orderId, product, ordered, unit, lines: {product, lotId, growerId, amount, substitute}[], short, shippedShortUntold: boolean}`.

- [ ] **Step 1: Write failing tests,** from the end state of the Task 7 story:
  - **The lock:** it locks, and its state is `valid`.
  - **Pick lists:** their amounts add up to the plan's allocations.
  - **The order-b sheet:** a zucchini line of 30 with `substitute: true`, and
    `short === 0`.
  - **Review Focus 4:** approving another update makes the lock `lapsed`.
  - **A fresh 60 lb short:**
    - `lockPlan(..., {shipShort:false})` throws `/resolve/`;
    - `lockGate.blocking` is `["order-b"]`;
    - with `{shipShort:true}` it locks;
    - `shippedShort` is `[{orderId:"order-b", amount:60, unit:"lb", buyerTold:false}]`;
    - the sheet has `shippedShortUntold === true`.
- [ ] **Step 2: Run** `node --test tests/pack.test.ts`. It should fail.
- [ ] **Step 3: Implement.** The sheets read only the lock.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Packing lock with recorded ship-short, pick lists and order sheets"`.

### Task 9: Measures

**Files:**
- Create: `src/measures.ts`
- Test: `tests/measures.test.ts`

**Interfaces:**
- Produces:
  - `type Measures = { shortsDetected: number; resolvedBy: { grower: number; substitute: number; notice: number; shipShort: number }; minutesToBuyerNotice: { orderId: string; minutes: number }[] }`
  - `measures(w): Measures`
- **What counts:**
  - **An order was short** if it has any resolution, or is short now, or is in
    `lock.shippedShort`.
  - **The cause:** the earliest approved item whose approval made the order short.
    Replay `proposeAllocations` over the event snapshots: each event's `afterHash`
    state is the `snapshot` after it. Simpler: record `causeItemId` on
    `startResolution`. That is the item ID of the latest approved event before the
    resolution started that lowered a lot of the order's product.
  - **Minutes:** from the cause item's `receivedAt` to the first outbox `sentAt` to that
    buyer.

- [ ] **Step 1: Write failing tests,** from the Task 7 story:
  - `shortsDetected === 1`;
  - `resolvedBy.grower === 1` and `resolvedBy.substitute === 1`;
  - `minutesToBuyerNotice[0].orderId === "order-b"`, with the minutes equal to
    `(offer sentAt − tomato item receivedAt)/60000`.
- [ ] **Step 2: Run.** It should fail.
- [ ] **Step 3: Implement.** Add `causeItemId?: string` to `Resolution`, set by
  `startResolution`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Measure shortfalls caught and time to buyer notice"`.

### Task 10: Demo extras, recording scripts, an lb evaluation set and the hub guard

**Files:**
- Modify: `src/seed.ts`:
  - `DEMO_EXTRAS_PATH = "data/demo-extras.json"`
  - `type Extras = { model; recordedAt; drafts: Record<string,string>; readings: Record<string,string> }`
  - `REQUEST_REPLIES` (grower-b gets `msg-tomato-more`)
  - `BUYER_REPLIES` (buyer-b: channel call, "Called kitchen manager, zucchini is fine
    for the rest.")
  - `scriptedRequestReply(w, resId, extras, at)`
- Create: `scripts/record-demo-extras.ts`
  - It requires `--max-calls N`, with N ≤ 4.
  - It drives the demo path, then records:
    - the reading of `msg-tomato-more`;
    - drafts for the ask (grower-b, 60 lb) and the offer (30 lb).
  - It writes the file only if the reading was `proposed`. Drafts that fail the check
    are left out and reported.
- Create: `evaluation/pounds.json`. Eight authored lb and case messages against the
  demo snapshot, each with its expected operation, quantity and questions, in the same
  shape as `heldout.template.json`. Committed, because the messages are synthetic.
- Modify: `scripts/evaluate-live.ts`, if needed, so it can read this file.
- Modify: `app/lib/hub.ts`:
  - an `extras()` loader;
  - `current()` resets when the stored state lacks `resolutions`, or its snapshot has
    no lb lots.
- Test: `tests/seed.test.ts`. With hand-written extras, `scriptedRequestReply` creates
  an interpreted item linked to the resolution. Without extras, the item is created but
  not interpreted.

- [ ] **Step 1: Write the failing seed test.**
- [ ] **Step 2: Run** `node --test tests/seed.test.ts`. It should fail.
- [ ] **Step 3: Implement.** **Do not run any recording or evaluation script.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. All tests should pass.
- [ ] **Step 5: Commit:** `git commit -m "Demo replies, extras recorder, pounds evaluation set and reset guard"`.

### Task 11: Orders page, resolution actions and Log a call

**Files:**
- Modify: `app/actions.ts`. Each action goes through `act()`:
  - `startResolutionAction`
    - The form holds the order ID, the option index, and the option's kind and amount.
    - It recomputes `options()` and rejects a mismatch.
    - It starts with `templateDraft`.
  - `museDraftAction`. Uses recorded extras by `factsDigest`, or a live call within
    `liveAllowance`. Otherwise it explains that none is available.
  - `editDraftAction`, `sendAction`, `buyerReplyAction`, `supplyReplyAction`,
    `scriptedRequestReplyAction` and `logCallAction`.
- Modify: `app/lib/format.ts`. Add `ORDER_STATUS`:

  | Status | Label | Tone |
  |---|---|---|
  | covered | "Covered" | ready |
  | short | "Short" | block |
  | resolving | "Waiting on reply" | wait |
  | buyer-told | "Buyer told" | quiet |
  | substitute-agreed | "Substitute agreed" | done |

- Create: `app/orders/page.tsx`. Its contents are as in the spec's UI section.
- Create: `app/call/page.tsx`, the **Log a call** form: grower, note, submit. It then
  links to the review item.
- Modify:
  - `app/nav.tsx`. The tabs become Overview, Review updates, Orders and Pack.
  - The header in `app/layout.tsx` gains a **Log a call** link.
  - `app/review/page.tsx`. The source of a call item is labelled "Call note by …".
- Modify: `app/globals.css`. Add `.option-card`, `.option-group` and `.draft` styles in
  both themes.

- [ ] **Step 1: Run** `npx tsc --noEmit -p tsconfig.app.json && npx next build`. The
  build should succeed.
- [ ] **Step 2: Browser walk-through** at 127.0.0.1:3600, after restarting the server.
  - Reset the demo. The items are uninterpreted until the re-record, so apply the
    precondition readings by hand with the review page's correction tools, or the test
    helper route. Record which you used.
  - **Orders:** Riverbend shows Short. There are option groups for growers with tomato,
    other growers and sources, and Tell the buyer. A zucchini substitute appears once
    zucchini is approved.
  - **Template draft:** draft to Birch Hollow. The "Template" label shows. Send it.
    Receive the reply, and the review item exists.
  - **Log a call:** creates an item.
  - Take screenshots.
- [ ] **Step 3: Commit:** `git commit -m "Orders workspace with templates, optional Muse Spark redraft, replies and Log a call"`.

### Task 12: Overview actions, measures, and the Pack page

**Files:**
- Modify: `app/page.tsx`:
  - "Needs your attention" lists short orders first: a crate icon, "Riverbend School
    Kitchen, 60 lb tomato short", a status chip, and **Resolve**.
  - Add a **This delivery day** card with the measures. It says "Measured in this demo
    session".
- Create: `app/pack/page.tsx`:
  - the gate checklist;
  - a **Ship short** checkbox, shown only when something is blocking, with the text
    "Ship these orders short without telling the buyer yet. This is recorded.";
  - **Lock plan for packing**;
  - the sheets, with a Print button (client component);
  - the lapsed banner.
- Modify: `app/actions.ts`. Add `lockAction`.
- Modify: `app/globals.css`. `@media print` hides the chrome, and the sheets get
  `break-inside: avoid`.

- [ ] **Step 1: Run** `npx next build`. It should succeed.
- [ ] **Step 2: Browser walk-through,** continuing from Task 11:
  - Approve the 30 lb reply. Offer zucchini, and record the call note as accepted.
  - Pack: there are no blocking items. Lock it. Riverbend's sheet shows 50 lb tomato
    and 30 lb zucchini (substitute).
  - The measures show 1 short caught, and a time to notice.
  - Approve another update. The lapsed banner shows.
  - **Separately:** a fresh reset gives a 60 lb short. Ship short, then lock. The sheet
    reads "Shipped short: buyer not told".
  - Take screenshots, including in print emulation.
- [ ] **Step 3: Commit:** `git commit -m "Act on short orders from the overview, measures, and the Pack page"`.

### Task 13: Story test, docs, then a budget request

**Files:**
- Test: `tests/story.test.ts`. The full demo path on the domain, with hand-written
  extras:
  - `unresolved` is `[]`;
  - the lock is `valid`;
  - order-b's `short` is 0;
  - the outbox has 2 messages, and every outbox text passes `checkDraft`;
  - the measures match.
- Modify:
  - `docs/STATUS.md`. A milestone 4 section: what works, what is simulated, the
    measures, and the hosting blockers. Link `docs/EVIDENCE.md`.
  - `README.md`. Link `docs/EVIDENCE.md`. The impact wording keeps to measurable
    outputs (E24).
- [ ] **Step 1: Write and run** `npm test`. It should pass.
- [ ] **Step 2: Run all checks:** `npm test && npm run typecheck && npx tsc --noEmit -p tsconfig.app.json && npx next build`.
- [ ] **Step 3: Commit:** `git commit -m "Story test for order resolution; status and evidence links"`.
- [ ] **Step 4: Stop and ask the user** to approve about 20 calls, roughly $0.08:
  - `scripts/record-seed.ts` at v4 (7 calls);
  - `scripts/record-demo-extras.ts --max-calls 4`;
  - a v4 run on `evaluation/pounds.json` (8 calls).

  Run them only after an explicit yes. Then reset and repeat the walk-through, with
  recorded readings and Muse Spark drafts.
