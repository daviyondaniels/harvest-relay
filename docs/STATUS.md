# Initial harvest-to-order checkpoint — October 26, 2026

Isolated local source; no external remote. Core quantity normalization, allocation heuristic, independent eligibility/conservation verifier, source-linked absolute-total quantity proposals and stale/hash review implemented. Fresh local project, not a rewrite of the cybersecurity source.

Verified: npm test (8 tests, including 200 generated development cases), npm run typecheck, and npm run demo. No UI/build/server exists to test. Synthetic replay asks for case contents; after supplied clarification it proposes 10 kg zucchini against a permitted cucumber substitution, leaves a 30 kg tomato shortage and 10 kg unallocated zucchini. This is not completed fulfillment or waste prevented.

Unimplemented: model extraction/clarification, real operator records, CSV import, audio/photo processing, interactive review, authenticated access, persistent storage, locks/reservations, handoff outcomes, route/cold-chain capacity, budgets/prices and variable-weight accounting. Greedy allocation is transparent but not globally optimal. Current residual reason is general rather than a per-constraint diagnosis. Source literal matching does not establish semantic truth. Local reviewer names/hashes are provenance, not authentication or signatures.

Roadmap tracked in Asana. Hackathon portfolio placement requires browser fallback approval; Notion update proposal is prepared but not applied. Public repo/deployment/outreach/paid inference/submission not performed. Actual October 26 timestamps retained; event build-window eligibility remains unresolved.

## Milestone 1 — update review (October 26, 2026, Claude Code on the development server)

Implemented in `src/updates.ts` against the unchanged planner/verifier: intake `Source` records (ID, revision, grower, text) with span evidence; `replace-total`, `add-quantity`, `correction`, `forecast` and `unresolved` operations; blocking questions for any unresolved/conflicting lot, grower, quantity, unit, pack, grade, date or correction target and for unanswered clarifications; clarification answers stored as linked source spans and covered by the review hash; approval bound to the exact review hash; commit rechecks ledger version and snapshot hash; one commit per source revision per lot, rejecting duplicates, changed text under an existing revision and older revisions; corrections target only the latest inventory update for that lot and re-apply its operation from the original starting quantity; forecasts recorded in `ledger.forecasts`, outside the allocatable snapshot. The original absolute-total `applyUpdate` API was replaced.

Verified: npm test (16 tests), npm run typecheck, npm run demo (same balances as above). Deliberate breakage of chained-correction, duplicate, forecast-separation and version checks each failed the suite.

Still open: the ledger is in-memory only, so atomicity is a compare-and-swap contract that a persistent store must enforce; blocked reviews and unanswered questions are not persisted, only committed proposals; forecasts cannot be corrected or retired and lots are not confirmed by updates; fractional quantities, pounds and variable case weights remain unresolved rather than converted; held-out development cases for milestone 1 acceptance have not been independently authored; no model interpretation, UI or Notion/Asana update.

Recovery: npm ci --ignore-scripts; npm test; npm run typecheck; npm run demo. Checkpoint excludes dependency caches, environment files and credentials; source and local history are included. Preserve the independent cybersecurity fallback checkpoint.
