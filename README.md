# Harvest to order — Meta hackathon prototype

Lead direction selected by the project owner on October 26, 2026. Working description, not a settled brand.

Help small food-hub coordinators reconcile changing grower availability against existing buyer orders. Growers provide updates; buyers define acceptable products/grades/substitutions; the coordinator reviews changes. Reducing avoidable food loss is an intended outcome, not a demonstrated result.

## Run

Requires Node 24.12–24.x. Zero runtime packages, pinned TypeScript development dependencies.

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run demo
```

`npm run demo` runs authored synthetic inputs with hand-authored update proposals. It performs no model inference or network requests. The coordinator web app (`npm run build && npm run start`, on 127.0.0.1:3600) is local only: there is no deployment, customer connector, authenticated multi-user service or message delivery yet. Live model calls are off unless the server sets an allowance.

## What works

- Confirmed supply and existing demand, supplied delivery date, product/grade requirements and explicit substitution permissions.
- Integer grams/counts, explicit case contents, missing-pack clarification and no guessed count-to-weight conversion.
- Update review over an in-memory ledger (`src/updates.ts`): immutable source ID/revision records with character-span evidence; explicit new-total, added-quantity, correction, forecast and unresolved operations; linked clarification questions/answers inside the reviewed hash; exact-proposal approval; ledger-version and snapshot-hash staleness checks; duplicate/conflicting/superseded source-revision rejection; append-only event history with before/after quantities and hashes.
- Any unresolved operation, lot, grower, quantity, unit, pack, grade, date, correction target or open clarification blocks inventory change. Forecasts are recorded beside the snapshot and never reach the planner.
- Meta interpretation boundary (`src/interpret.ts`), disabled by default: builds a Meta Model API Chat Completions request with a strict JSON schema and only the sender's own lots; validates the response locally; maps it to an unapproved proposal for the same review/approval flow. Unknown references, contradictions, malformed/truncated/refused output and timeouts never produce a proposal; values without a verbatim quote are dropped so review asks for them. One call per invocation, no retries, explicit call budget and size/token/time bounds. Live calls run only when explicitly enabled with a budget; the approved live checks and evaluations so far, and the demo seed readings recorded at prompt v4, are listed in `docs/STATUS.md`.
- Deterministic allocation proposals and full unfilled/unallocated balances, independently verified for eligibility and conservation.
- 281 automated tests, including 200 generated planning scenarios and a 150-step generated update sequence. These are not held-out customer cases or evidence of model performance.

The heuristic considers all direct demand before approved substitutes, then supplied priority and stable IDs. It does not guarantee globally optimal allocation. Grades and permissions are supplied customer rules, not AI food-safety assessments. Both lot and order use the same confirmed delivery date; multi-leg logistics, storage, transport capacity and refrigeration are outside this slice.

## Demo walkthrough (local app)

1. Press **Reset demo** (it asks for confirmation and clears the remembered name). Five morning messages are read from recordings and wait on the Overview. Until a name is given the header shows "Not signed in · set name"; the name is asked beside the button on the first action that records something, and no action records "Coordinator".
2. On the Overview, approve the ready updates from their rows. The cucumber and zucchini messages each leave a detail open: open them in Review updates, press **Receive the grower's reply (demo)**, pick the answer to "What changed" (and, if wanted, a quote from the grower's words), then approve. The forecast is noted, not applied to confirmed supply, and messages read as no change can be dismissed from the row. This leaves Riverbend School Kitchen 60 lb short of tomatoes.
3. In Orders, use the **Next step** card. **Send** goes in one step unless the words need confirming or the check flags something, in which case it stops at the draft. Ask Birch Hollow for more, read and approve the reply, offer zucchini, and record the buyer's answer as yes or no. **Log a call** is a tab.
4. When nothing is waiting, the Overview shows an all-clear card with **Confirm today's plan**; "New since you confirmed" lists what changed afterwards. (Confirm is also in Pack.) Every line becomes a promise. In Pack, **Print** sits in the confirmed group and prints one sheet per page, with the buyer or grower name and the confirm time.
5. Press **Late grower message (demo)** (in the Demo group). Birch Hollow's message (70 lb of standard tomatoes, not 110) arrives in Review unread. Read it by hand and approve it.
6. The cut card sits at the top of the review and says what can no longer be filled and suggests who takes the cut. Choose, or split it, then press **Settle the cut**.
7. Open Orders for the order that is short again and cover it as in step 3. Pack shows the changed lines; **Confirm again** is the main button while the plan is out of date, and names the buyers whose sheets are out of date. When the day is done, **Mark all packed** and **Mark all handed off** record each stage for every order that can take it.

Nothing is delivered; messages go to an outbox only.

## Read next

- `docs/PRODUCT-CANVAS.md`: evidence, canvas, SWOT, scope and validation gates.
- `docs/STATUS.md`: verified behavior, limitations and recovery.
- `docs/EVIDENCE.md`: what each claim rests on. Impact is stated as measurable outputs only (shorts detected, how each was resolved, minutes to the first buyer message), measured in the demo session; no time or money saved is claimed.
- `docs/VALIDATION.md`: operator questions and evaluation protocol.
- `docs/NOTION-UPDATE-PROPOSAL.md`: proposed documentation changes awaiting approval.
- `docs/TRACKING.md`: Asana IDs and portfolio-placement status.

## Provenance and limits

New isolated local source, actual October 26 timestamps preserved. The official website says kickoff begins October 26; the supplied guide labels October 27–November 4 the building period. Eligibility is unresolved; do not treat this code's date as approved event contribution. See HTO01 in Asana.

Paid inference has been limited to approved, budgeted evaluation and recording runs (costs in `docs/STATUS.md`). No outreach, external publication, deployment or submission occurred. No eligible Meta model has yet contributed to this prototype; it is not submission-ready. Intended Meta role is interpretation and evidence-gathering, subject to a real comparison with competent manual/structured intake using the same planner.

All included scenario records are authored synthetic examples. Do not add real customer records, contact details, credentials or licensed third-party datasets/manuals to a public repository. A public-source license has not been selected; publication requires a rights/license review and the project owner's approval.
