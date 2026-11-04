# Harvest Relay implementation plan

Improve the existing coordinator review loop before expanding into a general food-hub platform. The target is an independently usable, reproducible hackathon demonstration and a credible operator pilot. A 9/10 user or impact rating requires evidence from people doing the work; feature completion alone is not that evidence.

## Priorities and acceptance gates

| Priority | Improvement | Why it matters | Acceptance |
|---|---|---|---|
| 1 | Isolated visitor demos | Judges must not overwrite another visitor's decisions or spend the server's live-model allowance | Random HttpOnly workspace cookie; bounded expiring SQLite sessions; per-session read/write/reset/export; public-demo live calls disabled; tests for isolation, stale writes, expiry and capacity |
| 2 | Reviewable order quantity changes | Real coordinators need to reconcile buyer demand as well as grower supply | Existing order quantity editable with reason, exact before/after impact and named confirmation; source snapshot hash binds preview; reject reductions below promises, edits after packing and open-resolution conflicts; no silent reallocation of commitments; history in export |
| 3 | A usable demonstration guide | The valuable reasoning and safeguards must be discoverable in three minutes | In-app steps link to existing tasks and show actual progress; original evidence and recorded/live provenance remain clear; canonical clarification, buyer consent, commitment cut and reconfirmation explained without automating approval |
| 4 | Reproducible source and delivery | A public clone must build without hidden recordings or build-time Google Fonts access | Licensed local font with attribution; frozen dependency lock; CI runs tests, typecheck and production build; clean installation remains documented |
| 5 | Operator validation and comparison | Impact, usefulness and differentiation cannot be inferred from a synthetic replay | Recruit with owner authorization; at least three independent coordinators attempt the same tasks; record completion, safety mistakes, help needed and full task time; compare competent manual intake, structured intake and Meta-assisted intake with the same planner |
| 6 | Submission and deployment | Public source and a video of at most three minutes are mandatory | Rights/secrets/license review; public repository; externally verified demo access; final video rehearsed against one frozen commit; contribution disclosure; owner-authorized submission |

## Implementation sequence for this batch

1. Add a pure expiring workspace store and request-bound session adapter. Keep the existing private shared mode as the default; enable isolated mode explicitly with `HARVEST_PUBLIC_DEMO=1`. A missing or expired visitor session goes to a start page, never a shared fallback. Reset applies only to that session. Enforce record size, active session count and absolute lifetime. This is synthetic-demo isolation, not organizational authentication.
2. Add a pure order-change preview/commit API, then a dedicated order-adjustment form using existing components. Keep product, buyer, grade, unit and delivery date fixed in this batch. Bind confirmation to the exact current snapshot and requested quantity/reason. Increase the ledger and snapshot versions, retain an audit record and stale outstanding reviews/drafts. Never reduce demand below a recorded promise or change a packed/handed-off order.
3. Add a guide using the current visual system and existing actions. Compute progress from actual state; no fabricated success, food-saved totals, customer savings or newly generated model recordings. Link the guide from the menu and overview.
4. Vendor the existing Plus Jakarta Sans family from its official Google Fonts source with the SIL license. Switch `next/font/google` to `next/font/local`, then add CI with read-only repository permissions and pinned actions.
5. Run focused domain tests, all regressions, typecheck and an offline-capable production build. In an isolated local preview verify start/resume/reset, order preview/confirmation/refusal, guide links, and desktop/mobile rendering. Preserve the original private server's state.

## Evaluation and decisions still needed

Proposed usability acceptance: each participant completes a shortage review, ambiguous-case clarification, buyer substitution and late-cut reconfirmation without an unsafe commit or moderator instruction. Record failures as failures. Fix observed friction, then repeat with new participants rather than reclassifying the same rehearsal as independent validation.

For task-time comparisons, include preparation, clarification, corrections and review; use identical inputs and allocation rules. Freeze cases and labels independently before prompt changes. Set the minimum useful improvement with an operator before seeing results. Existing development fixtures and previously inspected model evaluations cannot be relabeled as fresh held-out evidence.

Live inference, outreach, public hosting, repository visibility changes and submission remain separate release actions. Implementation here adds the necessary controls and materials; it does not claim those gates have passed.

## Grounding

- Current audit, source and recorded Muse Spark provenance: `docs/STATUS.md`, `docs/EVIDENCE.md`, `docs/VALIDATION.md`.
- [Farmhand's food-hub offering](https://www.farmhand.partners/food-hubs): broad catalog/order/packing functionality is already offered; Harvest Relay's differentiation is a hypothesis about operator-side review, not a claim of unique features across the market.
- [Next.js cookie API](https://nextjs.org/docs/app/api-reference/functions/cookies): cookies are read in server components and set in server actions or route handlers.
- [Official judging rules](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver): impact 30%, Meta tooling 25%, technical execution 20%, demo 25%.


## Current implementation assessment

The four code priorities are implemented in this batch, with 15 additional regression tests in this batch (497 total, up from 482 after the first audit fixes). Independent visitor browser checks used two host cookie jars against one application/database: the first retained an approved reduction and two order changes while the second remained at its seed and could reset without affecting the first. These are synthetic local checks, not customer or deployment validation.

Provisional subjective ratings after local verification: hackathon prototype 7.8/10, target-user fit 7/10, prototype platform quality 8.5/10. For the hackathon estimate, impact 7, Meta tooling 8, technical execution 8.5 and demo experience 8 give 7.775 using the published 30/25/20/25 weights. Submission readiness remains incomplete while source visibility, public access and the actual video are unresolved; a score does not waive a mandatory requirement. Production quality is not rated 8.5: customer authentication/isolation and operational recovery are not implemented.

The shortest route to approximately 9 is now evidence and delivery: independent coordinator sessions with fixes/retests, an independently frozen Meta comparison using the same planner, passing clean-clone/CI checks, signed-out judge access and an accurately labeled three-minute demonstration. Add broader features only when those sessions identify a blocking need. General order/catalog CRUD and real message delivery are pilot work, not a prerequisite to demonstrate this review loop honestly.
