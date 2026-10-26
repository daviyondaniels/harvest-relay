# Validation protocol

## Operator questions — draft, not sent

1. Walk through the last harvest change that affected an existing order. What changed, when, and what did you do next?
2. Which records/messages were necessary? Can you share a redacted copy with permission to use it in a private model test?
3. Is a grower reporting a forecast, a confirmed total, a correction or an addition? How do you distinguish these now?
4. Who defines case size and grade? Can packs differ by grower/lot/date? Which substitutions require fresh buyer permission?
5. Which allocations/reservations are already binding, and which may be changed? How should shortages be distributed?
6. What prevented placement of the last surplus: missing information, no buyer, price, harvest labor, storage or transport?
7. Where did that produce actually go? What evidence distinguishes unsold, donated, processed, consumed and discarded?
8. What would make this workflow worth using alongside your existing software? Which current feature already handles it?
9. How much correction/verification work would make an assistant slower than your existing process?

Do not lead with the claim that their workflow is broken. No contact is authorized to be messaged by this document.

## Requested sample contract

Redacted lot/grower IDs; explicit crop/grade; quantity and pack definition/source; date; forecast vs confirmed status; order ID/buyer pseudonym; units/accepted grades; existing approved substitutions and restrictions; priority/shortage allocation policy; existing reservations; source messages and correction sequence; actual decision/outcome label. Remove names, contact details, prices if unnecessary, location precision and credentials. Record consent, model-processing permission, retention and public-demo permission separately.

## Evaluation design

Use the same lots, orders, constraints and planner in all arms: (A) competent manual spreadsheet/checklist, (B) structured human intake plus deterministic planner, (C) Meta-assisted intake/review plus identical planner. Measure preparation, clarification, corrections and review as part of task time, not only inference latency. Separate initial mapping/setup cost from repeated task cost.

Independently label an exception set, freeze a development/held-out split and record hashes before tuning. Include short harvest, surplus, ambiguous cases, counts vs weights, corrected totals vs deltas, stale updates, duplicate source events, unknown lot, contradictory date/grade, missing permission, forecast supply and insufficient demand. Evaluate each source interpretation and final balances. Use representative messy inputs rather than only adversarial or pristine examples.

Proposed correctness gates: no over-allocation or unauthorized substitution in the evaluated bounded set; ambiguous required fields remain unresolved until confirmed; complete residual accounting. A finite passing set is not a general safety/reliability guarantee. Choose a task-effort improvement threshold with the operator before viewing results; do not invent a business-benefit threshold from a convenient demo.

Current tests are development tests on authored inputs and 200 repeatable generated variants. No held-out Meta evaluation or customer baseline exists. Unit support currently uses integer g/kg/each and explicit case contents; lb, fractional units and realistic variable-weight handling remain unimplemented and must be validated against the target workflow.
