# Order Resolution Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the weak spots found in the order-resolution demo:
- the checker learns what shorthand means;
- drafts get better and are re-recorded;
- the smaller workflow issues are fixed.

**Architecture:** The pure domain stays in `src/`, and the Next.js server actions stay in `app/`.
- The checker changes from refusing words on a list to resolving each word to its meaning and then checking that meaning.
- A new "confirm" result asks the coordinator about words it cannot resolve.

**Tech Stack:** Node 24 TypeScript (`node --test`) and Next.js 16.4.3.

**Spec:** The order-resolution design (`docs/superpowers/specs/2026-10-28-order-resolution-design.md`), as amended by the project owner's direction of 2026-10-28:
- Deliberate misspellings are allowed.
- The platform must know what is being talked about. "tmrw" is clearly tomorrow.
- It must ask the coordinator to confirm when it cannot tell.
- Re-record better drafts.
- Fix the smaller issues: stale drafts, the substitute cap, approval friction and reply labels.

## Global Constraints

- Every fact in an outgoing message still has to match the decision (E11). Shorthand is resolved first, then checked. It is never ignored.
- A word that looks like a day, number, unit or product but cannot be resolved with confidence becomes a confirmation item. It is neither silently passed nor blocked.
- Model drafts:
  - a draft with a problem falls back to the template;
  - a draft with only confirmation items is kept, and the coordinator must confirm before sending.
- Coordinator edits:
  - problems warn (E12);
  - confirmation items must be confirmed before sending.
- Paid calls: re-recording the demo extras is approved, at no more than 6 calls in this plan. The key is loaded only via `node --env-file` and is never printed.
- Pure functions, unchanged state on throw, compare-and-swap on every app action.
- No personal names in tracked files. No Claude attribution trailers.

## Review Focus

1. **"tmrw" sent on a different day.** A draft written Wednesday for a Friday delivery that says "tmrw" means Thursday, so it is a problem. The same draft written Thursday passes.
2. **A substitute accepted for 30 lb when the shortfall later grows to 50.** Only 30 lb of the substitute is allocated, and the order is short by 20 again.
3. **A discarded draft.** Its option can be started again, and the discarded text stays in the history.
4. **Confirmation items and sending.** A send without confirming the open items is refused and leaves the state unchanged.
5. **A reply recorded against a stale item.** The item is refreshed first, both decisions are recorded under the same coordinator, and approval still needs the new review hash.

---

### Task 14: Checker resolves meaning, then checks it

**Files:** Modify `src/messages.ts` and `src/draft.ts`, and test in `tests/messages.test.ts`.

**Interfaces:**
- `type Confirm = { token: string; question: string }`
- `type Check = { ok: boolean; problems: string[]; confirm: Confirm[] }`. `ok` means there are no problems. Confirmation items do not make `ok` false.
- `checkDraft(raw, f, knownProducts, on?: string)`. `on` is the date the draft is written (YYYY-MM-DD) and is used for relative days. When it is omitted, a relative day becomes a confirmation item.
- `draftMessage` keeps a model draft that has confirmation items, and records them on `Draft.check`.

**Resolution rules:**
- **Days:**
  - Shorthand maps to its day: tmrw, tmw, tmrrw, 2moro, 2morrow, tomorow, tommorow → tomorrow; tonite, tonight, today, tdy → today.
  - Relative days resolve against `on`. A day that matches the delivery weekday passes. A day that does not is a problem worded like `"tmrw" means Thursday; the delivery is Friday`.
  - Weekday words resolve by explicit abbreviation (mon, tue, tues, wed, weds, thu, thur, thurs, fri, sat, sun) or by a name within edit distance 2.
  - A token that starts with a day prefix but has no clear match (for example "Th" or "Thr") becomes a confirmation item: `Did you mean Thursday?`.
- **Numbers:**
  - Number words and close misspellings resolve to their value: "twnty" → 20, "tweny" → 20, "doz"/"dz"/"dozen" → 12.
  - A resolved number next to a unit is a quantity and is checked like a digit quantity.
  - A number word that cannot be resolved with confidence becomes a confirmation item.
- **Products:**
  - Known products resolve per whole token, plural-aware, with edit distance ≤ 2 for names of 5 or more letters ("cucumbre" → cucumber).
  - Required-product presence needs a token that resolves to the product. "pea" inside "Speak" no longer counts.
  - A token close to two known products becomes a confirmation item.
- The existing protections from rounds 1–4 stay: ASCII only, units, months and dates, and approved-name exemptions.

- [ ] **Step 1: Write failing tests:**
  - "tmrw", with the draft written on Thursday for a Friday delivery, passes.
  - "tmrw", written on Wednesday, is a problem naming Thursday.
  - "tmrw" with no `on` gives a confirmation item.
  - "cucumbre" with cucumber required passes.
  - "cucumbre" with only tomato allowed is a problem.
  - "twnty lb" with an amount of 20 passes, and with an amount of 30 is a problem.
  - "Thr" gives the confirmation item `Did you mean Thursday?`.
  - "Speak" does not satisfy a required "pea".
  - Every `template()` output in a sweep has no problems and no confirmation items.
- [ ] **Step 2:** Run `node --test tests/messages.test.ts` and confirm it fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. All tests must pass. Update any existing test whose expectation changes under the new rules, and justify each change in the report.
- [ ] **Step 5:** Commit with the message "Checker resolves shorthand to its meaning and asks to confirm when unsure".

### Task 15: Confirmation before send, discarding drafts, and the substitute cap

**Files:** Modify `src/resolve.ts`, `src/orders.ts`, `src/planner.ts` and `src/updates.ts` as needed. Test in `tests/resolve.test.ts`, `tests/orders.test.ts` and `tests/planner.test.ts`.

**Interfaces:**
- `startResolution` and `redraft` pass `on` (the hub-local date of `at`, America/Chicago) to the checker.
- `confirmDraft(w, resId, actor, at)` records that the coordinator confirmed the draft's confirmation items. It throws if there are none or if the draft was already sent.
- `editDraft` and `redraft` reset any earlier confirmation.
- `sendMessage` throws `/confirm/` when there are unconfirmed confirmation items, and leaves the state unchanged.
- `discardDraft(w, resId, reason, actor, at)` moves a drafted resolution to `status: "discarded"` and records the decision with the text kept. It refuses a resolution that has been sent. Discarded resolutions are not open, so their option can be started again.
- Substitute cap: `acceptSubstitute` takes an optional `maxAmount` (in base units: g, lb or each, as `covers` is), and `recordBuyerReply` passes the offer's `covers`. Standing permission has no cap.
- In the planner, an order's allocation of a capped substitute never exceeds `maxAmount`. Allocation stays deterministic, and `verifyPlan` still accounts every residual.

- [ ] **Step 1: Write failing tests** for Review Focus 2, 3 and 4. Also test that a confirmed draft sends, and that editing after confirming requires confirming again.
- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. All tests must pass.
- [ ] **Step 5:** Commit with the message "Confirm unsure words before sending, discard drafts, cap agreed substitutes".

### Task 16: Better drafts and re-recording

**Files:** Modify `src/draft.ts`, `src/seed.ts`, `app/actions.ts` and `scripts/record-demo-extras.ts`. Test in `tests/draft.test.ts` and `tests/seed.test.ts`.

- Set `DRAFT_PROMPT_VERSION = "draft-v2"`. The prompt tells the model what each kind of message must do:
  - **request:** ask the grower whether they can bring another {quantity} of {product} for {day}, and ask how much they can do.
  - **offer:** say the buyer's {product} order for {day} is {quantity} short, and ask whether {substitute} would work instead for that {quantity}, with a yes or no reply. It must never suggest that {product} is available.
  - **notice:** say the {product} order for {day} will be {quantity} short.

  The request payload includes `kind`, plus a one-line purpose sentence for that kind.
- `Extras` records `draftPromptVersion`. `recordedDraft` returns a draft only when `extras.model === DEMO_MODEL` and `extras.draftPromptVersion === DRAFT_PROMPT_VERSION` (M10). A recorded draft is re-checked when used.
- The recorder writes `draftPromptVersion`.

- [ ] **Step 1: Write failing tests:**
  - the request body carries `kind` and the purpose sentence;
  - `recordedDraft` ignores extras with a different model or draft prompt version.
- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all checks. Commit with the message "Draft prompt v2 states each message's purpose; recorded drafts must match model and prompt".
- [ ] **Step 5:** Controller only, within the approved budget: run `node --env-file=… scripts/record-demo-extras.ts --max-calls 3`. Read both drafts. If either is weak or misleading, change the prompt once and re-record, for at most 6 calls in total. Commit any prompt change.

### Task 17: Review and Orders friction

**Files:** Modify `app/review/page.tsx`, `app/orders/page.tsx`, `app/actions.ts` and `src/workbench.ts` as needed. Test in `tests/workbench.test.ts` or `tests/app-copy.test.ts`.

- **Approver name:**
  - An empty approver name returns a visible error: "Enter your name to approve."
  - The name is remembered for this browser in a cookie (`hr_name`, SameSite=Strict, HttpOnly, path=/), set when an approval succeeds, and prefilled on later approvals.
  - The name is never sent anywhere else.
- **Stale replies:**
  - Recording a reply, answer or correction on a stale item refreshes the item first. The refresh is recorded as a "refreshed" decision by the same coordinator, and the reply is then applied.
  - The queue gets a "Refresh all stale items" button that records one refresh decision per item.
  - Approval still requires the current review hash.
  - Stale items render their preview against current supply, read-only, without mutating on GET. When the rebased review has the same reading and no new questions, the item shows as normal, with a quiet "Supply changed since this was read; checked again." Approving it refreshes and approves in one compare-and-swap, against the hash of the rebased review the coordinator saw. "Needs refresh" appears only when the rebased review differs: new questions, or a reading that no longer applies. (UX audit H1, recommendation 2.)
- **Labels and links:**
  - An ask card whose linked reply was reviewed says "Their reply was reviewed." and links to it. It no longer says "in review".
  - A review item that answers an ask shows "Reply to your ask about {product} for {buyer}" and links to the order (M9).
  - Orders cards show confirmation items with a **Confirm these words** button, and Send stays disabled until they are confirmed.
  - Drafted cards get a **Discard draft** button with a reason.
  - The Overview and Orders show a capped substitute as "up to {maxAmount}".

- [ ] **Step 1: Write failing tests** for the domain parts (stale reply refreshes first; refresh all), and copy tests for the new labels.
- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all checks, including `next build`. Do a browser walk-through of the full demo after Reset demo, with the recorded readings. It should need no Refresh clicks when items are approved in page order. Check that discard, confirm and the capped substitute work.
- [ ] **Step 5:** Commit with the message "Smoother review: remembered approver, refresh with replies, clearer reply links, confirm and discard on orders".

---

The following tasks come from the UX and accessibility audit (a git-ignored report; recommendation numbers are cited as R1–R19) and from the owner's request that the header be reorganized because it is cluttered on small screens. Every task follows the owner's principle: coordinators want a platform that works and makes the job easier. Model details stay off the main path.

### Task 18: Header and phone layout

**Files:** Modify `app/layout.tsx`, `app/nav.tsx`, `app/theme.tsx` and `app/globals.css`, plus small client components as needed. Test in `tests/app-copy.test.ts`.

- Design the header for 390 px first.
  - **Phones:** one row with the logo, the current page name and a **Menu** button. The menu is a disclosure with `aria-expanded` and `aria-controls`. It closes on Escape and returns focus to its button. It holds the four page links, **Log a call**, the theme toggle and **Reset demo**, last and set apart.
  - **Desktop (≥ 760 px):** one row with the logo, the four tabs, **Log a call** as a button, and a small overflow menu for the theme and **Reset demo**.
  - The header is at most 64 px tall on a phone.
- The header shows "Recording as {name} · not you?" once, for every form that records the remembered name (Task 17 follow-up). With no name remembered, it shows "Who is working? [name]".
- **Reset demo** asks before it acts: "Reset the demo? This clears today's decisions." It is never next to **Log a call** (R19).
- Add a skip link to `#main`. Every page gets its own `<title>`, for example "Orders · Harvest Relay" (R15).
- **Phone order:** on Review, the selected item and its actions come before the queue, and the queue collapses to "N messages ▾". On the Overview, "Needs your attention" comes first. After any action, scroll or focus moves to its result (R8).
- [ ] Copy tests. Then a browser check at 390 and 1280 px, in both themes and with the keyboard only. Then commit: "Header and phone layout put the work first".

### Task 19: Quick wins: plain words, accessible controls, correct numbers

**Files:** Modify `app/review/page.tsx`, `app/orders/page.tsx`, `app/pack/page.tsx`, `app/page.tsx`, `app/actions.ts` and `app/globals.css`. Create `app/not-found.tsx`. Test in `tests/app-copy.test.ts` and `tests/workbench.test.ts`.

- **The forecast preview shows the forecast amount.** "+20 lb expected" replaces the lot total (H2, R7). Write a failing test first.
- **Model details move off the main path (R5).**
  - The reading label becomes "Read automatically. Check the highlighted words."
  - "Redraft with Muse Spark" becomes **Suggest other wording**.
  - The author chip shows only "Edited by you".
  - The model name, prompt version and recording date move to the history, the event page and the export.
  - History reads as people's actions, for example "Alder Creek Farm replied: '6 lb in each'".
- **Plain errors next to the field (R9).**
  - Errors go next to their field, with `aria-invalid` and `aria-describedby`, and focus moves to the first invalid field.
  - Write "Supply changed since this was read. Checking it again…", never "Stale update".
  - Use grower and buyer names, never `item-6`.
  - Drop "(N related checks)".
  - Name length limits match: 80 everywhere.
- **Contrast (R14):**
  - input borders at least 3:1;
  - `.chip.ready` text at least 4.5:1 on its background;
  - `.chip.done` gets its own background.

  A test computes these ratios from the CSS tokens in both themes.
- **Repeated buttons get visually hidden context (R15).** For example: "Draft message <span class=sr-only>to Birch Hollow Gardens</span>".
- **A custom 404** links back to Overview.
- **Task 18 leftovers.** The Review `<title>` names the grower, for example "Review: Alder Creek Farm · Harvest Relay". After an action, focus moves to the result heading, and the result is announced in a polite live region.
- **Task 17 security leftovers (Low):**
  - The notice MAC covers the page path and the item or order id.
  - `signNotice` cuts text by code point, so a cut never splits a character.
  - A name must contain at least one letter or number.
  - The reserved "Coordinator" label is checked against confusable look-alikes and trailing punctuation.
  - The "Refresh all" count uses `refreshable()`.
- [ ] Commit: "Plain words, accessible controls and the right forecast number".

### Task 20: One flow from update to resolved order

**Files:** Modify `src/workbench.ts` and `src/orders.ts` (pure helpers), `app/review/page.tsx`, `app/orders/page.tsx`, `app/page.tsx`, `app/pack/page.tsx` and `app/actions.ts`. Test in `tests/workbench.test.ts` and `tests/orders.test.ts`.

- **The coordinator can write the reading by hand (C1, R1).**
  - Any unread item, including the coordinator's own call note, gets a short form: change (new total / add / correction / forecast), lot (or product and grower), amount and unit, grade and day.
  - Values found in the note prefill the form.
  - What the coordinator enters becomes a proposal through the existing correction path. Each value is backed by a quote from the note, or by the coordinator's call note itself as evidence (EVIDENCE E7).
  - The usual review and named approval follow.
- **After an approval, show the next step (R3).**
  - The result lists any order this change made short, for example "Riverbend School Kitchen is now 60 lb short", with **Resolve** and **Next update**.
  - After a reply linked to an ask, show **Back to Riverbend School Kitchen**.
- **Shortfalls point to pending updates (R4).** Add a pure helper `pendingCover(w, orderId)` that returns unreviewed items from growers who hold the order's product. On Overview, Orders and Pack, show "Alder Creek Farm's unreviewed update may cover this. Review it first", with a link, above the options.
- [ ] Write failing tests for the pure parts. Then commit: "One flow from update to resolved order".

### Task 21: Orders recommends one next step

**Files:** Modify `src/orders.ts` (`recommend(w, orderId, contacts)`, pure) and `app/orders/page.tsx`. Test in `tests/orders.test.ts`.

- **`recommend` picks one option,** using the hubs' own order of moves (EVIDENCE E4–E6):
  1. a grower who holds the product and was not reduced recently, largest amount first;
  2. otherwise, a substitute covering at least 25% of the short, if the buyer has standing permission;
  3. otherwise, the first other grower or outside source;
  4. otherwise, telling the buyer.

  Ties are broken by ID, so the choice is deterministic.
- **The page shows the pick first.** The recommended option is a primary card with its template draft already open, for example "Ask Birch Hollow Gardens for 60 lb: they hold tomatoes for Friday". The other options fold under "Other options (N)". Substitutes that cover under 25% of the short are listed only there (R6).
- **Buyer answers take one tap (R10).**
  - Two buttons: **They said yes** and **They said no**.
  - One "What they said" box: a call note, or the text pasted in full.
  - The quote is taken from the pasted text automatically when it contains the yes or no. Otherwise the coordinator picks the words from the text.
- [ ] Write failing tests for `recommend`. Then commit: "Orders recommends one next step".

### Task 22: Overview, Pack, history and export finish the job

**Files:** Modify `app/page.tsx`, `app/pack/page.tsx`, `app/events/[id]/page.tsx`, `app/export/route.ts` and `app/review/page.tsx`. Test in `tests/app-copy.test.ts` and `tests/export.test.ts`.

- **The Overview leads with work (R13).**
  - Section order: "Needs your attention" (with "and N more"), then buyer orders, then supply.
  - "This delivery day" moves lower.
  - Remove the duplicate "Short" chip.
- **Pack finishes the job (R11).**
  - After locking, show "Plan locked at {time}. Print the sheets". **Print sheets** is the primary action, and the lock button becomes "Lock again".
  - Sheets show the hub, the delivery day and the grade, tick boxes, and a "Left over" line.
  - No internal IDs appear. Each grower and each buyer starts a new page.
- **The event page reads as a sentence (R16).** For example: "Cucumber, Alder Creek Farm: 40 lb → 64 lb, approved by {name}". Hashes, source IDs and revisions go under "Technical record".
- **The export is complete and easy to find (R17).**
  - It includes resolutions, the outbox, the lock and measures.
  - Pack shows a "Download day record" link after locking.
- **The review controls are quieter (R18).**
  - Add a one-tap **No change, dismiss** for messages with no supply change.
  - Explain or hide **Confirm lot**.
  - When Approve is disabled, give the reason next to it.
  - Hide finished items under "Done today (N)".
- [ ] Copy and export tests. Then a demo-tester walk-through of the whole demo, counting the steps; the audit's baseline was about 24 actions. Then commit: "Overview, Pack, history and export finish the job".
