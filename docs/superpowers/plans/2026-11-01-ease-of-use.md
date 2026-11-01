# Ease of Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-11-01 ease-of-use and interface audits, and cut the clicks for the eleven core coordinator tasks to as near the minimum as a safe design allows.

**Architecture:** Most of the change is in the Next.js pages (`app/`). Domain changes in `src/` are small and pure: number limits, validating before saving, and plain phrases for "what changed". The record-and-approve model stays. Every change is still named, evidenced and version-checked; the work removes steps around those rules, never the rules themselves.

**Tech Stack:** Node 24 (TypeScript run directly), Next 16 server actions, React 19, `node --test`.

**Spec:** There is no separate design document. The requirements are the four audit reports, which are git-ignored:
- `reports/ease-of-use-audit-2026-11-01.md`, the combined report with ranked fixes;
- `reports/audit-a-first-day.md`, `reports/audit-b-phone-late-drop.md` and `reports/audit-c-mistakes-keyboard.md`, the scenario details;
- `reports/interface-rating-baseline.md`, the interface rating and click baseline.

The user asked for "fix all of the items, then run the scenarios again until we reduce to the least amount of clicks possible to perform necessary actions". Rulings below are mine and are listed for the user.

## Global Constraints

- Every action that changes records records a real coordinator name. No action records the reserved label "Coordinator" any more.
- Every action still names the stored version its page showed. Only actions whose domain check re-validates exactly what was shown may apply to a newer version: approve (review hash), decide cut (excess) and mark stage (stage order).
- Evidence rules stay: a reply or reading keeps literal words from the grower. Where the coordinator leaves the quote blank, the app picks literal words itself and never invents any.
- Accessibility stays at WCAG 2.2 AA:
  - focus moves to the result or the field with the problem;
  - errors sit beside their field, with `aria-invalid` and `aria-describedby`;
  - targets are at least 24 px everywhere and 44 px tall at ≤ 600 px width;
  - there is no sideways page scroll from 320 px to 1280 px.
- Plain coordinator words. These words never appear on screen:
  - "Reading" (as a heading), "Kind of update", "Change preview", "proposed allocation", "Not worked out yet", "Invalid operation answer";
  - the raw tokens `replace-total`, `add-quantity`, `correction` and `forecast`;
  - "Pack amount must be positive".
- The tab and headings call the review page "Review updates" everywhere.
- Demo-only controls stay, because the demo needs them. Each sits in a small group labelled "Demo" so it can't be mistaken for the product.
- No paid model calls. No personal names in tracked files. No AI attribution in commits.
- Checks: `npm test`, `npm run typecheck`, `npx tsc --noEmit -p tsconfig.app.json`, `npx next build`.

## Click targets

Counts are clicks plus typed fields, from `reports/tools/click_paths.py`.

| # | Task | Now | Target |
|---|---|---|---|
| 1 | Save your name | 1 + 1 | 0 + 1 (typed into the first action that needs it) |
| 2 | Approve a ready update | 2 | 1 (Approve on the Overview row) |
| 3 | Answer a clarification and approve | 4 + 3 | 2 + 1 (pick the answer, paste the reply, approve) |
| 4 | Dismiss a junk message | 3 | 1 (from the Overview row) |
| 5 | Ask a grower, record the reply, approve | 8 + 1 | 4 + 1 |
| 6 | Substitute the buyer agrees to | 5 + 1 | 3 + 1 |
| 7 | Tell a buyer they'll be short | 4 | 2 |
| 8 | Confirm today's plan | 2 | 1 (from the Overview all-clear) |
| 9 | Decide who takes the cut after a late drop | 5 + 1 | 2 |
| 10 | Mark every order packed and handed off | 7 | 2 |
| 11 | Print sheets | 2 | 1 |

## Review Focus

1. **The first action without a saved name.** It must take the name and do the action in one submit. A bad name must keep the action's other inputs.
2. **A refused submit on a long form** (reply, read-by-hand, edit) must keep everything typed, including multi-line text.
3. **Approve from the Overview.** It must show the same change the Review page would and check the same review hash. A stale row must be refused with the plain "changed" message.
4. **Rebased actions.** Approve, cut and stage must not apply when what they acted on changed, but must apply when only something unrelated changed.
5. **Printing.** Every sheet must start on its own page, with the buyer or grower name and the confirm time. No page may be blank.

---

### Task 1: Domain guards

**Files:** `src/quantity.ts`, `src/answers.ts`, `src/workbench.ts`, `app/lib/hub.ts`, plus tests in `tests/quantity.test.ts`, `tests/answers.test.ts` and `tests/workbench.test.ts`.

**Produces:**
- `MAX_AMOUNT = 100_000`, exported from `src/quantity.ts`. Any normalized amount above it, or a case pack above 2,000 per case, throws "That amount is more than this hub handles. Check it."
- `parseOperation(raw: string): Operation | undefined` in `src/answers.ts`. It accepts the tokens and plain phrases ("new total", "total", "replaces", "instead"; "add", "more", "in addition", "extra"; "correction", "fix", "mistake"; "forecast", "maybe", "might", "expect"), case-insensitively.
- `reply()` validates every answer, including pack > 0 and the limits above, **before** it records the reply. A refused reply leaves the item unchanged: no turn and no history line.
- `act(expected, f, { rebase?: boolean })` in `app/lib/hub.ts`. With `rebase`, a version mismatch runs `f` on the current state instead of refusing.
- `latestChange(w: Workbench): string | undefined`. This is the newest decision across items, resolutions and commitments, said plainly, for example "Sam approved Alder Creek Farm's update at 8:03 AM". The `StaleView` message becomes "Something changed in another tab or window: {latestChange}. Check the page and try again."

- [ ] Write failing tests for each item above: limits, case pack 0 and 2,001, phrase mapping, refused reply leaves state unchanged, rebase runs on current, `latestChange` wording.
- [ ] Implement them. Run `npm test` and `npm run typecheck`, then commit.

### Task 2: The name, asked on the first action

**Files:** `app/actions.ts`, `app/lib/name.ts`, `app/who.tsx`, a new `app/named-submit.tsx`, `app/layout.tsx`, every page form that changes records, and `tests/app-copy.test.ts` / `tests/app-lib.test.ts`.

- `actor()` is removed. Every record-changing action uses `named(f)`, which takes the name from the form's `who` field when it is present and valid, remembers it, and otherwise uses the remembered name. With neither, it refuses with the field error "Enter your name to continue." on that form's `who` field, not at the header. Every refusal keeps the other inputs (Task 3 shares the mechanism).
- `<NamedSubmit label=… className=… known={!!name}>` is a client component used for every record-changing submit button.
  - When no name is known, it renders a labelled "Your name" input (`name="who"`, `autoComplete="name"`) directly before the button, inside the same form.
  - Typing the name and pressing Enter or the button submits both. There is no separate Save.
- **Header:**
  - With a name saved: "Recording as {name} · not you?", as today.
  - With no name: a quiet text "Not signed in" with no input and no green Save. The "not you?" field still lets the coordinator change the name.
  - It must not widen the page at 195 px.
- `/call` and the demo late-message action also record the name.
- The header no longer needs `NameNeeded` at the top for these forms. Remove that component where nothing uses it.

- [ ] Tests (source-level, in `tests/app-copy.test.ts`):
  - no `actor()` remains;
  - every exported action that calls `act(` also calls `named(`;
  - `NamedSubmit` renders the `who` input only when no name is known.
- [ ] Implement, run all checks, commit.

### Task 3: Review page

**Files:** `app/review/page.tsx`, `app/actions.ts` (review actions), `app/lib/format.ts`, `app/conflict.tsx` (placement only), and tests.

- **Typed input is kept on refusal.** The reply, ask, correct, hold and hand-reading forms come back with what was typed. Use the same approach as the cut form: `kept` values in the redirect query, with text capped at its form's maxLength. Read them as `defaultValue`.
- **Answering a question.** When a question's detail is "What changed" (the operation), the Value field is a select: "A new total" / "Added to what they have" / "A correction" / "A forecast, not confirmed". For other details, the placeholder fits the detail ("10 lb" for quantity, "6 lb" for case contents, "standard" for grade, a date input for the delivery day).
  - The "Words in the reply that answer it" field becomes optional, labelled "Words in the reply that answer it (optional)". When it is blank, the action picks the shortest literal span of the reply that contains the value's number, or else the whole reply.
  - The reply form is open by default whenever questions are open, with the reply box first.
- **Answered questions disappear.** Once answered, or once a reading exists, "Question about…" lines no longer show in the thread. They stay in History.
- **Forecasts.**
  - The forecast approve button says "Note this forecast".
  - Its result says "Forecast noted. Confirmed supply is unchanged."
  - The approved tag shows "Forecast noted: +20 lb expected" instead of "was X → X".
- **The change line** reads "{before} → {after} ({up|down} {delta})", for example "120 lb → 60 lb (down 60 lb)".
- **After approving an update that opened a conflict,** the "Who takes the cut?" card renders at the **top of the main panel**, above the message, and takes focus.
- **After approving a reply to an ask,** the next steps list what is still short on that order ("Riverbend School Kitchen is still 30 lb short" with Resolve), or say "Riverbend School Kitchen is now covered."
- **The late or read-by-hand form** prefills "Words in the message" with the message's shortest span that contains the prefilled amount. It stays editable. Task 9 then needs no typing.
- **A refused 0 lb or over-limit reply** shows the plain error beside Value. Nothing is added to the thread.
- **Words:**
  - "Reading" becomes "What we understood".
  - "Kind of update" becomes "What changed".
  - "Change preview" becomes "What changes".
  - "If approved: proposed allocation" becomes "Who gets what if you approve", with no "A separate proposal" line.
  - "Not worked out yet" becomes "Waiting on your answer".
  - "Mark the lot as checked" is removed from the page, and its action stays unused.
  - "Unallocated" becomes "Not going to anyone yet".
- **Demo controls.** "Receive the grower's reply (demo)" sits in a `<div className="demo" aria-label="Demo">` with a small "Demo" tag.

- [ ] Tests:
  - the quote picker (in a pure helper, `app/lib/quote.ts`);
  - kept-values round trip (`app/lib/notice.ts` or a new helper);
  - copy tests for the banned words and new labels.
- [ ] Implement, run all checks, commit.

### Task 4: Orders page

**Files:** `app/orders/page.tsx`, `app/actions.ts` (order actions), `src/resolve.ts` (only if needed), `app/pending-cover.tsx`, `src/orders.ts` (`pendingCover`), `app/conflict.tsx`, `app/lib/format.ts`, and tests.

- **One-step send.** The Next step card shows the drafted text in an editable textarea, with **Send** as its primary button: one action that starts the resolution with any edits, checks it and sends it.
  - If the check needs words confirmed, it stops at the draft card with the confirm prompt instead (today's path).
  - "Other options" cards keep "Draft message", which keeps the existing review-then-send flow.
- **Substitute wording.** "Substitute permissions" becomes "Substitutes this buyer accepts". "None" becomes "None yet". This makes it consistent with the Next step's wording.
- **Buyer's answer.** The fields are no longer prefilled with demo words. "They said yes/no" with a blank box records "Answer recorded by {name} without a note", which the history shows as such. The textarea is optional when the channel is a call.
- **Status chip.** The order shows one status chip. A short order shows "Short {n} lb" and a covered one shows its stage. Never show both "Short" and "Promised".
- **`pendingCover` returns only updates that could raise supply** of the short product (adds, totals above the current lot, or unread messages). It returns one line per grower: "Alder Creek Farm has 2 updates to review that may cover this. Review them first".
- **Split.** `app/conflict.tsx` hides the "Split it" option when the lot has one promise.
- **Sent message.** "Recorded as sent (demo: not delivered) by…" becomes "Sent by {name}, {time}. (This demo records messages; it doesn't deliver them.)"
- **Demo controls.** "Receive the grower's reply (demo)" goes in the same "Demo" group.

- [ ] Tests:
  - `pendingCover` filters and groups (`tests/orders.test.ts`);
  - the one-step send action refuses when words need confirming and sends otherwise (`tests/resolve.test.ts` or an action-level source test);
  - copy tests.
- [ ] Implement, run all checks, commit.

### Task 5: Overview, navigation and header

**Files:** `app/page.tsx`, `app/nav.tsx`, `app/layout.tsx`, `app/globals.css`, `app/lib/view.ts`, and tests.

- **Attention rows act in place.**
  - A row for an update that is ready to approve shows its one-line change (the Task 3 change line) and who becomes short. It has an **Approve** `NamedSubmit` that posts the item, version and review hash to `approveAction`, and stays on the Overview with the result.
  - A row for a message with no supply change has **Dismiss**, using the no-change dismiss.
  - Rows needing answers keep their link to Review.
- **Short orders that a pending update may cover.** The primary button is "Review {grower}'s update". Resolve becomes a plain link.
- **All clear.** When nothing waits, the card says:
  - before confirm: "Everything is covered. Confirm today's plan", with a **Confirm today's plan** `NamedSubmit` that posts to `confirmAction`;
  - after confirm: "Plan confirmed. Pack and hand off", linking to /pack.
- **New since confirm.** An unread message received after the latest confirm shows a "New since you confirmed" chip. The stats line says "1 new message since you confirmed".
- **Fold the rest.** "This delivery day" measures, the gauge, the donut and "Grower lots" go into one `<details>` "Day details" below Buyer orders, closed by default. The export link stays visible.
- **Buyer orders table at 600 px or less.** It becomes stacked rows (one card per buyer). No sideways scroll at 390 px or 320 px.
- **Navigation.**
  - Tabs: Overview, Review updates, Orders, Pack, Log a call.
  - Every tab sets `aria-current` on its own page, including Log a call.
  - "Open review workspace" becomes "Review updates".
  - The menu closes when focus leaves it.
  - After Reset demo, focus lands on the page `h1`.

- [ ] Tests:
  - copy tests for the tab names and the "Day details" fold;
  - an `app/lib/view.ts` unit test for the new-since-confirm count.
- [ ] Implement, run all checks, commit.

### Task 6: Pack and print

**Files:** `app/pack/page.tsx`, `app/pack/print.tsx`, `app/actions.ts` (`stageAction`, `confirmAction`), `src/commitments.ts` (bulk stage helper, if needed), `app/globals.css` (print and phone rules), and tests.

- **Print.** Order and pick sheets print one per page, with no blank pages. Each sheet shows:
  - the buyer or grower name;
  - "Confirmed by {name} at {time}";
  - the hub and the day.

  Printing uses block layout, not the grid. Fix `.sheets .card-head` so the name shows.
- **Header buttons.** Print sits in the Pack header whenever a plan is confirmed. When the plan has changed since confirming:
  - the primary button is **Confirm again**;
  - Print is secondary, with the note "Sheets printed before {time} are out of date for: {buyers whose lines changed}".
- **Mark all.** "Mark all packed" and "Mark all handed off" are named `NamedSubmit`s. Each marks every order that can take that stage and reports "3 orders marked packed." The per-order buttons stay.
- **Messages since confirming.** Pack shows "{n} grower message(s) arrived since you confirmed" with a link, while any is unread.
- **Ship short.** The refusal says: "Orders still to resolve: X, Y. Resolve them, or tick “Ship these orders short” to confirm anyway." The checkbox label starts with the same words.
- **Phone layout.** At 600 px or less:
  - buttons are at least 44 px tall;
  - sheet tables wrap, with no overflow at 320 px;
  - order-sheet columns don't break words at 1280 px.
- **Demo control.** "Late grower message (demo)" sits in a "Demo" group.

- [ ] Tests:
  - a bulk stage test (`tests/commitments.test.ts`);
  - copy tests for the gate wording and print rules (assert `.sheets .card-head` is not hidden in print);
  - the stale banner names changed buyers (`src/pack.ts` helper test).
- [ ] Implement, run all checks, commit.

### Task 7: Cleanup and wording sweep

**Files:** any in `app/`, plus `README.md` (Demo walkthrough) and `docs/STATUS.md`.

- **Banned words.** Grep for every banned word in the Global Constraints and replace each.
- **Fine print.** "Allocation rule…" becomes "Who gets what: direct orders first, by priority, then substitutes the buyer has agreed to. Messages are recorded, not delivered, in this demo."
- **Docs.** Update the README walkthrough and STATUS for the new flows (Overview approve, the name on first action, one-step send, Mark all).
- **Minors.** Fix any parked review findings from Tasks 1–6.
- [ ] Run all checks, then commit.

### Task 8: Measure and iterate (controller)

- Update `reports/tools/click_paths.py` for the new UI and run it on a fresh app copy.
- Re-run the three scenario audits and the interface rating (four Sonnet agents, each on its own port).
- Anything above target, or any new friction rated serious, becomes a numbered follow-up task in this plan. Run the loop until every task meets its target or the remaining gap is an explicit safety step (review hash, named action, evidence).
- **Interface target, set by the user on 2026-11-01: an overall interface rating of about 9/10 or higher.** That means every one of the six interface scores is at least 4.5/5:
  - visual hierarchy;
  - layout and density;
  - navigation;
  - comprehension;
  - visual design;
  - feedback.

  After each re-rating, every interface score below 4.5 gets its own follow-up task, named from the rater's evidence. The loop does not end until the target is met. Each follow-up's brief tells the implementer to read the `frontend-design` skill: a deliberate hierarchy for every page (one primary action above the fold), a consistent spacing scale, and type sizes of at least 14 px for chips and meta text.
- Final whole-branch review on Opus, then report to the user.

---

## Round 3: from the round 2 re-audit

Sources (git-ignored):
- `reports/round2/audit-a-first-day.md`, scored 8/10;
- `reports/round2/audit-b-phone-late-drop.md`, scored 8/10;
- `reports/round2/audit-c-mistakes-keyboard.md`, scored 8/10;
- `reports/round2/interface-rating.md`, scored 8/10, with every criterion at 3.5–4.

The six interface criteria all need to reach 4.5 or above.

The clicks went from 43 + 7 typed to 37 + 3 typed. Tasks 2 and 10 met their targets. These round 2 rulings set the remaining limits:
- **Task 5 stays at 4 or more.** A grower's reply still goes through review with its preview, because that is a safety step.
- **Task 9 stays at 3.** The late message is read and checked before approval, for the same reason.
- **Task 4 may stay at 2.** One-tap Dismiss is only for a message that names no lot or no amount (see Task 10).

### Task 9: Layout, accessibility and visual design

**Files:** `app/globals.css`, `app/nav.tsx`, `app/layout.tsx`, `app/named-submit.tsx`, `app/review/page.tsx`, `app/conflict.tsx`, `app/pending-cover.tsx`, and copy tests.

- **No sideways scroll at 1280, 390, 320 or 195 px** on any page:
  - Overview: the `.sr-only` span inside `.attention .text span` escapes its box. Fix at `app/globals.css:206`, and stop the link text being cut off.
  - Review: the `.nowrap` change line clips "What changes" at 1280 px (`:117`, `:225`). Let it wrap.
  - Header: "not you?" won't wrap at 195 px, and the Menu button overlaps the page title (`:72-74`).
  - Add a copy test asserting `.sr-only` is `position: absolute` everywhere it is used inside a clipping box.
- **44 px targets at ≤ 600 px** for every interactive element:
  - the brand link;
  - `summary` elements, such as "Other options", Edit and Discard;
  - text inputs, selects and textareas;
  - inline links that act as the row's action ("Resolve", "Review it first", "Orders").
- **Phone navigation.** At ≤ 600 px, a fixed bottom tab bar holds the five tabs, with icons and labels and `aria-current`. Nobody needs the Menu to change page. The Menu keeps theme and Reset demo. Pad the bottom of the page so the bar never covers content.
- **Name fields.**
  - Every `NameField` gets an accessible name that says what it is for, for example "Your name, for this approval" (visible label "Your name", with sr-only context).
  - On the Review page, when several forms would each show a name field, show it only on the primary form in view (Approve or Apply). The others use a remembered name, or are refused beside their own field.
  - Fix the duplicate `hold-who` id (`app/review/page.tsx:187` and `:226`): every form `on` must be unique per page.
- **Keyboard order.** The skip link goes to the message (`#item`) or order (`#order`) panel, not the start of the queue. On Review and Orders at ≤ 1180 px, the queue comes after the panel in DOM order.
- **Approve when blocked.** It uses `aria-disabled="true"` instead of `disabled`, so it stays focusable. Pressing it moves focus to the first open question and does not submit.
- **Split-the-cut.** Out-of-range and non-integer values get the app's own plain message beside the fieldset. Use `noValidate` on that form, or a custom check, not Chromium's English text.
- **Visual design.**
  - Chip text is at least 13 px.
  - The light done chip text and soft text on the page reach at least 5:1.
  - Dark-theme link text on cards reaches at least 5.5:1.
  - The `<details>` "Day details" summary shows a visible ▸/▾ marker and reads as a control.
  - The spacing scale is used consistently: 4, 8, 12, 16, 24 and 32 px only, in the files this task touches.

- [ ] Tests:
  - copy tests for `aria-disabled`, unique form ids (scan the page sources for `on="…"` duplicates), the bottom-bar `aria-current`, and the token values;
  - a contrast test computing ratios from `app/globals.css` (a pure helper in `tests/`).
- [ ] Implement, run all checks plus `npx next build`, then commit.

### Task 10: Overview and Pack flow

**Files:** `app/page.tsx`, `app/lib/view.ts`, `app/pack/page.tsx`, `app/actions.ts` (return paths only), `app/result.tsx`, and tests.

- **Dismiss from the Overview** only for a message that has been read and identifies no lot or no amount (`dismissable` in `app/lib/view.ts`).
  - The Birch zucchini row (a real update with open questions) must not get Dismiss.
  - Test against the seed data: the zucchini and cucumber rows are not dismissable. Whether the instruction-like message is dismissable is decided by its reading; state which in the report.
- **Attention rows.** Show every row, up to 8. Order them: settle-cut first, then short orders, then updates ready to approve, then updates needing answers, then dismissable ones.
- **Review updates bar.**
  - It becomes an ordinary secondary button.
  - It is hidden when no update waits.
  - "Resolve" is a real secondary button on short rows.
- **Confirm on the Overview as soon as nothing is short and no cut is open,** even if updates still wait. Show the same line as Pack: "{n} grower updates not settled. The plan uses approved updates only, so this does not block confirming."
- **After confirming, the Overview card** "Plan confirmed by {name} at {time}" shows:
  - "{packed} of {n} packed, {handed} of {n} handed off";
  - the Mark all packed or Mark all handed off button (whichever applies next);
  - Print sheets, which opens /pack and prints;
  - Confirm again, when the plan has changed.

  "Plan confirmed." must appear only once.
- **Overview result after Approve or Dismiss** names what changed, for example "Tomato from Alder Creek Farm: 120 lb → 60 lb. Riverbend School Kitchen is now 60 lb short." with a Resolve link.
- **Pack after confirming.**
  - "Before you confirm" collapses into a one-line summary with a "Show checklist" fold.
  - The "{n} grower messages arrived since you confirmed" link goes to the first such message (`/review?item=…`), not `/review`.
- **Wording.**
  - Remove the "Allocation is a proposal from the hub's rules…" fine print (`app/page.tsx` around line 91).
  - The measures in Day details are re-labelled plainly: "Shortages caught", "Grower asks that added supply", "Substitutes agreed", "Buyers told they'd be short", "Orders shipped short". Drop "Counts of actions, not of orders…".

- [ ] Tests:
  - `dismissable` against the seed;
  - row ordering (pure helper in `app/lib/view.ts`);
  - the packed and handed-off counts;
  - copy tests.
- [ ] Implement, run all checks, then commit.

### Task 11: Orders and Review flow

**Files:** `app/orders/page.tsx`, `app/review/page.tsx`, `app/actions.ts`, `src/orders.ts` (`recommend`, options), `src/answers.ts` and `src/workbench.ts` (only if needed), and tests.

- **The Next step card after Send** shows the sent message's state ("Asked Birch Hollow Gardens for 60 lb. Waiting on their reply."), with the reply controls. The next suggestion appears only when there is nothing to wait for. It never shows "Message already open" for a sent message.
- **`recommend` skips a grower whose pending update cuts the lot it would ask about** (the "Ask Alder" case). Test it.
- **Visible alternatives.** Below the Next step, show up to two alternatives as one-step buttons, outside the fold:
  - "Offer {product}", when a substitute exists;
  - "Tell {buyer}".

  Each uses the same one-step send (draft, check, send; stop at the draft if needed). "Other options" holds the rest.
- **Substitute wording.** "Substitutes this buyer accepts" must agree with the Next step. Find why it reads "None yet" while the Next step says "the buyer already allows zucchini" (`app/orders/page.tsx:169` vs `:224`) and make both read from the same source. If the permission is on file, list it as "zucchini (standard), on file".
- **"Call logged as their reply. It is in Review updates."** links to that reply.
- **Review: answering open questions.**
  - One reply form answers **every** open question from the same pasted reply: one value per open detail, in one form.
  - When the answers close the last question, the submit button reads **"Apply and approve"**. It applies the answers and approves in one action (named, with rebase, and refused if the result needs another question). Otherwise it reads "Apply answers".
- **Hand-entry form.**
  - An amount of 0 is refused: "Enter an amount above zero." (`app/actions.ts` `handReading`).
  - The limit error from the hand form shows beside Amount (`fieldOf` maps it for `hand`).
- **The limit message** names the limit: "That amount is more than this hub handles (over 100,000 lb, or 2,000 per case). Check it."
- **Wording.**
  - "Not read yet" becomes "Not checked yet".
  - "Save the reading" becomes "Save these details".
  - "Notice to buyer to {buyer}" becomes "Shortage notice to {buyer}".
  - "Waiting on answers" and "Waiting on your answer" become one phrase: "Waiting on your answer".
  - "planned, not yet promised" gets a plain sentence: "Planned: we expect to send this, but it isn't promised to the buyer until you confirm today's plan."

- [ ] Tests:
  - `recommend` skips a cutting grower;
  - the multi-answer reply and "Apply and approve" (an action-level test or a domain test of the composed step);
  - hand 0 refused;
  - copy tests.
- [ ] Implement, run all checks, then commit.

### Task 12: Measure again (controller)

Re-run the four audits and the click script on a fresh build, as in Task 8. Loop until every interface criterion is 4.5 or above (overall about 9) and the clicks are at the targets as ruled above.

---

## Round 4: from the round 3 re-audit

Sources (git-ignored), all in `reports/round3/`:

| Report | Score |
|---|---|
| `audit-a-first-day.md` | 8.5 |
| `audit-b-phone-late-drop.md` | 8 |
| `audit-c-mistakes-keyboard.md` | 8.5 |
| `interface-rating.md` | 8.5 |

Interface scores now: hierarchy 4.2, layout 4.2, navigation 4.5, comprehension 4.2, visual design 4.5, feedback 4.3. Clicks are 25 + 4; tasks 5 (7) and 9 (4) are still above target.

Rulings for this round:
- **Values the coordinator can see are enough to approve.** "Apply and approve" and "Save and approve" may approve in one step when every value is visible in the form the coordinator submits. The result must then name the change and every buyer now covered or short, with Resolve.
- **One-tap Approve on the Overview** is only for an update that leaves no order short. An update that would leave a buyer short goes to Review with its preview, so a cut is never approved blind.
- **Undo is out of scope this round.**
- **The demo prompt-injection message stays.** It is part of the safety demo, but it gets a plain label.

### Task 13: Overview and Pack, hierarchy and the stale plan

**Files:** `app/page.tsx`, `app/lib/view.ts`, `app/pack/page.tsx`, `app/pack/print.tsx`, `app/review/page.tsx` (demo fold only), `app/globals.css` (Overview and Pack rules only), and tests.

- **No Confirm trap.**
  - The Overview offers Confirm only when no waiting update would leave an order short if approved. Compute this with the same preview the Review page uses, per ready update.
  - Otherwise, in place of Confirm, show "{Grower}'s update would leave {buyer} {n} {unit} short. Review it before confirming." with a link to that update.
  - The domain gate is unchanged. Test it with the seed: the tomato update is waiting, so Confirm is not offered.
- **One-tap Approve only when no buyer is left short.** A ready row whose preview leaves any order short shows "Review it" (link) instead of Approve. Test it.
- **Row order.** The order is:
  1. settle the cut;
  2. short orders;
  3. updates not checked yet (unread or read by hand), so a late message shows above the routine approvals;
  4. ready;
  5. needing answers;
  6. dismissable.

  Update `byAttention` and its test.
- **One primary per card.** Only the first actionable row's button is `primary`; later rows use the secondary style.
- **Confirmed card first.**
  - After confirming, the "Plan confirmed by …" card renders above "Needs your attention".
  - When the plan is stale, that card leads with the same stale sentence as Pack (who changed). Confirm again becomes the primary button, and Mark all and Print are secondary.
  - Hide the "Needs your attention" heading and card when no rows remain.
- **"Review updates"** becomes a text link "Open all {n} updates" next to the attention heading. It is not a full-width bar.
- **Resolve once.** After an Overview approve that leaves a buyer short, only one Resolve shows: in the result, or on the row, not both.
- **Density.**
  - "Supply against orders" moves inside the "Day details" fold.
  - On phones (≤ 600 px), the stat chips are a 2 × 2 grid, and each buyer row is two lines: the buyer, then "{covered} of {ordered} {unit}" plus a status chip.
  - The Overview at 1280 should be under about 1,300 px tall with the seed data. Measure and report it.
- **The instruction-like message.** On the Overview row and in the Review list, a message read as having no lot or amount whose text gives instructions shows "Looks like an instruction, not a harvest update". Use a simple heuristic on the reading (unresolved with no amount), not a new model call. State the rule in the report.
- **Pack.**
  - Confirm again shows only when the plan is stale.
  - When stale, the out-of-date sentence is a heading-led warning box ("Printed sheets are out of date"), and Print sheets is secondary until Confirm again is pressed.
  - Printed sheets get a column header row, and the card has top margin in print.
- **Demo tools.** Every demo control (Pack late message, Review grower reply, and any others) moves into one closed "Demo tools" fold at the foot of its page.
- **Investigate the Riverbend-to-Northside switch.** The same pending tomato cut previews "Riverbend becomes short" before confirming but "Northside" after. Find out why (probably confirmed promises are protected), and make the preview say why when it applies, for example "Riverbend's order was confirmed first, so Northside takes the cut". If it is a defect, fix it and add a test.

- [ ] Tests: the Confirm trap, one-tap eligibility, row order, the stale confirmed card, and copy tests. Measure Overview height at 1280 and 390.
- [ ] Implement, run all checks, then commit.

### Task 14: Orders and Review, errors and the remaining clicks

**Files:** `app/orders/page.tsx`, `app/review/page.tsx`, `app/value-fields.tsx`, `app/named-submit.tsx`, `app/actions.ts`, `app/lib/format.ts`, `src/orders.ts` (only if needed), the demo extras data (wording only), and tests.

- **No silent refusals.**
  - The Orders "Record their reply" form: map its errors to `amount` (`fieldOf`: its `on` must map to `amount`, not `value`). Use `noValidate` so the app's message shows, not Chromium's. Set `aria-invalid` and keep the typed values.
  - Case-contents errors focus the input itself, not the wrapper `#reply-value`.
  - Sweep every form for a refusal that loses focus: each server error must name a field or land on the form's result. Add a test that every `on` used by `failed()` has a `fieldOf` mapping, or that the error falls back to the form.
- **The name is saved only on success.** A refused action must not change the remembered name (the header "Recording as …").
- **Accessible names.** Remove the stray " : " in button accessible names (for example, "Send : Ask Alder Creek Farm …").
- **Orders, after a notice or offer.**
  - After "Tell {buyer}" is sent, the Next step shows that state ("Told {buyer} they'll be short {n}"). The Tell button is gone, and no second notice can be sent from that card.
  - Only one Send shows at a time. A draft in Messages replaces the Next step's Send (the Next step shows "Draft ready below" with a link) until it is sent or discarded.
- **Task 5 path, 4 clicks.**
  - After an ask is sent, "Log their call" is open by default.
  - Logging the call lands on Review for that reply, with the details pre-filled and a **"Save and approve"** button (hand form). It applies only when every value is visible in the form, as ruled.
  - The result names what changed and who is now covered or short.
  - On Orders, keep one link to the reply. Drop the other two. "Call logged as their reply." ends in that link.
- **Task 9 path, 3 taps.** The hand form's primary button is "Save and approve" wherever the details are complete, so the late message path is: the row, Save and approve, Settle the cut.
- **The Apply and approve result** names the change and every buyer now covered or short (as Approve does). While questions are open, the preview area says "The change will show here once these answers are applied." in place of "Waiting on your answer".
- **"Done today"** lists a noted forecast as "Noted", not "Approved".
- **Wording.**
  - On Review, "Waiting on your answer" becomes "Needs your answer". It shows only when there is an open question; with no details it says "Enter the details below".
  - On Orders, "Waiting on reply" becomes "Asked, waiting for the grower".
  - "Planned: we expect to send this, but it isn't promised…" (`app/lib/format.ts:99`) becomes "Not promised to the buyer yet."
  - A call note opens with "Check what they said" in place of "This message has not been read yet."
  - In the demo late message, make the numbers agree with the lot shown: it says "not 110" while the lot shows 80 lb.

- [ ] Tests:
  - the `fieldOf` coverage;
  - the name not saved on refusal (unit test of the helper);
  - Tell hides after sending (the pure helper behind the Next step);
  - "Save and approve" composed with the hand reading;
  - the forecast listed as "Noted";
  - copy tests.
- [ ] Implement, run all checks, then commit.

### Task 15: Phone chrome and small layout

**Files:** `app/layout.tsx`, `app/nav.tsx`, `app/globals.css`, and tests.

- **Tab bar order.** The phone tab bar comes after `<main>` in the DOM, so keyboard focus reaches the content first. It stays fixed at the bottom visually. Each tab link is at least 44 px wide.
- **195 px.**
  - No sideways scroll once a cut card shows (`label.check` radio label span, `app/globals.css:307`).
  - Labels in "What we understood" do not break mid-word: use `overflow-wrap: anywhere` only on values, not labels, or stack the label above the value.
- **Fine print** is at least 14 px.

- [ ] Tests: copy tests. Measure 195, 320 and 390 px with a cut card showing.
- [ ] Implement, run all checks, then commit.

### Task 16: Measure again (controller)

Same as Task 12.
