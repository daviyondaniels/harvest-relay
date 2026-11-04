# Harvest Relay

Grower changes arrive as messages. Each one is read, checked against this week's orders, and nothing changes until you approve.

**Evidence.** Balancing supply and demand was the top challenge hubs reported in every National Food Hub Survey from 2013 to 2019, and a closed hub's marketplace could not track whether a farmer was going to run out (`docs/EVIDENCE.md`, "The problem is real, but nobody has measured it"; E3). Today a grower tells staff by phone or message, and staff source from another member or non-member or tell the customer (`docs/EVIDENCE.md`, "Hubs handle shortfalls with a routine"; E1 for the phone caveat). Not yet validated: whether coordinators would adopt this, how much time it saves (no source gives one, so none is claimed; E24), and how accurately messages are read on real grower texts (the test sets are authored and no coordinator has been interviewed).

Help small food-hub coordinators reconcile changing grower availability against existing buyer orders. Growers provide updates; the coordinator reviews each change; a substitute is offered only with the buyer's recorded yes (E8; that a buyer defines its own substitution list is an assumption still to test). Reducing avoidable food loss is an intended outcome, not a demonstrated result. Lead direction selected by the project owner on October 26, 2026; a working description, not a settled brand.

## Run

Requires Node 24.12–24.x. Pinned Next.js and React runtime dependencies and TypeScript development dependencies.

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run demo
```

`npm run demo` runs authored synthetic inputs with hand-authored update proposals. It performs no model inference or network requests. The coordinator web app (`npm run build && npm run start`, on 127.0.0.1:3600) is local only: there is no deployment, customer connector, authenticated multi-user service or message delivery yet. Live model calls are off unless the server sets an allowance.

## Isolated judge demo

Build once, then set `HARVEST_PUBLIC_DEMO=1`, `HARVEST_LIVE_CALLS=0` and `HARVEST_DB=data/demo.db` in the server environment before `npm run start`. PowerShell example:

```powershell
$env:HARVEST_PUBLIC_DEMO='1'
$env:HARVEST_LIVE_CALLS='0'
$env:HARVEST_DB='data/demo.db'
npm run start
```

Open `/start`; each new visitor starts an independent synthetic workspace and lands on `/guide`. Reads, changes, reset and export use that workspace. Public demo mode refuses live model calls even if a server allowance is configured. It replays the included `data/seed-readings.json`; optional `data/demo-extras.json` is not needed to build or run. Missing recordings leave messages for manual review.

Visitor cookies are random HttpOnly bearer capabilities, not account authentication. Workspaces expire after 12 hours without extension, have a 1 MiB state limit and a maximum of 100 active sessions per database. Expired rows are reclaimed on creation. Starting another demo consumes another slot until expiry. Reset affects the current workspace. Do not put customer data in this mode. For HTTPS hosting set `HARVEST_SECURE_COOKIES=1`; provide persistent local storage and a single application host. Public traffic limits and TLS belong at the hosting boundary. This app does not supply organization accounts or distributed storage.

The current font and SIL license are bundled in `app/fonts/`; production builds no longer fetch Google Fonts. CI is configured to verify Linux and Windows installation, tests, typecheck and build with live calls off. It does not deploy.

Existing orders support quantity changes through Orders → Adjust order quantity. Preview all affected buyers, then confirm with a name and reason. Changes cannot reduce demand below promises, edit packed orders, or bypass an open request. Quantity-only changes invalidate affected confirmed sheets even if allocated supply stays the same. History is in the adjustment screen and day export.

See [the implementation plan](docs/implementation/2026-11-03-road-to-nine.md), [operator validation protocol](docs/implementation/operator-validation.md), and [three-minute recording plan](docs/implementation/submission-demo.md). These are preparation materials; public repository visibility, a finished video and external judge access still require release verification.

## What works

- Confirmed supply and existing demand, supplied delivery date, product/grade requirements and explicit substitution permissions.
- Integer grams/counts, explicit case contents, missing-pack clarification and no guessed count-to-weight conversion.
- Update review over an in-memory ledger (`src/updates.ts`): immutable source ID/revision records with character-span evidence; explicit new-total, added-quantity, correction, forecast and unresolved operations; linked clarification questions/answers inside the reviewed hash; exact-proposal approval; ledger-version and snapshot-hash staleness checks; duplicate/conflicting/superseded source-revision rejection; append-only event history with before/after quantities and hashes.
- Any unresolved operation, lot, grower, quantity, unit, pack, grade, date, correction target or open clarification blocks inventory change. Forecasts are recorded beside the snapshot and never reach the planner.
- Meta interpretation boundary (`src/interpret.ts`), disabled by default: builds a Meta Model API Chat Completions request with a strict JSON schema and only the sender's own lots; validates the response locally; maps it to an unapproved proposal for the same review/approval flow. Unknown references, contradictions, malformed/truncated/refused output and timeouts never produce a proposal; values without a verbatim quote are dropped so review asks for them. One call per invocation, no retries, explicit call budget and size/token/time bounds. Live calls run only when explicitly enabled with a budget; the approved live checks and evaluations so far, and the demo seed readings recorded at prompt v4, are listed in `docs/STATUS.md`.
- Deterministic allocation proposals and full unfilled/unallocated balances, independently verified for eligibility and conservation.
- Automated regression tests, including 200 generated planning scenarios and a 150-step generated update sequence. These are not held-out customer cases or evidence of model performance.

The heuristic considers all direct demand before approved substitutes, then supplied priority and stable IDs (that the lowest-priority buyer is cut first is an assumption, shown on screen so the coordinator can choose differently; E15). It does not guarantee globally optimal allocation. Grades and permissions are supplied customer rules, not AI food-safety assessments. Both lot and order use the same confirmed delivery date; multi-leg logistics, storage, transport capacity and refrigeration are outside this slice.

## Demo walkthrough (local app)

1. Press **Reset demo** (in the Menu or More; it asks for confirmation and clears the remembered name). Four morning messages are read from recordings and wait on the Overview. Until a name is given the header says "Name not set" with a **set name** link. The name is asked beside the first button that records something and is remembered (for 12 hours) only after that action succeeds; no action records "Coordinator", and a missing name stops the action with "Enter your name to continue."
2. On the Overview, the forecast row has **Note this forecast** (it is noted, not applied to confirmed supply). The tomato update would leave Riverbend School Kitchen 60 lb short, so its row says **Review it** instead of Approve: open it in Review updates and press **Approve supply change**. The cucumber message leaves one detail open (the case contents) and the zucchini message two (the case contents and whether it is the new total): open each in Review updates, open **Demo tools** and press **Receive the grower's reply (demo)**. With the recordings in this checkout the reply arrives already read, so the button is **Approve supply change**. A reply typed in by hand is **Apply answers**, then **Approve**. Riverbend ends 60 lb short of tomatoes.
3. To see a message that tries to change the rules, open **Demo tools** in Review updates (or Pack, once the plan is confirmed) and press **A message that tries to change the rules (demo)**. It arrives once, any time, is read from its recording as no change, is labelled "Looks like an instruction, not a harvest update" and has **Dismiss**; nothing in supply changes.
4. In Orders, use the **Next step** card. **Record message** records an outbox entry in one step unless the words need confirming or the check flags something, in which case it stops at the draft. Ask Birch Hollow for more (**Demo tools** has **Receive the grower's reply (demo)**), read and approve the reply (without the optional local recordings, check the supplied details by hand and use Save and approve), offer zucchini, and record the buyer's answer with **They said yes** or **They said no**; with no channel recorded the thread reads "Answer recorded". **Log a call** is a tab.
5. When no order is short, no cut is open and no waiting update would leave an order short, the Overview offers **Confirm today's plan** ("Ready to confirm" or at the foot of "Needs your attention"). If a waiting update would leave an order short, Overview and Pack say so and link to it; Pack then also offers **Confirm without {Grower}'s {product} update**, before the plan is confirmed or while it is out of date. "New since you confirmed" lists what changed afterwards. Every line becomes a promise. In Pack, **Print sheets** sits in the confirmed group and prints one page per buyer or grower, each with the hub, delivery day, name, the confirm stamp and column headers.
6. In Pack, open **Demo tools** and press **Late grower message (demo)**. Birch Hollow's message is built from their tomato lot as it stands: 10 lb less than the screen shows (100 lb of standard tomatoes, not 110, after step 4; 70, not 80, if you skip the ask). It arrives in Review unread, with its details filled in from the message. Check the outcome shown (for example 110 lb to 100 lb, down 10 lb) and press **Save and approve**, which approves in one press only when the values are exactly the ones shown; if you edit a value it saves and stops at the new preview.
7. The cut card sits at the top of the review and says what can no longer be filled and suggests which buyer gets less. Choose one buyer, or choose **Split it** first and then type amounts (a line says how much is left to place), then press **Settle the cut**. The result says what each affected buyer now gets and how short they are. Until the plan is confirmed again, **Change this cut** puts the promises back and reopens the card to choose again; both decisions stay in the history.
8. Open Orders for the order that is short again and cover it as in step 4. Pack shows the changed lines; **Confirm again** is the main button while the plan is out of date, and names the buyers whose sheets are out of date. A changed order cannot be marked packed or handed off until reconfirmed; unchanged orders can continue. When the day is done, **Mark all packed** and **Mark all handed off** (Overview or Pack) record each stage for every order that can take it.

On a phone (up to 600 px wide) a bottom tab bar holds the five pages and Pack folds the grower pick lists under one line. The layout at 390 px and 320 px and the 44 px targets were measured in a browser in round 7 (`docs/STATUS.md`).

Nothing is delivered; messages go to an outbox only.

## Read next

- `docs/PRODUCT-CANVAS.md`: evidence, canvas, SWOT, scope and validation gates.
- `docs/STATUS.md`: verified behavior, limitations and recovery.
- `docs/EVIDENCE.md`: what each claim rests on. Impact is stated as measurable outputs only (shorts detected, how each was resolved); the minutes to the first buyer message are kept in the day export as demo timing, not shown as a result (E24). No time or money saved is claimed.
- `docs/VALIDATION.md`: operator questions and evaluation protocol.
- `docs/NOTION-UPDATE-PROPOSAL.md`: proposed documentation changes awaiting approval.
- `docs/TRACKING.md`: Asana IDs and portfolio-placement status.

## Provenance and limits

Actual October 26 timestamps are preserved. The public event page identifies October 26 kickoff and October 27–November 4 workshops. Participant-specific eligibility and contribution disclosures must still be checked against the accepted rules and submission form; no commit date alone establishes eligibility. See HTO01 in Asana.

Muse Spark has contributed actual message and reply interpretations through approved, budgeted evaluation and recording runs (costs and limitations in `docs/STATUS.md`). The default web demo replays recorded model output through validation and named approval; it does not perform live inference. Live interpretation is opt-in and budgeted. The planner and permission checks are deterministic. All included inputs are synthetic; model results do not establish real operator performance or food saved. The application has been inspected through a private Tailscale URL; public judge access and submission remain separate verification gates.

All included scenario records are authored synthetic examples. Do not add real customer records, contact details, credentials or licensed third-party datasets/manuals to a public repository. A public-source license has not been selected; publication requires a rights/license review and the project owner's approval.

## Submission checklist

The project owner confirmed that a public repository and a video of at most three minutes are mandatory. Before submission: resolve the final acceptance checklist, review rights and secrets before publishing source, disclose inherited code and recorded versus live inference, verify judge access, and rehearse the exact frozen revision shown in the video. No publication or submission is performed by running this app.

`data/demo-extras.json` is optional and intentionally excluded from Git. Without it, outgoing drafts use templates and later demo replies need hand review; the tracked morning recordings still exercise Meta interpretation and clarification. A reviewer name is self-declared provenance, not authentication. This single-coordinator demo must not be exposed publicly as a production service without access isolation and usage controls.
