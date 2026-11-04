# Operator validation protocol

Status: prepared; no participants, interviews or performance results claimed.

## Decisions this study should inform

Can a small food-hub coordinator safely complete a harvest-change workflow without being coached? Does Meta-assisted free-text intake reduce total work relative to competent manual intake or structured grower intake, using the same allocation rules? Which workflow change would make it useful enough to pilot?

## Setup

Owner recruits at least three independent people who coordinate sourcing/orders. Obtain their agreement to the session and recording separately; collect no real buyer names or private messages. Use equivalent synthetic scenarios for each method. Counterbalance method order across participants. An existing team rehearsal is not an independent participant.

Freeze the scenario inputs, answer keys, prompt/version, application commit, timing definition and success threshold before seeing results. Cases used during prompt development are development cases. Have an independent operator author a fresh set before evaluating new-case model performance. Preserve failures and invalid responses in the denominator.

## Session (30–40 minutes)

1. Ask about the last availability change they handled: channels, people involved, how shortages were assigned, how they knew which sheets were current. Do not introduce a time-savings figure.
2. Give the task, not button instructions: "The grower reduced tomatoes. Determine which buyers are affected and record the change you would stand behind."
3. Give ambiguous case counts and the grower's follow-up. Observe whether the participant asks for the needed contents/operation and checks the evidence before approving.
4. Give a shortage with an available substitute. Observe whether buyer consent is recorded before substitution becomes supply for that order.
5. Confirm a plan, introduce a late reduction, then ask them to prepare packing. Observe cut decisions and reconfirmation before packing affected orders.
6. Ask for a buyer quantity change. Observe impact review and whether the participant notices any newly stale sheet.
7. Ask what they would need before using this for a real delivery day; request a concrete pilot decision and blockers.

Moderator stays silent during tasks except to stop an unsafe real-world action. Help is allowed after a participant gets stuck, but record it as assisted completion. Screen readers and mobile users should be included in a follow-up accessibility round, not assumed covered by three desktop sessions.

## Comparison

Run the same logical cases using a competent manual entry workflow, a structured availability form and Meta-assisted free text. Keep the planner, supply, orders and decision rules identical. Include reading, data preparation, asking questions, correction, review and recovery in total time. Measure model latency separately. Do not compare an unfamiliar spreadsheet to a rehearsed app.

Record: participant code; actual role; method/order; task; start/end; completion without help; help events; unsafe approval attempted/accepted; missed shortfall; misunderstood provenance; wrong packing state; correction count; confidence and explanation in their own words. Model metrics separately include valid response, evidence validity, needed questions, unsupported facts reaching approval, over-questioning and API cost.

## Acceptance and next action

Proposed usability gate: all three independently complete the core loop without an unsafe accepted action or moderator instruction. Any failure is a finding to fix; retest with new participants. Agree a minimum useful time improvement and acceptable clarification burden with an operator before timing comparisons. Three sessions diagnose usability; they do not establish population-level accuracy or impact.

Pilot only after accounts/roles, organization isolation, backups/restore, monitoring, delivery integration and customer-data handling are designed and tested. A public synthetic demo is not a pilot with customer records. No claim of food rescued, revenue saved or measured time saved is justified until those outcomes are measured with an explicit baseline.
