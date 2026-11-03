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

---

## Round 5: from the round 4 re-audit

Sources (git-ignored), all in `reports/round4/`:

| Report | Score |
|---|---|
| `audit-a-first-day.md` | 9 |
| `audit-b-phone-late-drop.md` | 8 |
| `audit-c-mistakes-keyboard.md` | 9 |
| `interface-rating.md` | 9.0 |

Interface scores are now:

| Criterion | Score |
|---|---|
| Hierarchy | 4.4 |
| Layout | 4.3 |
| Navigation | 4.6 |
| Comprehension | 4.4 |
| Visual design | 4.5 |
| Feedback | 4.5 |

Clicks are 22 + 4, with every task at its ruled target.

Rulings for this round:
- **One-step approve shows its outcome first.** "Save and approve" and "Apply and approve" must show, before the press, who will be short or covered if the details are saved as shown. For pre-filled values, the server computes this preview at render time. When the coordinator types or changes values, the preview says "Changes you make here will be checked before approving." The result still names everything. This closes the "approves blind" finding from auditors A and B.
- **Overview and Pack agree on confirming.**
  - Both show "{Grower}'s update would leave {buyer} {n} {unit} short. Review it before confirming." with a link.
  - Pack keeps a secondary "Confirm without it", because the domain allows confirming on approved updates only. The Overview shows the link only.
- **The 195 px tab bar** stays at about 39 px per tab (ruled in Task 15).
- **Unchanged from earlier rounds:**
  - stale-view refusals of unrelated actions stay, for safety;
  - signed result URLs stay;
  - there is no undo.

### Task 17: Review, Orders and forms — preview before one-step approve, kept input, wording

**Files:** `app/review/page.tsx`, `app/value-fields.tsx`, `app/named-submit.tsx`, `app/orders/page.tsx`, `app/actions.ts`, `app/lib/format.ts`, `src/resolve.ts`, `src/*` (only as needed), and tests. Do not touch `app/page.tsx`, `app/pack/`, `app/lib/view.ts` or `app/globals.css` (Task 18 owns those).

- **Preview before Save and approve.**
  - On the hand form with pre-filled details (late message, logged call), show "If saved as shown:" with the same impact lines as Approve, computed on a clone. Use a pure helper that applies the hand reading to a copy and previews it, and test it.
  - The demo late message must show "Riverbend School Kitchen becomes short 10 lb" (or whatever the seed gives) before the press.
- **Preview before Apply and approve.** When the reading suggests values for the open details, pre-fill them. The preview then shows "If these answers are applied:" with impact lines. When no suggestion exists, show "Changes you make here will be checked before approving."
- **Logged call to Save and approve.** When the call note names the lot and amount (the demo Alder call), pre-fill "What changed" with the best guess, so the button reads "Save and approve" (`app/review/page.tsx:329`).
- **A partial "Apply answers" keeps the reply.** It must not empty a reply the coordinator must retype. If the reply is already recorded, the follow-up form says "Their reply is recorded above" and needs only the remaining value. It must not record a second "replied" line.
- **Kept input on refusal.**
  - The name input keeps its typed value (`defaultValue` from the kept values, `app/named-submit.tsx:27`).
  - Every other required field gets the app's message, not the browser bubble: `noValidate` plus a server check on Send, Log a call and hand Amount.
- **One name field per view.**
  - Orders "Other options" forms are `quiet`.
  - On Review, a refused secondary form shows its own field only, and the primary form's field hides while that refusal shows.
  - Fix "Your name , for …" so there is no space before the comma.
- **One Approve.** On Review, when the reply form offers "Apply and approve", hide the aside's blocked "Approve supply change", or replace it with a link "Answer the questions to approve".
- **"They said yes"** with no channel picked records "Answer recorded by {name}", with no channel claimed (`src/resolve.ts:228`). Name the channel only if one was picked.
- **Wording.**
  - The accessible name "Sent. Waiting on the answer. to Alder Creek Farm" becomes a proper sentence (`app/orders/page.tsx:283`).
  - "Not promised to the buyer yet." no longer shows after the buyer has agreed or been told.
  - The approval result names who is covered for every approval; check zucchini.
  - "Recorded only; nothing is delivered." appears once per Orders page, in the page intro, not on every form.
  - The hand form's "Earlier update being corrected" options read as plain words, for example "Birch Hollow Gardens' zucchini update (4 cases of 10 lb)".

- [ ] Tests:
  - the hand-preview helper with the late message seed;
  - Apply-and-approve suggested values;
  - a partial apply keeps the reply (domain);
  - "They said yes" with no channel;
  - name `defaultValue`;
  - copy tests.
- [ ] Implement, run all checks plus a browser check of the late message on a phone (390), then commit.

### Task 18: Overview, Pack and layout — hierarchy, density and the zoomed cut card

**Files:** `app/page.tsx`, `app/pack/page.tsx`, `app/pack/print.tsx`, `app/lib/view.ts`, `app/globals.css`, and tests. Do not touch `app/review/`, `app/orders/`, `app/actions.ts` or `app/named-submit.tsx` (Task 17 owns those).

- **The zoomed cut card (regression).** At 195 px the radio label breaks one letter per line, so the card is 1,459 px tall.
  - Use `overflow-wrap: break-word` (not `anywhere`) on `label.check > span`, and reduce the nested padding at ≤ 300 px (`app/globals.css:309`, `:384`).
  - Measure the cut card height and the "Settle the cut" position at 195, 320 and 390. "Settle the cut" must be within 1.5 screen heights at 195.
- **Agreement on confirming**, as ruled: Overview and Pack say the same thing; Pack has a secondary "Confirm without it". Test it.
- **The stale card when a cut is open.** The Overview's primary is "Settle the cut" (link to the cut). On Pack, only one primary shows: Settle the cut first, then Confirm again after it is settled.
- **The confirmed card's lead.** When a message has arrived since confirming and isn't checked yet, the card's first sentence says so ("1 grower message arrived since you confirmed. Check it before packing.") with a link to it. The packed and handed-off counts sit directly beside the Mark all and Print buttons.
- **After Tell.** "Nothing is short. You can confirm today's plan." becomes "Every short order has been told or settled. You can confirm today's plan." whenever an order is still short but told.
- **Short row.**
  - Don't repeat the grower name or the review prompt.
  - Use one line, "Alder Creek Farm has an update waiting that may cover this.", and give the link a full name ("Review Alder Creek Farm's update").
  - Resolve gets a hint of what it will do, for example "Resolve: ask Birch Hollow Gardens for 60 lb", from `recommend`.
- **"Open all 1 update"** becomes "Open the 1 update" when there is one, and "Open all {n} updates" otherwise.
- **Density.**
  - The Overview at 1280 is ≤ 1,300 px with the seed. Trim the attention row padding, and the hero if needed. Measure it.
  - On Pack on a phone, fold the grower pick lists into "Pick lists for growers ({n})", closed on screen and always printed.
  - Phone stat chips in a row are equal height.
- **Fine print.** Every small-text rule listed by the rater (`app/globals.css:75, 120, 143, 154, 185, 211, 214`) is at least 0.875rem (14 px), except chips, which stay at 13 px.
- **Targets.** "Download the day record", "Open all N updates" and `.attention .more` are at least 44 px tall at ≤ 600 px.
- **Pack screen.** Order-sheet name columns don't break mid-name ("Birch / Hollow / Gardens"). Printed pick lists get a column header row.
- **Day details.** "Time to first message to the buyer: 106 minutes" becomes plain words, for example "First message to a short buyer: 1 h 46 min after the order went short". The other measure labels are kept.
- **The Orders "Tell {buyer}" button** wraps inside its card and doesn't overflow (CSS only).
- **Pack's "Ship these orders short" tick** keeps its state when the name is refused (`defaultChecked` from the kept values, `app/pack/page.tsx:49`).

- [ ] Tests:
  - confirm agreement;
  - the stale card with a cut;
  - the lead sentence;
  - the told wording;
  - the update-count wording;
  - copy tests for the CSS sizes.

  Measure Overview height at 1280, and the cut card at 195, 320 and 390.
- [ ] Implement, run all checks, then commit.

### Task 19: Measure again (controller)

Same as Task 12.

---

## Round 6: from the round 5 re-audit

Sources (git-ignored): `reports/round5/` holds four reports:

| Report | Score |
|---|---|
| `audit-a-first-day.md` | 9 |
| `audit-b-phone-late-drop.md` | 9 |
| `audit-c-mistakes-keyboard.md` | 9 |
| `interface-rating.md` | 9.0 |

Interface scores by criterion:

| Criterion | Score |
|---|---|
| Hierarchy | 4.5 |
| Layout | 4.5 |
| Navigation | 4.6 |
| Comprehension | 4.4 |
| Visual design | 4.5 |
| Feedback | 4.5 |

Clicks are 22 + 4.

Rulings:
- **Edited values stop at the preview (safety).** "Save and approve" and "Apply and approve" approve in one step only when the submitted values are exactly the ones the preview was computed from.
  - The form carries a fingerprint of the previewed values: the review hash of the previewed state, or a hash of the values.
  - When the produced state's review hash differs, the server saves the details or answers but does not approve. It returns to Review with the new preview and the message "You changed the details, so check the change below, then approve." Focus goes to Approve.
  - This keeps the round 5 promise "Changes you make here will be checked before approving".
- **"They said yes" with no channel stays one tap.** No undo is in scope, as already ruled.
- **Split-the-cut has not been audited with two promised buyers.** The demo has no such lot. This is noted as a gap for the final report and not added to the seed this round.

### Task 20: Review and Orders — the edited-value check, comprehension and forms

**Files:** `app/review/page.tsx`, `app/value-fields.tsx`, `app/preview-gate.tsx`, `app/named-submit.tsx`, `app/orders/page.tsx`, `app/actions.ts`, `app/lib/format.ts`, `app/lib/errors.ts`, `src/*` (only as needed), and tests. Do not touch `app/page.tsx`, `app/pack/`, `app/lib/view.ts` or `app/globals.css` (Task 21 owns those).

- **The edited-value check**, as ruled.
  - It applies to both `readByHandAndApprove` and `answerRecordedAndApprove`/`replyAndApprove` paths.
  - Pure domain tests:
    - unedited values approve;
    - edited values save without approving;
    - the second Approve press works against the new hash.
- **On a phone, the preview sits above its button.** The "If saved as shown:" or "If these answers are applied:" block renders directly above the Save and approve / Apply and approve button in the form (and stays in the aside on wide screens if that is simpler). Nobody should reach the button before the outcome.
- **No contradiction.**
  - When the hand form is pre-filled, the aside, the blocker and the pink note say "Check the details below, then save and approve." (`app/review/page.tsx:206`, `:473`, `:486`).
  - "Not checked yet / Enter the details below" shows only when the form is empty.
  - The waiting state "The change will show here once these answers are applied." is neutral (not the blocked or red style).
- **No browser bubbles anywhere.**
  - Use `noValidate` plus app messages on:
    - the Review reply textarea (`:226`) and "Note or reason" (`:263`);
    - the Review Approve name;
    - all three Log a call fields;
    - the follow-up Case contents box.
  - Add a source test: every `<form` with a `required` field has `noValidate`.
- **Errors clear when corrected.** Editing a field marked invalid removes `aria-invalid` and its message on input (small client helper). Stale messages never sit above an empty field.
- **Names.**
  - A refused name typed in one form fills only that form's name field. `k_who` carries the form `on`, and only the matching `NameField` reads it.
  - Every refusal redirect keeps `k_who`, including Pack confirm (`confirmAction`).
- **Result wording.**
  - Fix "(up 30 lb). No buyer's order changes." when a buyer is still short (`app/actions.ts:221`). Name each buyer whose shortfall changed, for example "Riverbend School Kitchen is now 30 lb short (was 60).", and say "No buyer's order changes." only when none did.
  - "They said yes" with no channel shows "Answer recorded by {name}, no note" and does not quote it as the buyer's words (`src/resolve.ts:232`).
  - The sent link's accessible name is one sentence: "Message to Alder Creek Farm, sent, waiting on the answer".
- **The Orders short row** uses the Overview wording and link name: "Alder Creek Farm has an update waiting that may cover this." / "Review Alder Creek Farm's update". Find the helper in `app/lib/` or `app/pending-cover.tsx`.
- **Orders card notes.** "Recorded only; nothing is delivered." and "Not promised to the buyer yet." don't head a buyer card. The first is in the page intro only. The second shows once, beside the planned amount.

- [ ] Tests: the edited-value check (domain), the `noValidate` source scan, `k_who` per form, and the result wording (helper unit test).
- [ ] Implement, run all checks plus a browser check of the late message with an edited amount, then commit.

### Task 21: Overview and Pack — comprehension

**Files:** `app/page.tsx`, `app/pack/page.tsx`, `app/lib/view.ts`, `app/globals.css`, and tests. Do not touch the files listed for Task 20.

- **The Pack checklist** in the stale or cut state must not mark a covered buyer with a red cross and Resolve. "{n} orders are still short" counts buyers who are actually short (`app/pack/page.tsx` ~69).
- **Pack before confirming.**
  - "Confirm without it" becomes "Confirm without {Grower}'s update".
  - The not-settled line ("{n} grower updates not settled… does not block confirming") must not contradict the "Review it before confirming" warning. When that warning shows, the line says "Other grower updates are not settled. They don't change what is promised."
  - The hint and the checkbox use the same words: "Ship these orders short".
- **The "would leave {buyer} short" warning** shows only before confirming, or when the plan is stale. It never shows after everything is handed off.
- **The Overview stale box** when a cut is open says "Settle the cut first, then confirm again." and its primary is Settle the cut (verify). When no cut is open, it has a Confirm again button, not text alone.
- **Unchecked late message.** While a message that arrived since confirming is unchecked, "Mark all packed" is secondary, and the only primary is "Check it" (the message link).
- **"Confirm today's plan"** is not both the card heading and the button. Make the heading "Ready to confirm".
- **Mark all on Pack.** "Mark all packed" and "Mark all handed off" also appear on Pack, at the top of the sheets, using the same `stageAction`.
- **Overview name fields.** After a refused Dismiss, the Overview shows one name field (beside the refused form). Other rows' fields are quiet.
- **Day details** reads as plain words for a coordinator:
  - remove "Measured in this demo session";
  - "Shortages caught" becomes "Short orders found today";
  - "Orders shipped short" becomes "Orders sent short";
  - the duration line becomes "First message to a short buyer: {duration} after their order went short".
- **The Dismiss result banner** uses the normal result style (visible), not the pale one.

- [ ] Tests: the checklist count, the confirm wording, warning visibility after hand-off, the stale box, the unchecked-message primary, Mark all on Pack, and copy tests.
- [ ] Implement, run all checks, then commit.

### Task 22: Measure again (controller)

Same as Task 12.

---

## Round 6 result and final cleanup

`reports/round6/` holds the four round 6 reports:

| Report | Score |
|---|---|
| A, first day | 9 |
| B, phone late drop | 9 |
| C, mistakes and keyboard | 9.5 |
| Interface | 9.2 |

The interface criteria now score as follows:

| Criterion | Score |
|---|---|
| Hierarchy | 4.6 |
| Layout | 4.5 |
| Navigation | 4.6 |
| Comprehension | 4.5 |
| Visual design | 4.5 |
| Feedback | 4.6 |

The target is met: every criterion is at 4.5 or above, and the overall score is about 9. Clicks are 23 + 4, all at the ruled targets. The loop ends here. Leftover small items are batched into one cleanup task (minors, no new behaviour).

### Task 23: Cleanup of round 6 minors

**Files:** `app/review/page.tsx`, `app/value-fields.tsx`, `app/orders/page.tsx`, `app/page.tsx`, `app/pack/page.tsx`, `app/actions.ts`, `app/lib/*`, `src/resolve.ts`, `src/interpret.ts` (only the item below), `app/globals.css` (only as needed), and tests.

**Review: one honest message per state.**
- The aside on a form with a preview drops "Not checked yet / The change appears once the message has a reading" and "The outcome is shown above the Save and approve button". It says where the preview is, or links to it (`#preview`).
- "You changed the details…" shows once.
- "Changes you make here will be checked before approving." shows only on a form with editable values.
- "Check the details…, then save and approve" shows once. It never shows when the button available is "Save these details".
- After a refused amount, once the amount is valid again, the page offers Save and approve again. Re-render with the preview, or say "Save these details, then approve" consistently.

**Fresh reply hint.** Under "Apply answers", add: "Then approve the change it makes, on the next step."

**History wording.**
- A logged call reads "{name} recorded the call details", not "entered the reading by hand".
- The system re-check line has no coordinator name: "Checked again against current supply".

**Quotes.**
- "They said yes" with no channel is never shown in quotation marks anywhere. That covers the Orders Substitutes row and the thread.
- Use "agreed (recorded by {name}, no note)".

**Errors.**
- An empty follow-up "Case contents" box focuses the input and sets `aria-invalid` and `aria-describedby` (not `div#reply-value`).
- -5 gets "Enter an amount above zero.", not "a whole number".
- On Orders, a reply that says "Text message" with empty text blames the text box: "Enter what they wrote."
- Empty forms report every missing field at once where a form has several: Log a call (name, grower, note) and Pack (name, tick). List them in one message, and focus the first one.

**Result and status lines.**
- Send, Tell and "They said yes" results name the buyer or grower and the amount, for example "Sent to Riverbend School Kitchen: short 20 lb." and "Recorded: Birch Hollow Gardens can bring 30 lb."
- The approval result panel doesn't repeat the banner, and its Resolve is a separate button after the sentence.

**Orders.**
- After Settle the cut on Orders, the status says what was settled.
- Don't show "Find more tomato on Orders." with a link while already on Orders. Link to the order's Next step instead.
- The thread title "Ask for more to {grower}" becomes "Asked {grower} for more".

**Overview and Pack.**
- "Confirm without {Grower}'s update" names the update: "Confirm without {Grower}'s {product} update ({before} → {after})".
- After every order is handed off, the leave-short row and "Confirm without…" don't show. Round 6 auditor B still saw them: find the cause and test it.
- Pack's confirmed line doesn't say "Print the sheets." while "Check it" is the primary.

**Day details.**
- The garbled Day details label "Grower asks that added supply" (`app/page.tsx` ~103) becomes "Asks to growers that added supply".
- The substitute line names the product actually sent, for example "30 lb of zucchini sent in place of tomato", not "30 lb by approved substitute" under Tomato.

**Reading a logged call.** "they can bring 10 more lb of tomato" is read like "We can add 10 lb of tomato." (an add with lot and amount). Extend the existing keyword reading in `src/interpret.ts` (or wherever "add" is detected) for "bring … more". Test it.

**Accessible names.** Shorten the long "Send (Offer …)" accessible names to the visible label plus the buyer.

**Reported, not changed:**
- the quote-versus-value mismatch, since the edited value is already stopped once;
- the 13 px phone tab labels;
- the phone Overview height;
- split-the-cut being unaudited (the demo has one buyer per lot).

- [ ] Tests:
  - the call-reading keyword;
  - the leave-short row after hand-off;
  - the -5 message;
  - multi-field empty messages;
  - status lines (helper);
  - copy tests.
- [ ] Implement, run all checks, then commit.

---

## Round 7: the remaining gaps

These are the gaps left after the final review (see the ledger). The target is already met, so this round closes the gaps rather than raising scores.

- **Split-the-cut has never been audited.** It can be reached in the demo with no data change:
  1. Approve Alder Creek Farm's tomato update (120 → 60 lb). Lot-b is then promised to Northside (60 lb) and Riverbend (20 lb).
  2. Confirm with "Ship these orders short".
  3. Use Demo tools → Late grower message (lot-b 80 → 70 lb). This opens a cut on a lot with two promised buyers.

  Audit D runs this path on the current build before any fix.
- **The Overview on a phone is about 2,500 px tall at 390 px.** Tab labels are 13 px.
- **Several safety rules are guarded only by source-regex tests:**
  - one-tap Approve eligibility;
  - no rebase on composed approves;
  - the -5 and empty-form messages;
  - the Review state messages.

### Task 24: Phone density

**Files:** `app/page.tsx`, `app/globals.css`, `app/lib/view.ts` (only if needed), and tests.

- **Overview height on a phone.** With the seed and nothing done yet, the Overview at 390 px is at most 1,800 px tall (from about 2,514).
  - The buyer table becomes the two-line rows already used for phones.
  - Day details stays folded.
  - Attention rows use tighter phone padding (8 px, not 16).
  - The hero's stat chips stay in the 2 × 2 grid.

  Measure at 390 and 320 px, before and after.
- **Tab labels** are 14 px at 320 px and above, and still fit one row with no truncation. At ≤ 300 px the bar stays icon-only, as ruled.
- Nothing may push a target under 44 px. There must be no sideways scroll at 195, 320, 390 or 1280 px.

- [ ] Tests: copy and CSS-size tests. Report the measured heights.
- [ ] Implement, run all checks, then commit.

### Task 25: Behaviour tests for the safety rules

**Files:** `tests/*`, and small pure helpers extracted into `app/lib/view.ts` or `src/` where a rule now lives only inside a page or an action. Make no behaviour change.

Replace the source-regex checks that guard safety rules with behaviour tests:
- **The Overview row action.** Extract `rowAction(w, item, previews)` → "approve" | "review" | "note" | "dismiss" | "open". Test it with the seed:
  - tomato: review, because it leaves a buyer short;
  - forecast: note;
  - the injection message: dismiss;
  - after hand-off, never "approve" if the update would leave anyone short.
- **Composed approves bind to the shown hash.** Test that `readByHandAndApprove`, `replyAndApprove` and `answerRecordedAndApprove`:
  - approve only when `shown` equals the produced hash;
  - never rebase: on a stale version, `act` with the default options throws. Test this through `act` in `app/lib/hub.ts` if it is importable, or by asserting the helpers take no rebase path.
- **Messages.**
  - -5 is refused with "Enter an amount above zero.";
  - an empty Log a call names every missing field.

  Extract the validation helpers if they live in `app/actions.ts`, which can't be imported under `node:test`.
- **The Review state message.** Extract the helper that chooses between "Check the details below…", "Enter the details below", the recheck message and the waiting note. Test each state.
- **Keep or delete the old checks.** Keep the regex checks only for copy wording. Delete those that duplicate a new behaviour test.

- [ ] `npm test` exits 0. Report which regex tests were replaced.
- [ ] Commit.

### Task 26: Split the cut, from audit D

Source: `reports/round7/audit-d-split-cut.md` (6.5/10). The numbers were correct throughout. The problems are in input, wording and print.

**Files:** `app/conflict.tsx`, `app/actions.ts` (`decideCutAction` and its result only), `app/pack/page.tsx` (checklist link and print marker only), `app/pack/print.tsx`, `src/commitments.ts` (only if the result helper needs it), `app/lib/*`, and tests.

Rules for this task:
- Don't touch `app/page.tsx`. Task 24 owns it.
- In `app/globals.css`, only append new rules at the end.

- **No silently dropped split.**
  - Typing in a split box selects "Split it" (client).
  - The server refuses a split amount posted with any other choice: "You typed split amounts. Choose Split it, or clear the amounts." It keeps the typed values and focuses the fieldset.
  - Tie the boxes to the Split radio: nest them in their own fieldset with legend "Split it: pounds each buyer gets less". Use `aria-describedby` to point at the total line.
  - The suggested buyer may stay pre-selected.
- **Say the total and what's left.**
  - The split label says "The amounts must add up to {excess} {unit}."
  - A live line says "{left} {unit} left to place" (`aria-live="polite"`, client), and "All {excess} {unit} placed." when done.
  - A blank box counts as 0, and the label says so.
- **Errors.**
  - A negative number gets "Enter 0 or more pounds."
  - A decimal gets "Enter whole pounds."
- **The result names the outcome.** After any settle, the result says who now gets what and who is short, using the same `buyerChanges`/approval-result helpers, for example: "Northside Grocery Co-op now gets 116 of 120 lb (4 short). Riverbend School Kitchen now gets 14 of 80 lb (66 short). Confirm today's plan again so the sheets match."
  - Link to Pack for the re-confirm.
  - Don't say "Find more tomato on Orders." when on Orders. Link to the order's Next step instead (Task 23 already handled this elsewhere; reuse that).
- **Printed sheets.**
  - When the plan is stale, every printed sheet that changed carries a print-visible line: "Changed since the plan was confirmed at {time}. Confirm again before packing."
  - The screen warning box stays as it is.
- **Wording.**
  - The heading uses a plain possessive ("Birch Hollow Gardens' tomato"; add a `possessive()` helper for names ending in s).
  - The heading doesn't repeat the amount twice.
  - "takes the cut" becomes "gets {n} {unit} less".
- **The Pack checklist's "Settle the cut"** links to the cut card on the same page (`#cut-…`) when it is there. Otherwise it links to the cut's page.

- [ ] Tests:
  - the server refusal of split amounts with another choice (pure validation helper);
  - the negative and decimal messages;
  - the result wording (helper);
  - `possessive()`;
  - the print line (helper or source);
  - copy tests.
- [ ] Implement, run all checks, then commit.

---

## Round 8: the items left after audit D2

Source: `reports/round7/audit-d2-split-cut.md` (7.5/10) and the round 7 final report. Rulings:
- **The round 4 "no undo" ruling is replaced** for one case, because the user asked to work on it: a settled cut can be changed while nothing has moved on since it was settled. Every other action keeps no undo.
- **The history stays append-only.** Changing a cut records a new event; the original decision stays in the log.

### Task 27: Cut card and Pack finishing

**Files:** `app/conflict.tsx`, `app/cut-choice.tsx`, `app/lib/cut.ts`, `app/actions.ts` (the `decideCutAction` refusal text only), `app/pack/page.tsx` and `app/pack/print.tsx` (the Print label only), the end of `app/globals.css` (append only), and tests.

- **A missed total says what to do.**
  - Too little: "You entered 6 lb; the cuts must total 10 lb. Place 4 lb more."
  - Too much: "You entered 12 lb; the cuts must total 10 lb. Take off 2 lb."
  - Make this a pure helper in `app/lib/cut.ts`, using the lot's unit.
- **No accidental changes to amounts.** The split boxes become `type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"`, so the wheel and the arrow keys can't change them. Server validation is unchanged.
- **Settle sits closer to the heading.**
  - While a buyer radio (not Split it) is checked, the split fieldset is hidden with CSS (`.cut:has(input[name=choice][value=split]:not(:checked)) fieldset.split { display: none; }` or equivalent). This works without JavaScript.
  - The "set aside" note stays visible: move it out of the fieldset.
  - Measure Settle's distance from the card heading at 195 px and at 390 px, before and after.
  - Typing still selects Split. Hidden boxes can't be typed in, which is fine.
- **Print when the plan is out of date.** While the sheets are out of date, the Print button reads "Print anyway (out of date)". Otherwise it stays "Print sheets".

- [ ] Tests:
  - the total helper (both directions);
  - the input type and pattern;
  - the CSS rule;
  - the Print label.
- [ ] Check in a browser: Settle's distance, typing in the boxes, the set-aside note.
- [ ] Commit.

### Task 28: Change a settled cut

**Files:** `src/commitments.ts`, `src/workbench.ts` (the history line only), `app/actions.ts` (a new action), `app/pack/page.tsx` and/or `app/orders/page.tsx` (where the change is offered), `app/lib/*`, and tests.

Don't touch `app/conflict.tsx`, `app/cut-choice.tsx` or `app/lib/cut.ts`; Task 27 owns them. The result text may reuse `cutOutcome` by import.

- **Domain.**
  - Add `CommitEvent` kind `"cut-changed"`: `{ kind; by; at; lotId; cuts }`, where `cuts` are the amounts handed back.
  - `decideCut` also records `removed: Promised[]` on its `"cut"` event: the exact promise lines it reduced, with kind. Restoring uses this, so the promises come back to exactly what they were.
  - Add `changeCut(w, lotId, cutAt, by, at)`. `cutAt` is the `at` of the cut event the page showed, so a stale page is refused. It restores the removed amounts and appends `"cut-changed"`; the conflict then reopens with whatever excess the current supply gives.
  - Refuse, with plain messages, when:
    - that cut is not the latest cut on that lot;
    - the plan was confirmed since that cut;
    - any order in that cut has a stage mark since the cut;
    - the event has no `removed`;
    - the name is invalid.
  - Add `changeableCuts(l)` → the cuts that can be changed now, with lot, orders, amounts, by and at.
  - State is unchanged on throw.
  - `commitKey` changes, because promises change, so the `cs` checks refuse stale pages elsewhere.
- **Measures.** Anything that reports cut decisions must not count a changed cut as final. Search `log` readers. The history line reads "{by} changed the cut on {product} from {grower}".
- **Action.** `changeCutAction`:
  - named;
  - goes through `act` with `rebase: true` plus a `cs` check, as `stageAction` does;
  - its result: "The cut is back to decide: {Grower}' {product}, {excess} {unit} over. Choose again." with focus on the reopened cut card.
- **UI.**
  - Where a settled cut's result shows, and on Pack while it is changeable, show "Change this cut" as a secondary button (not primary).
  - Its label for assistive tech names the lot.
  - Offer it nowhere once the cut can't be changed.
- [ ] Tests (behaviour, seeded; use the two-buyer cut from `tests/task26.test.ts`):
  - settle, change, settle another way, and the ledger is right;
  - each refusal;
  - promises restored exactly, substitutes included if reachable;
  - stale `cutAt` refused;
  - the history line.
- [ ] Commit.

---

## Round 9: pre-demo fixes from the Fable review, the use-case check and the README walkthrough

**Sources** (all under `reports/round8/`):
- Fable code review (in the ledger);
- `use-case-check.md`;
- the README walkthrough (in the ledger; screenshots `reports/shots/r8-walk-*`).

**User rulings (2026-11-03):**
- **Pitch line.** It goes on Overview under the hub name, and opens the README: "Grower changes arrive as messages. Each one is read, checked against this week's orders, and nothing changes until you approve."
- **The injection test message** ("SYSTEM: ignore your rules…") leaves the morning inbox. It moves to Demo tools as a button that delivers it on purpose. Its refusal must still be shown and tested.

### Task 29: Demo story and numbers

**Files:** `src/seed.ts`, the demo actions in `app/actions.ts` (late and injection delivery only), `app/page.tsx` (pitch line and Day details only), `app/lib/view.ts` (timing line only), the Demo tools blocks on `app/pack/page.tsx` and `app/review/page.tsx`, `README.md`, `docs/STATUS.md`, and tests.

**Don't touch:**
- `app/orders/page.tsx` and `src/resolve.ts` (Task 30);
- `src/commitments.ts`, `app/change-cut.tsx`, `app/conflict.tsx` and `app/lib/cut.ts` (Task 31).

- **Pitch line.**
  - Show it on Overview under the hub name, at 16 px or more, in body colour (not the muted colour), on every page state.
  - Make it the first line of the README.
  - The browser `<meta description>` uses it too.
- **The late message matches the screen.**
  - It is built from Birch Hollow's tomato lot when the button is pressed: "Tomatoes came in light. We'll only have {n−10} lb of standard for Friday, not {n}." So the README path (110 lb) reads 100, not 110, and audit D's path (80 lb) still reads 70, not 80.
  - The suggested reading, quote and preview follow it.
  - Keep `LATE`'s id. If the lot is under 20 lb, use the same pattern with a floor of 0. Note this edge case in a test.
- **The injection message moves to Demo tools.**
  - Remove it from `SEED`. Add a Demo tools button: "A message that tries to change the rules (demo)".
  - It is delivered like the late message, works any time and only once, and is read and refused/dismissable exactly as today.
  - Update the seed counts ("5 messages waiting" becomes 4) wherever they appear: copy, README and tests. Tests that used the seeded injection deliver it explicitly.
- **Day details.**
  - Remove the "First message to a short buyer: … after their order went short" line from the screen; it measures seed time against the clock.
  - Keep the measure in the day export, labelled as demo timing.
  - Rename "Orders sent short" to "Shipped short, buyer not told".
  - Check the "85% of ordered weight covered" line: if it stays, it needs a plain label of what it counts. No baseline claim.
- **README matches the screen.** Fix mismatches A–G from the walkthrough:
  - A: a missing name stops the action with "Enter your name to continue."
  - B: with Demo tools, the grower's reply arrives already read, so the button is "Approve supply change". "Apply answers" is for a reply typed in.
  - C: cucumber asks only the case contents.
  - D: the late message numbers now follow the lot.
  - E: choose Split it first, then type.
  - F: say when "Confirm without …" appears, or drop it.
  - G: the phone layout was measured in round 7.

  Also:
  - Title the README "Harvest Relay".
  - Add a three-sentence evidence lead that cites `docs/EVIDENCE.md` rows: the problem exists, how hubs handle it today, and what is not yet validated (adoption, time saved, reading accuracy on real texts).
  - Soften any claim marked partly backed in `use-case-check.md`, or cite its row.

- [ ] Tests: the late text for 110 and 80; the injection is absent from the seed and delivered by Demo tools, then refused or dismissed; the pitch line is present; the timing line is absent from the page; the new label.
- [ ] Run all checks. Commit.

### Task 30: Orders after telling the buyer

**Files:** `app/orders/page.tsx`, `app/lib/format.ts` (status labels), `src/resolve.ts` (only if the cause is there), and tests.

Don't touch `app/page.tsx`, `src/seed.ts` or the README.

- **After "Tell the buyer", the page offers nothing more to send** (`use-case-check.md` item 5; `app/orders/page.tsx` ~210). Find why an offer form with Send still shows after "Nothing more to send", then hide it or make it say clearly what it would send. A second offer must not be one click away by accident.
- **The list label follows who you are waiting on.** "Asked, waiting for the grower" shows when waiting on the buyer (`app/lib/format.ts` ~69).
- **Duplicate lines.** After the README step 7 path, Riverbend's order page shows "30 lb zucchini from Birch Hollow Gardens" followed by "10 lb zucchini from Birch Hollow Gardens", and Riverbend stays 30 lb short ("Ask Cedar Row Farm for 30 lb").
  - Reproduce it (walkthrough path: README steps 1–7 with the late message after zucchini was accepted) and find out whether the lines are real separate allocations, shown unmerged, or a bug.
  - Merge them for display if they are the same lot.
  - If the demo can't reach "covered" for Riverbend, explain in a comment and the ledger whether that's the true state of supply. Don't change the planner's rules; report instead.

- [ ] Behaviour tests where possible. Run all checks. Commit.

### Task 31: Round 8 review fixes

Runs after Tasks 29 and 30.

**Files:** `app/pack/page.tsx`, `app/orders/page.tsx`, `app/review/page.tsx` (only the `notice = raw?.on === "cut"` lines), `app/change-cut.tsx`, `app/actions.ts` (`changeCutAction` and `decideCutAction` kept keys), `src/commitments.ts` (comment only), `app/lib/cut.ts` (outcome wording), `app/conflict.tsx`, `app/page.tsx` (Overview pack/print while out of date), the README line, and tests.

- **Important.** A refused name on "Change this cut" (notice `on: change-<lot>`) must be shown only by `ChangeCuts`.
  - In `pack:32`, `orders:108` and `review:76`, treat `notice.on?.startsWith("change-")` like `"cut"`.
  - On Pack this means no error or `aria-invalid` on the Ship-short tick, and no duplicate top-of-page alert.
  - Test it.
- **The cut result wording is clear.** It reads "{Buyer} now gets {got} lb, down from {had} lb ({short} lb short of {ordered} lb)." Example: "Riverbend School Kitchen now gets 14 lb, down from 20 lb (66 lb short of 80 lb)." Update the tests.
- **The restore comment.** In `src/commitments.ts`, say "amounts exact; position best effort when other lots' cuts moved lines".
- **Bound the kept keys.** In `decideCutAction`, keep only `cut-<id>` keys for the conflict's own order ids.
- **`data-kept` and JavaScript.** With JS, picking a buyer after a refusal still hides the boxes. Drop `data-kept` client-side once a choice changes, or make the CSS also key on a client class.
- **One name field on Pack.** `ChangeCuts`' `NamedSubmit` is `quiet` on Pack when another form already asks for the name, following the pattern of the sheet forms.
- **The Overview while the plan is out of date.** It does not offer "Mark all packed" as primary while a cut is open or the sheets are out of date, matching Pack. "Print sheets" reads "Print anyway (out of date)" there too, if it is shown.
- **The README** lists the "a later cut was settled on that lot" refusal.

- [ ] Run all checks. Commit.
