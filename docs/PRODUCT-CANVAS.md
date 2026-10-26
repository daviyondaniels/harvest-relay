# Harvest-to-order product canvas

October 26, 2026. Approved lead direction; customer fit, efficacy and price remain hypotheses. Hackathon first, not a commitment to a full commercial platform.

## Problem and evidence

Proposed problem: changing harvest totals, inconsistent pack descriptions and buyer restrictions require repeated reconciliation. Supply may remain unallocated while other orders go short. We must verify the frequency and consequence of this problem in an actual operator's workflow.

USDA ERS identifies economic, labor, cold-storage, preference and contract factors behind produce left unharvested or unsold. It emphasizes the cost of loss reduction and alignment with farm profitability. This supports investigating coordination alongside other constraints, not attributing all waste to coordination or claiming an addressable waste percentage. [1]

UC ANR describes aggregation hubs combining small-producer supply and coordinating sourcing, logistics and sales to serve larger markets. This supports the multi-grower customer setting, not demand for this particular application. [2]

Local Line already offers farm/food-hub inventory, wholesale orders, fulfillment and defined product swaps. This is a credible baseline. We have not tested its exception workflow or established a feature gap, lower price or performance advantage. [3]

## Customer and job

**Primary operator:** the person reconciling orders at a small food hub or grower cooperative. **Supply participants:** individual growers, who should be able to provide an update without migrating their entire business. **Demand participants:** existing buyers with confirmed orders and explicit requirements. A direct-farm mode can use the same model with one grower; it is not a separate initial product.

Job: when harvest availability changes, prepare a correct revised fulfillment proposal, identify necessary clarifications and approvals, and expose what remains unresolved before the delivery cutoff.

Initial customer qualification: already coordinates multiple growers, has recurring orders and receives meaningful late changes; can supply redacted records and review exceptions; has actual demand and a workable delivery process. These criteria are proposed, not observed segment facts.

## Business model canvas

| Element | Working model | Evidence or validation needed |
|---|---|---|
| Customer segments | Small hubs/cooperatives first; direct-selling growers through one-grower configuration | One operator workflow, then independent grower and hub feedback |
| Value proposition | Convert messy supply changes into traceable, feasible proposed allocations with less coordinator effort | Correctness and task-effort comparison with current workflow |
| Channels | Initially direct pilot participation; later existing farm/hub software exports and operator networks | No channel or partnership secured; no outreach sent |
| Customer relationships | Assisted onboarding of unit and substitution rules; coordinator retains decisions | Measure setup and ongoing correction burden |
| Revenue | Hosted subscription or usage aligned with reconciled workload; no price selected | Buyer willingness to pay, budget ownership and support cost unknown |
| Key activities | Interpret updates, clarify ambiguity, normalize explicit packs, reconcile constraints, review exceptions, record outcomes | Real Meta/held-out evaluation and practitioner feedback |
| Key resources | Permitted sample records, domain rules, labeled exceptions, eligible Meta access, deterministic planner | Only synthetic records and local deterministic code currently available |
| Key partners | Pilot hub/grower; existing software provider only if an integration is useful | None confirmed; do not require marketplace adoption for first value |
| Cost structure | Inference, transcription if used, hosting/storage, imports, onboarding, rule maintenance, corrections, human review/support | Full cost per correct reconciled order, including setup amortization |

No financial commitment, price, market-size estimate or business viability claim follows from this canvas.

## Solution and Meta value

Proposed loop: source update → structured interpretation with evidence → unresolved questions → coordinator confirmation → deterministic reallocation → reviewable differences and remaining exceptions → authorized handoff → separately recorded disposition.

Meta should handle language/visual ambiguity and context: identify which lot the message concerns, whether a number is a new total or an additional quantity, which unit/grade/date is meant, and what question would resolve ambiguity. It must not invent case sizes, buyer permission, available transport or food suitability. Extraction and clarifying questions are not implemented yet.

The deterministic layer enforces supplied rules, units and balances. It should remain identical in model and baseline evaluations, so any demonstrated improvement can be attributed to intake/evidence reasoning rather than adding a better planner only to the AI arm.

The hackathon contribution must be a working multi-step reconciliation and review process. A chatbot explaining a spreadsheet or an image description is insufficient. Actual eligible Meta behavior and useful clarification must appear in the demonstration; the current hand-authored CLI replay does not meet that bar.

## SWOT

| Strengths | Weaknesses |
|---|---|
| Concrete operational trigger; observable allocation errors; existing orders avoid inventing a buyer network; potential benefit to both growers and hubs | No secured operator/data; narrow existing-data assumptions; model interpretation untested; onboarding/permission burden; no direct sector experience established |

| Opportunities | Threats |
|---|---|
| A focused exception workflow alongside existing tools; connect surplus to already permitted demand; useful audit trail; direct-farm mode later | Existing software may already solve the job; missing transport/storage or weak economics may dominate; stale updates can mislead; false confidence can damage fulfillment; broad scope can dilute Meta proof |

## Hackathon scope

One coordinator, two growers, three buyer orders, one delivery date, bounded crops and explicit permissions. Text update first; voice transcription/photo evidence only if it improves the measured job and model support is verified. Prototype data can be synthetic only if prominently labeled; usefulness claims still require operator validation.

Demo: baseline orders → tomato shortfall → zucchini surplus described as cases → missing pack-size question → supplied answer → reviewed update → approved substitution proposed → remaining shortage and surplus visible. No new buyer invented, automatic customer messaging, marketplace, route optimization, payment, yield prediction, crop treatment, autonomous food-safety judgment or emission estimates.

The current planner replans proposals from scratch. It does not preserve binding reservations or existing allocations. Real operators may need locks and minimal-change planning; that is a validation question and must be solved before operational use.

## Measures and decision gates

Measure semantic intake errors; necessary vs unnecessary clarification; unauthorized substitution/over-allocation; correct residual accounting; coordinator time/steps; full cost per correct order. Track proposed allocations separately from accepted reservations and completed handoffs.

Loss evidence ladder: available but unallocated → proposed placement → buyer/transport confirmation → completed handoff → documented original likely disposition and actual use/disposition. Only the final evidence can support a carefully bounded avoided-loss claim. Do not equate kilograms allocated with kilograms of waste prevented or total edible food consumed.

Gate A: obtain a permitted, representative workflow and labeled exceptions; find a coordination problem the operator considers consequential. Gate B: run eligible Meta on held-out cases with no silent quantity/permission assumptions. Gate C: beat or usefully complement a strong spreadsheet/checklist baseline after accounting for corrections and setup. Gate D: credible three-minute end-to-end proof and legal rights/contribution disclosure. Thresholds and sample size should be fixed before viewing evaluation results; none has passed yet.

Stop or narrow if transport/cold storage is the principal constraint, the incumbent already resolves these exceptions easily, input cleanup outweighs the task saved, or Meta adds no useful interpretation. Preserve the deterministic core and existing cybersecurity checkpoint rather than forcing a weak story.

## References

1. USDA ERS, Food Loss: Why Food Stays On the Farm or Off the Market, March 2020: https://ers.usda.gov/amber-waves/2020/march/food-loss-why-food-stays-on-the-farm-or-off-the-market
2. UC ANR, Small Farm Food Aggregation Hubs: https://ucanr.edu/site/f3-local-farm-food-innovation/small-farm-food-aggregation-hubs
3. Local Line supplier features, checked October 26, 2026: https://www.localline.co/suppliers
4. Official Meta event page: https://dev.meta.ai/events/global-hackathon ; supplied participant guide preserved separately as Hackathon Rules.md. Oct26/27 window conflict unresolved.

Sources establish broader need or offered capabilities; no interviews, competitor trials, prices, savings, causal waste reductions or model evaluations were performed for this canvas.
