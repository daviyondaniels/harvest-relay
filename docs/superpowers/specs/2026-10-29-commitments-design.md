# Commitments: promises that hold when supply drops

Status: draft, 2026-10-29. Milestone 4 of `docs/DEVELOPMENT-SCOPE.md` (HTO08, HTO11).
E-numbers cite `docs/EVIDENCE.md`.

## Why

> As a hub coordinator, once I've told buyers what they're getting, I want a late
> harvest drop to show me exactly which promise broke and by how much, and nothing
> else to move, so no buyer who was promised finds out at delivery.

Today the app re-plans from scratch whenever supply changes. The planner fills orders
by priority, then by ID. So a drop on one lot can quietly move supply away from a buyer
who was already promised, to a buyer the rule happens to favour. The packing lock
lapses on any supply change. Locking again re-plans everything, and the coordinator
cannot see what moved.

Hubs run a fixed loop. Buyers order by a cutoff, and growers drop product the day
before delivery (E2, research report). So shortages after the plan is set have to be
settled within hours. Nobody documents how hubs choose which buyer takes a short (E15,
Q5). The app therefore suggests and explains a choice, and the coordinator decides.

**Success in the demo:**
1. The coordinator confirms today's plan. Every order's supply is now promised.
2. A grower then reports a lower harvest on a lot that backs promises.
3. When the update is approved, the coordinator sees one plain conflict:
   - which lot dropped and by how much;
   - which promise it breaks ("Riverbend: promised 60 lb → can now get 20 lb");
   - the statement that every other order is unchanged.
4. The app suggests who takes the cut and why. The coordinator accepts it or picks
   another order. The choice is recorded with their name.
5. The cut order is short in the usual way, and the existing ask / substitute /
   tell-the-buyer options handle it.
6. The order sheets and pick lists follow the promises. Lines that changed since the
   plan was confirmed are marked.

## Goals

- **Promises.** Confirming the plan turns each allocation into a promise for a
  specific order from a specific lot, with an amount and a kind (direct or agreed
  substitute). It records who confirmed and when.
- **Supply never moves silently.** A later supply change never moves promised supply
  between orders.
  - The planner keeps every promise that the lot can still cover.
  - It plans only the remaining supply against the remaining need, using the existing
    priority-then-ID rule.
  - Extra supply fills orders that are still short, or stays unallocated.
- **A drop below promises is an explicit conflict.** It appears when an approved update
  leaves a lot holding less than its promises total. The conflict names:
  - the lot;
  - the drop;
  - the promises the lot can no longer cover;
  - the suggested cut.

  The update is still approved, because the grower has what they have. The conflict
  stays open until the coordinator chooses who takes the cut.
- **The suggested cut** takes from the lowest-priority order promised from that lot,
  ties by order ID. That is the reverse of the order in which the planner filled
  them, so it is the same rule the coordinator already sees. The reason is shown in
  plain words.
  - The suggestion never picks a packed or handed-off order.
  - The coordinator can pick any other order on the lot, or split the cut across
    orders. Their choice and name are recorded.
- **Open conflicts block packing**, as an unresolved short does today. The Ship short
  path stays.
- **Order stages.** Each order shows one of four stages:
  - **planned:** supply allocated, not promised;
  - **promised:** confirmed;
  - **packed:** the coordinator pressed Packed on the order sheet;
  - **handed off:** the coordinator pressed Handed off.

  Each stage is set by a named coordinator action and recorded with a time. Nothing
  sets packed or handed off automatically (scope: "no proposal is reported as a
  completed handoff"). An order that is partly promised says so, for example
  "promised 40 of 60 lb".
- **New allocations become promises only by a named action.** After a change, newly
  planned supply shows as planned. "Confirm plan" again promises it.
- **Packing follows the promises.** The lock no longer lapses on every supply change.
  - Pick lists and order sheets are drawn from the current promises.
  - The confirm time is shown.
  - Lines changed since that confirmation are marked, with what they were, so a sheet
    printed earlier can be checked.
- **History and records.** Every promise, conflict, chosen cut and stage change is in
  the history and the day record export.

## Non-goals

- Buyer-facing confirmations, or sending anything. The outbox still sends nothing.
- Partial reservation before the plan is confirmed, and per-order promises (confirm
  one order at a time). Confirming is for the whole day's plan.
- Delivery routes, trucks, invoices, credits, disposition or loss accounting. Loss
  claims need evidence the app does not have (scope, milestone 4).
- Undoing a stage or un-promising. If time allows, an "undo" within the same session
  is the builder's call. It is not required.
- Multiple coordinators or roles. The approver is still a typed name.

## Anti-goals: it fails even if it works when…

- a buyer's promised supply changes without a conflict the coordinator saw and decided;
- any screen claims an order was packed or handed off without a named action;
- the conflict screen shows planner internals (allocation IDs, hashes, "re-plan")
  instead of buyer, product, amount and day (`product-ease-over-ai`);
- the new controls are harder to use with a keyboard or screen reader than the
  existing Review and Orders pages.

## Constraints

- **Domain code stays pure and deterministic.** Clone-then-mutate, and state is
  unchanged on throw. `verifyPlan` must accept the promise-aware plan and refuse:
  - a plan that drops a promise its lot can still cover;
  - a plan that over-allocates around promises.

  Residual accounting stays complete.
- **Every action goes through the existing compare-and-swap** (`act` in
  `app/lib/hub.ts`) and names the stored version its page showed. Page renders never
  write.
- **Before the first confirm, behaviour is exactly as today.** Story 1's tests must
  still pass, adjusted only where they assert the lock lapses.
- **Accessibility, WCAG 2.2 AA.** These apply to every new control and message:
  - The conflict is announced with the existing `Result` focus pattern.
  - "Who takes the cut" is a fieldset with a legend and radio buttons. A split uses
    labelled number fields with the shared field-error helper.
  - Stages and changed lines are shown in words, not by colour alone.
  - Targets are at least 24×24 px.
  - All of it works at 320 px width and at 200% zoom.
  - A browser check with keyboard and screen-reader names runs once, at the end.
- **No paid model calls.** Any new demo grower message is read by hand or by an
  existing recording.
- **Product wording.** Plain coordinator language: "promised", "can now get", "takes
  the cut". The button is **Confirm today's plan**, replacing "Lock plan for packing".

## Decided in conversation

- What the coordinator sees first is the broken promise and its size, with "everyone
  else unchanged". It does not lead with the new harvest number or a re-plan.
- Confirming the plan is the moment of promise. It is the existing lock step,
  renamed and made durable.
- The app suggests who takes the cut, with the reason, and the coordinator decides.
  The choice is recorded.
- "Find more" leads into the existing story 1 options.
- There are four stages, and packed and handed off are manual buttons.

## Calls I made (not discussed; check these)

- The suggested cut is lowest priority first, then order ID, on the dropped lot only.
  Packed and handed-off orders are never suggested.
- An open conflict blocks packing until decided. The suggestion is pre-selected, so
  deciding is one click.
- Supply newly planned after a change stays "planned" until Confirm is pressed again.
- Sheets mark changed lines instead of hiding the whole sheet, as the lapsed lock does
  today.
- Demo: after the plan is confirmed, a demo-only button delivers one late grower
  message, like the existing "(demo)" reply buttons. The message lowers a lot that
  backs a promise, and it is read by hand or from a recording.

## Rules settled after the builder check (my calls)

- **A decided cut rewrites the promise.** Riverbend's 60 lb promise from that lot becomes
  20 lb. The missing 40 lb is an ordinary short. The amount first confirmed is kept in
  history, and "changed since confirmed" compares against the latest confirm.
  Invariant: the promises on a lot never total more than the lot. `verifyPlan` checks
  this.
- **While a conflict is open, the suggested cut is applied provisionally.** The plan
  and sheets stay consistent but are marked "not decided", and packing is blocked.
  Other lots are not affected.
- **One open conflict per lot.** A second drop on the same lot recomputes it for the
  total drop.
- **When only packed or handed-off orders back the lot,** nothing is pre-selected. The
  coordinator must choose an order, and the screen warns that the order is already
  packed.
- **A lot dropping to zero** is handled like any other drop.
- **Supply rises.** Extra supply, including a top-up for a partly promised order, is
  planned, not promised, until the coordinator presses Confirm again.
- **Orders are fixed.** The app cannot add, edit or cancel orders today, and that stays
  out of scope.
- **Confirming with shorts open** uses the existing gate: shorts must be resolved, or
  the coordinator chooses Ship short.
  - Confirming again promises whatever is newly planned.
  - It records a new confirm time and name, and adds to history rather than replacing
    it.
- **Substitute promises** are cut like direct ones. The ordinary short flow then works
  from the promise as it stands after the cut.
- **The day record export** gains the promises, conflicts, cuts and stages as new
  fields in the existing JSON. Tests check that they are present.
- **The demo late message** may give a suggestion that matches the plain ID order;
  that's fine.

## Left to the builder

- Data shape for promises, conflicts and stages, and where they live on `Workbench`
  (the `lock` may become the promise record).
- How the promise-aware planner is structured. It may be a `reserved` argument to
  `proposeAllocations` or a wrapper, as long as `verifyPlan` checks it.
- How `shortages`, `orderStatus`, `madeShort` and `recommend` read promises.
- The exact demo message, lot and amounts, and the `demo-precondition` changes.
- Wording beyond what is fixed above. The `docs-checker` agent reviews copy.
- Whether "split the cut" ships, or only a single order choice. It ships only if it
  stays small.
