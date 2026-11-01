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
