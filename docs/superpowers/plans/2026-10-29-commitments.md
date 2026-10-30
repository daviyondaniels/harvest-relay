# Commitments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirming the day's plan turns allocations into promises. A later supply drop
never moves promised supply silently. A drop below a lot's promises becomes an explicit
conflict, which the coordinator settles with one recorded choice. Orders carry the
stages planned → promised → packed → handed off.

**Architecture:**
- `proposeAllocations` gains an optional list of promised allocations. It places those
  first, then plans the rest with the existing rule, and `verifyPlan` checks both.
- Commitment state lives on the `Ledger` as `commitments`. The existing ledger-based
  helpers (`shortages`, `options`, `madeShort`, `preview`) switch from
  `proposeAllocations(l.snapshot)` to `planOf(l)` without changing their signatures.
- Promise changes never touch the snapshot or `ledger.version`, so inbox reviews do not
  go stale when the plan is confirmed.
- The packing lock is replaced by the commitments. Pick lists and order sheets are
  drawn from the live promise-aware plan.

**Tech Stack:** Node 24 (TypeScript run directly, `node --test`), Next.js 16 server
actions, React 19. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-commitments-design.md`

## Global Constraints

- **Domain code stays pure and deterministic.** It clones, then mutates, and the input
  state is unchanged when a function throws. Every new domain function gets a test that
  the input is unchanged.
- **Every app action goes through `act(expected, f)`** in `app/lib/hub.ts` and names
  the stored version. Page renders never write.
- **Before the first confirm, behaviour is exactly as today.** With no commitments,
  `planOf(l)` deep-equals `proposeAllocations(l.snapshot)`.
- **Copy, fixed by the spec:**
  - The button is **"Confirm today's plan"**, replacing "Lock plan for packing", and
    "Confirm again" replaces "Lock again".
  - The words used are "promised", "can now get", "takes the cut" and "Everyone else's
    {product} is unchanged."
  - Stage labels are "Planned", "Promised", "Packed" and "Handed off".
- **No planner internals in the UI:** no hashes, allocation IDs or "re-plan".
- **Accessibility, WCAG 2.2 AA:**
  - The conflict uses the existing `Result` focus pattern.
  - The cut choice is a `<fieldset>` with a `<legend>` and radio buttons.
  - A split uses labelled number inputs with the shared `app/lib/field-error.tsx`.
  - Stages and changed lines are in words, never colour alone.
  - Targets are at least 24×24 px.
  - Everything works at 320 px and at 200% zoom.
- **No paid model calls.** No new dependencies. Never commit `reports/` or `data/`,
  except `data/seed-readings.json`.
- **Commits** carry no attribution trailers and no personal names. Run `npm test` and
  `npm run typecheck` before every commit. Any task that touches `app/` also runs
  `npx tsc --noEmit -p tsconfig.app.json`.
- **Lean process:**
  - Sonnet implementers and reviewers, one review and at most one fix round per task.
  - Minors are batched into Task 7.
  - No browser walk-throughs inside tasks; one browser check runs at the end.

## Review Focus

1. **A second drop on a lot whose conflict is still open.** The conflict is recomputed
   for the total drop, and the provisional cut covers it. Test in Task 2.
2. **A lot dropping to 0 that backs two promises.** Both promises are cut to 0, the
   conflict lists both, and the plan verifies. Test in Task 2.
3. **Supply rising after confirm on a lot backing a partly short promised order.** The
   extra is planned, not promised, and appears as "planned" in the order's stage until
   Confirm again. Test in Task 2.
4. **A decide-cut form submitted after another drop changed the excess.** It is refused
   with "Supply changed since this was shown", and state is unchanged. The excess is
   bound in the form. Test in Task 2, action wiring in Task 4.
5. **A substitute promise on a dropped zucchini lot.** It is cut like a direct one, and
   the substitute cap still holds after the cut. Test in Task 1.

---

### Task 1: The planner honours promised allocations

**Files:**
- Modify: `src/planner.ts`
- Test: `tests/planner.test.ts`

**Interfaces:**
- Produces:
  - `export type Promised = { orderId: string; lotId: string; amount: number; unit: BaseUnit; kind: Allocation["kind"] }`
  - `proposeAllocations(s: Snapshot, promised: Promised[] = []): Plan`
  - `verifyPlan(s: Snapshot, plan: Plan, promised: Promised[] = []): void`
  - `Plan` gains an optional `promisesHash?: string`, set only when `promised` is
    non-empty and equal to `digest(promised)` in canonical order.

**Rule:**
1. Validate each promise. It must be eligible in the same way the planner checks:
   - the lot is confirmed;
   - unit and date match;
   - for `requested`, the product and grade are accepted;
   - for `approved-substitution`, it is a permitted substitute.
2. Throw "Promises exceed the lot" when one lot's promises total more than the lot, and
   "Promises exceed the order" when one order's promises total more than the order.
3. Place the promises first, as allocations, in input order. Promised substitute
   amounts count toward that order's `maxAmount` cap.
4. Then run the existing two-pass priority/ID loop on the remaining supply and the
   remaining need.
5. A promise with `amount` 0 places nothing.
6. `verifyPlan` additionally requires `plan.promisesHash` to match. For each
   (order, lot, kind), the allocations must total at least the promised amount.
   Otherwise it throws "Plan drops a promise".

- [ ] **Step 1: Write the failing tests**
  - `test("with no promises the plan is unchanged")`: for `demoSnapshot()`,
    `proposeAllocations(s, [])` deep-equals `proposeAllocations(s)`, and neither has
    `promisesHash`.
  - `test("promised supply stays with its order even when priority would move it")`:
    - Use a snapshot with lot-x of 100 lb tomato and order-hi (priority 2, 100 lb) and
      order-lo (priority 1, 60 lb).
    - Promise order-lo 60 lb from lot-x.
    - Then order-lo gets 60 and order-hi gets 40, with 60 unfilled.
    - `verifyPlan` passes.
  - `test("extra supply goes to remaining need only")`: same as above, but the lot is
    160. Then order-hi gets 100 and order-lo keeps exactly 60.
  - `test("promises above the lot or the order are refused")`: these throw /Promises
    exceed the lot/ and /Promises exceed the order/.
  - `test("verifyPlan refuses a plan that drops a promise")`: take the plan from the
    priority-move test and remove 10 from order-lo's allocation. This throws /Plan
    drops a promise|Residual/. Also use a plan built without promises, checked with
    promises; this throws.
  - `test("a promised substitute counts toward its cap")`:
    - Use order-c from `demoSnapshot()` with the zucchini cap set to 30, and lot-d at
      40 lb.
    - Promise 20 lb of substitute.
    - The plan then gives at most 10 more substitute, for 30 in total.

- [ ] **Step 2: Run `node --test tests/planner.test.ts`.** Expected: the new tests
  FAIL.
- [ ] **Step 3: Implement the rule above in `src/planner.ts`.** Keep the planner's
  comment style: one line on the rule, citing `docs/EVIDENCE.md` E15 for the
  priority/ID order.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit** "Planner: place promised allocations first, then plan the
  rest".

### Task 2: Commitments domain: confirm, conflicts, the cut, stages

**Files:**
- Create: `src/commitments.ts`
- Modify:
  - `src/updates.ts`: `Ledger` gains `commitments?: Commitments`. `commitUpdate` and
    `createLedger` carry it, and so does the `commit` helper in `src/orders.ts`
    (`acceptSubstitute`, `addLot`).
  - `src/pack.ts`: replace the lock. Details under "Pack" below.
  - `src/workbench.ts`: `Workbench` loses `lock`. `madeShort` and `preview` use
    `planOf`.
  - `src/orders.ts`, `src/resolve.ts`: use `planOf(l)` / `planOf(w.ledger)`.
  - `src/measures.ts`: ship-short counts come from `commitments.shippedShort`.
  - `src/seed.ts`: `needsReset` also returns true for a stored state that has the
    old `lock` key.
- Test: `tests/commitments.test.ts` (new). Update `tests/pack.test.ts`,
  `tests/story.test.ts`, `tests/measures.test.ts` and `tests/export.test.ts` only
  where they used the lock.

**Interfaces:**
- Consumes: Task 1's `Promised`, `proposeAllocations(s, promised)` and
  `verifyPlan(s, plan, promised)`.
- Produces, in `src/commitments.ts`:
  ```ts
  export type Stage = "planned" | "promised" | "packed" | "handed-off";
  export type CommitEvent =
    | { kind: "confirmed"; by: string; at: string; promised: Promised[]; shipShort: string[] }
    | { kind: "cut"; by: string; at: string; lotId: string; cuts: { orderId: string; amount: number }[]; suggested: boolean }
    | { kind: "stage"; by: string; at: string; orderId: string; stage: "packed" | "handed-off" };
  export type Commitments = {
    promised: Promised[];            // current promises; on any lot they never total more than the lot, except while a conflict is open
    confirmed: { by: string; at: string; promised: Promised[] };  // the latest confirm, the baseline for changed lines
    shippedShort: { orderId: string; amount: number; unit: BaseUnit; buyerTold: false }[];
    log: CommitEvent[];
  };
  export type Conflict = {
    lotId: string; product: string; unit: BaseUnit;
    lot: number; promisedTotal: number; excess: number;     // excess = promisedTotal - lot
    promises: { orderId: string; amount: number; stage: Stage }[];
    suggestion?: { orderId: string; amount: number }[];      // absent when only packed or handed-off orders back the lot
  };
  export function held(l: Ledger): Promised[];               // promised, with each open conflict's provisional cut applied
  export function planOf(l: Ledger): Plan;                   // proposeAllocations(l.snapshot, held(l)), verified
  export function conflicts(l: Ledger): Conflict[];          // sorted by lotId
  export function confirmPlan(w: Workbench, by: string, at: string, opts: { shipShort: boolean }): Workbench;
  export function decideCut(w: Workbench, lotId: string, cuts: { orderId: string; amount: number }[], excess: number, by: string, at: string): Workbench;
  export function stageOf(l: Ledger, orderId: string): { stage: Stage; promised: number; ordered: number; unit: BaseUnit };
  export function markStage(w: Workbench, orderId: string, stage: "packed" | "handed-off", by: string, at: string): Workbench;
  export type ChangedLine = { orderId: string; lotId: string; was: number; now: number; unit: BaseUnit };
  export function changedSinceConfirm(l: Ledger): ChangedLine[];
  ```
- Produces, in `src/pack.ts`:
  - `lockGate(w)` keeps its shape. `blocking` also includes every order named in an
    open conflict.
  - `pickLists(l: Ledger): PickList[]` and `orderSheets(l: Ledger): OrderSheet[]` read
    `planOf(l)`. A `SheetLine` gains `was?: number`, set when the line differs from the
    latest confirm, so 0 means newly added.
  - An `OrderSheet` gains `stage: Stage`.
  - `lockPlan`, `lockState` and the `Lock` type are removed.

**Rules:**
- **Suggested cut.** Among the lot's promises whose stage is promised (not packed or
  handed off), take from the lowest priority first, then by order ID, until the excess
  is covered. When no such promise exists, `suggestion` is `undefined`.
- **Provisional cut** in `held`. Use the suggestion. When there is none, use the same
  order over all of the lot's promises, so the plan stays valid.
- **`decideCut`:**
  - It refuses with "Supply changed since this was shown" unless `excess` equals the
    conflict's current excess.
  - It refuses unless the cuts total exactly the excess.
  - It refuses unless each cut is no more than that order's promise on the lot.
  - It reduces those promises, drops any that reach 0, and logs
    `{ kind: "cut", suggested }`. `suggested` is true when the cuts deep-equal the
    suggestion.
- **`confirmPlan`:**
  - It refuses with "Decide who takes the cut first" while any conflict is open, even
    with Ship short.
  - Otherwise it applies the existing short gate and Ship short rule from `lockPlan`.
  - It sets `promised` to every allocation of `planOf(l)`, merged per (order, lot,
    kind).
  - It sets `confirmed` and appends a `confirmed` event.
- **`stageOf`:**
  - "handed-off" or "packed" comes from the latest stage event for the order.
  - Otherwise it is "promised" when the order's promises total more than 0, and
    "planned" when they don't.
  - `promised` is the promised total.
- **`markStage`:**
  - "packed" requires stage "promised" and no open conflict on the order.
  - "handed-off" requires "packed".

Sheets after a cut show the cut amounts. Nothing is hidden.

- [ ] **Step 1: Write the failing tests** in `tests/commitments.test.ts`, building on
  `resolved()` from `tests/pack.test.ts`. Move `resolved()` into `tests/story.ts` as an
  export.
  - `test("before any confirm the plan is the same as today")`.
  - `test("confirming promises every allocation and records who and when")`.
  - `test("a drop below promises is a conflict that names the lot, the drop and the suggested cut")`:
    - After confirming, approve Birch Hollow's lot-b set to 70 lb (it was 110).
    - `conflicts` gives excess 40 and suggestion `[{ orderId: "order-b", amount: 40 }]`.
    - `planOf` gives order-a its 120 unchanged.
    - order-b is now 40 short, provisionally.
  - `test("an open conflict blocks packing and confirming, even with Ship short")`.
  - `test("deciding the suggested cut rewrites the promise and logs it as suggested")`.
  - `test("the coordinator can give the cut to another order on the lot")`: cutting
    order-a by 40 is accepted and logged with `suggested: false`.
  - `test("a cut that does not total the excess, exceeds a promise, or names a stale excess is refused and changes nothing")`.
  - `test("a second drop on an open conflict recomputes it for the total drop")`
    (Review Focus 1).
  - `test("a lot dropping to zero cuts every promise on it")` (Review Focus 2).
  - `test("extra supply after confirm is planned, not promised, until confirmed again")`
    (Review Focus 3).
  - `test("only packed orders on the lot: no suggestion, and the coordinator must choose")`.
  - `test("stages: packed needs promised, handed off needs packed, and both are recorded with a name")`.
  - `test("changed lines show what was confirmed")`.
  - `test("ledger updates keep the commitments")`: `commitUpdate`, `acceptSubstitute`
    and `addLot` each preserve `commitments`.
  - `test("needsReset is true for a stored state with the old lock")`.

- [ ] **Step 2: Run `node --test tests/commitments.test.ts`.** Expected: FAIL (module
  missing).
- [ ] **Step 3: Implement `src/commitments.ts` and the modifications listed under
  Files.** Then update `tests/pack.test.ts`, `tests/story.test.ts`,
  `tests/measures.test.ts` and `tests/export.test.ts` from `lockPlan`/`lockState` to
  `confirmPlan`/`conflicts`. Keep every assertion that still applies.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
  `npx tsc --noEmit -p tsconfig.app.json` will fail where `app/` still uses the lock.
  That is fixed in Task 3, so commit Tasks 2 and 3 back to back.
- [ ] **Step 5: Commit** "Commitments: promises, conflicts on a drop, the recorded
  cut, order stages".

### Task 3: Pack page: Confirm today's plan, stages, changed lines

**Files:**
- Modify:
  - `app/pack/page.tsx`
  - `app/actions.ts`: rename `lockAction` to `confirmAction`, calling `confirmPlan`.
    Add `stageAction`.
  - `app/lib/record.ts`
  - `app/lib/view.ts`
  - `app/orders/page.tsx`: use `planOf`, and show the stage chip and "promised X of Y".
  - `app/globals.css`, if needed.
- Test: `tests/app-copy.test.ts` and `tests/export.test.ts`.

**Interfaces:**
- Consumes from Task 2: `confirmPlan`, `markStage`, `stageOf`, `pickLists(l)`,
  `orderSheets(l)`, `changedSinceConfirm` and `conflicts`.

**Behaviour:**
- **Status chip.** The Pack heading chip reads:
  - "Not confirmed" before any confirm;
  - "Confirmed", with "Confirmed by {name} at {time}.", while nothing has changed;
  - "Changed since confirmed" when `changedSinceConfirm` is non-empty, or there is
    planned supply that is not promised.
- **Confirm button.** It reads "Confirm today's plan", or "Confirm again" after the
  first confirm. The existing gate and Ship short checkbox stay.
- **Sheets.** They show whenever there is a confirm, not only while it is "valid".
  - A changed line reads "{now} lb (was {was} lb at confirm)" in text.
  - Each order sheet shows its stage in words.
  - A promised sheet has a "Mark packed" button, and a packed sheet has a "Mark handed
    off" button. Each is a form posting `order` and the stored version, with an
    accessible name that includes the buyer.
- **Lapse banner.** The old "Plan changed after locking" banner is removed.
- **Day record.**
  - `dayRecord` replaces `lock` with
    `commitments: l.commitments ?? null, conflicts: conflicts(l), stages: { [orderId]: stageOf(l, orderId) }`.
  - `proposedPlan` becomes `planOf(l)`.
  - The label sentence reads: "Allocations are proposals until confirmed; confirmed
    allocations are promises to the buyer, not deliveries."

- [ ] **Step 1: Write the failing tests.**
  - In `tests/export.test.ts`, the record has `commitments`, `conflicts` and `stages`
    keys, and no `lock` key.
  - In `tests/app-copy.test.ts`:
    - the pack page source contains "Confirm today's plan", "Mark packed" and "Mark
      handed off";
    - it does not contain "Lock plan for packing";
    - every new button sits inside a `<form>`.
- [ ] **Step 2: Run the two test files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npx tsc --noEmit -p tsconfig.app.json`,
  then `npx next build` in a hard-linked copy outside the repo, with `data/` copied.
  Expected: all pass, and the build succeeds.
- [ ] **Step 5: Commit** "Pack: confirm today's plan, order stages, changed lines".

### Task 4: The conflict panel, shown where the coordinator is

**Files:**
- Create: `app/conflict.tsx`, a server component
  `ConflictPanel({ w, version, conflict, headingLevel })`.
- Modify:
  - `app/actions.ts`: add `decideCutAction`.
  - `app/review/page.tsx`: the approval result shows the panel for each conflict on
    the approved item's lot, before the existing "made short" list.
  - `app/orders/page.tsx` and `app/pack/page.tsx`: show all open conflicts at the top.
  - `app/page.tsx` (Overview): add a "Promises to settle" line linking to `/orders`.
- Test: `tests/app-copy.test.ts`.

**Interfaces:**
- Consumes from Task 2: `conflicts`, `decideCut` and `stageOf`.

**Copy and structure.** The structure is fixed; the wording may be polished in Task 6.
- **Heading:** "{Grower}'s {product} dropped {excess} lb. {excess} lb of what you
  promised can't be filled."
- **List:** one line per promise on the lot. When the suggestion includes the order,
  it reads "{Buyer}: promised {amount} lb → can now get {amount − cut} lb". Otherwise
  it reads "{Buyer}: promised {amount} lb".
- **Line:** "Everyone else's {product} is unchanged."
- **Form**, posting `lot`, `excess`, `version` and the choice:
  - `<fieldset><legend>Who takes the cut?</legend>`, with one radio per promised order
    on the lot.
  - Each label reads "{Buyer} takes {excess} lb". The suggested one adds " —
    suggested: lowest priority on this lot".
  - The suggestion is pre-checked. A packed order's label adds " (already packed)".
  - With no suggestion, nothing is pre-checked, and the line "Every order on this lot
    is packed or handed off. Choose who takes the cut." is shown.
  - A last radio, "Split it", reveals labelled number inputs per order. It is a plain
    `<details>`, or always visible with no JavaScript required; the builder chooses.
    The split ships only if it stays under about 40 lines. Otherwise drop the radio.
  - Submit button: "Settle the cut".
- **Result:** the success notice reads "{Buyer} takes the {excess} lb cut. Find more
  {product} on Orders." It links to `/orders?order={id}` and receives focus through
  `Result`.
- **Refusals** use `msg` notices and the field-error helper on the fieldset. A stale
  excess shows "Supply changed since this was shown. Look at the current numbers and
  choose again."

- [ ] **Step 1: Write the failing tests** in `tests/app-copy.test.ts`:
  - `app/conflict.tsx` contains `<fieldset`, `<legend>` and "Who takes the cut?";
  - it uses `field-error` for errors;
  - `decideCutAction` goes through `act(`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all checks plus `npx next build` in a copy.** Expected: pass.
- [ ] **Step 5: Commit** "Conflict panel: whose promise broke, and who takes the
  cut".

### Task 5: Demo: a late grower message after the plan is confirmed

**Files:**
- Modify:
  - `src/seed.ts`: add `LATE: SeedMessage`, which is not part of the morning `SEED`.
  - `app/actions.ts` and `app/pack/page.tsx`: add a "Late grower message (demo)"
    button, shown only after a confirm and before the message has been received. It
    receives `LATE` with its `receivedAt` set to now.
  - `scripts/demo-precondition.ts`: unchanged, unless its comment needs the new step.
- Test: `tests/story.test.ts`.

**The message:**
```ts
LATE = { receivedAt: "2026-10-28T15:30:00Z", source: { id: "msg-late-tomato", revision: 1, growerId: "grower-b",
  text: "Tomatoes came in light. We'll only have 70 lb of standard for Friday, not 110." } }
```
It is read by hand in Review, through the existing `readByHand` path. There is no
recording and no paid call.

- [ ] **Step 1: Extend `tests/story.test.ts`** with
  `test("after confirming, Birch Hollow's late drop is one conflict, settled by the suggested cut")`:
  1. Start from `resolved()`, then `confirmPlan`.
  2. Receive `LATE` and hand-read it as replace-total lot-b 70 lb, quoting "only have
     70 lb of standard", "Friday" and "not 110". Approve it.
  3. `conflicts` gives one conflict: excess 40, suggestion order-b 40.
  4. Northside's tomatoes are unchanged.
  5. `decideCut` with the suggestion.
  6. order-b is now short 40, and `options` offers asks for it.
  7. `changedSinceConfirm` lists order-b on lot-b, was 50 → now 10.
- [ ] **Step 2: Run it.** Expected: FAIL (no `LATE`).
- [ ] **Step 3: Implement** `LATE` and the demo button.
- [ ] **Step 4: Run all checks plus `npx next build` in a copy.** Expected: pass.
- [ ] **Step 5: Commit** "Demo: a late harvest drop after the plan is confirmed".

### Task 6: Docs and copy

**Files:** `docs/STATUS.md`, `README.md`, and in-app copy only where the docs-checker
flags it.

- [ ] **Step 1:** Add a "Milestone 4 (scope): Commitments, October 29" section to
  `docs/STATUS.md`. Cover what works, what is simulated, and known limits:
  - orders are fixed;
  - there is no un-promising;
  - one coordinator.

  Fix the stale lines in the existing "Milestone 4: Order resolution" section:
  - the seed readings are recorded at v4;
  - the demo extras are recorded;
  - the checker now reads shorthand and confirms when unsure;
  - "Lock" now means "Confirm today's plan".

  Name no people.
- [ ] **Step 2: Update the README demo steps** with the confirm, the late message and
  the cut.
- [ ] **Step 3:** Run all checks. **Commit** "Docs: commitments and an up-to-date
  status".

### Task 7: Cleanup of batched review minors

- [ ] Fix the Minors collected from the Task 1–6 reviews. Run all checks plus
  `npx next build` in a copy. **Commit** "Cleanup: commitments review minors".

**After Task 7 (the controller, not a task):**
1. One browser check by the `ux-reviewer` agent covers keyboard-only operation,
   accessible names, focus after each action, 320 px and 200% zoom on Pack, Orders and
   Review with a conflict open, and a contrast check of the new chips.
2. One fix round.
3. Then one Opus review of the whole branch.
4. Then a PR.
