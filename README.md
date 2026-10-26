# Harvest to order — Meta hackathon prototype

Lead direction selected by Dee on October 26, 2026. Working description, not a settled brand.

Help small food-hub coordinators reconcile changing grower availability against existing buyer orders. Growers provide updates; buyers define acceptable products/grades/substitutions; the coordinator reviews changes. Reducing avoidable food loss is an intended outcome, not a demonstrated result.

## Run

Requires Node 24.12–24.x. Zero runtime packages, pinned TypeScript development dependencies.

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run demo
```

`npm run demo` runs authored synthetic inputs with hand-authored update proposals. It performs no model inference or network requests. There is no UI, deployment, customer connector, authenticated multi-user service or completed-delivery integration yet.

## What works

- Confirmed supply and existing demand, supplied delivery date, product/grade requirements and explicit substitution permissions.
- Integer grams/counts, explicit case contents, missing-pack clarification and no guessed count-to-weight conversion.
- Update review over an in-memory ledger (`src/updates.ts`): immutable source ID/revision records with character-span evidence; explicit new-total, added-quantity, correction, forecast and unresolved operations; linked clarification questions/answers inside the reviewed hash; exact-proposal approval; ledger-version and snapshot-hash staleness checks; duplicate/conflicting/superseded source-revision rejection; append-only event history with before/after quantities and hashes.
- Any unresolved operation, lot, grower, quantity, unit, pack, grade, date, correction target or open clarification blocks inventory change. Forecasts are recorded beside the snapshot and never reach the planner.
- Meta interpretation boundary (`src/interpret.ts`), disabled by default: builds a Meta Model API Chat Completions request with a strict JSON schema and only the sender's own lots; validates the response locally; maps it to an unapproved proposal for the same review/approval flow. Unknown references, contradictions, malformed/truncated/refused output and timeouts never produce a proposal; values without a verbatim quote are dropped so review asks for them. One call per invocation, no retries, explicit call budget and size/token/time bounds. No credentials are configured and no live call has been made.
- Deterministic allocation proposals and full unfilled/unallocated balances, independently verified for eligibility and conservation.
- Twenty-nine tests, including 200 generated planning scenarios and a 150-step generated update sequence. These are not held-out customer cases or evidence of model performance.

The heuristic considers all direct demand before approved substitutes, then supplied priority and stable IDs. It does not guarantee globally optimal allocation. Grades and permissions are supplied customer rules, not AI food-safety assessments. Both lot and order use the same confirmed delivery date; multi-leg logistics, storage, transport capacity and refrigeration are outside this slice.

## Read next

- `docs/PRODUCT-CANVAS.md`: evidence, canvas, SWOT, scope and validation gates.
- `docs/STATUS.md`: verified behavior, limitations and recovery.
- `docs/VALIDATION.md`: operator questions and evaluation protocol.
- `docs/NOTION-UPDATE-PROPOSAL.md`: proposed documentation changes awaiting approval.
- `docs/TRACKING.md`: Asana IDs and portfolio-placement status.

## Provenance and limits

New isolated local source, actual October 26 timestamps preserved. The official website says kickoff begins October 26; the supplied guide labels October 27–November 4 the building period. Eligibility is unresolved; do not treat this code's date as approved event contribution. See HTO01 in Asana.

No paid inference, billing setup, outreach, external publication, deployment or submission occurred. No eligible Meta model has yet contributed to this prototype; it is not submission-ready. Intended Meta role is interpretation and evidence-gathering, subject to a real comparison with competent manual/structured intake using the same planner.

All included scenario records are authored synthetic examples. Do not add real customer records, contact details, credentials or licensed third-party datasets/manuals to a public repository. A public-source license has not been selected; publication requires a rights/license review and Dee's approval.
