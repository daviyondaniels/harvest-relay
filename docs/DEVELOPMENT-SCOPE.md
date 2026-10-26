# Development scope and server handoff

Prepared October 26, 2026. Scoping proposal, not completed features or authorization to migrate/deploy/run paid models. The project owner confirmed a personal development server with an existing Claude subscription. Its OS, capacity, access method, installed Node/Claude versions and effective CLI billing remain unverified.

## Current baseline and records

Source baseline: fe74ec9a2cf7ee60edef62ee9a7fd36ce0f904df. Clean local working tree inspected before this planning document. Read the code, current Notion specification and all 15 Asana tasks. The existing core has eight passing tests, including 200 generated scenarios, and a passing typecheck/CLI replay from the preceding implementation pass. Tests were not rerun for this documentation-only scope.

Current specification: https://app.notion.com/p/40512b3c80b681bd93a9ecf51e9829a0
Delivery tasks: https://app.asana.com/1/1207429581440502/project/1219905773502421

The Notion update was completed after the original source checkpoint; any older local statements that it awaits approval are historical. Asana portfolio placement is explicitly deferred. This expanded development scope has not been pushed to Notion; request the project owner's approval before doing so.

## Recommendation

Use the personal server as the primary build/test checkout once it passes a small preflight. Keep one source-of-truth Git history, with one coding agent changing a branch at a time. Claude CLI can implement scoped milestones; this conversation can handle product decisions, research and interpretation of reported evidence. This chat has no established connection to that server and cannot operate its Claude session without an actual supported connection.

The expected benefit is persistent dependencies, processes, tests and direct CLI access; no claim is made that Claude will code more accurately or cheaply than the current environment. Existing subscription limits and effective authentication still matter. A server move does not establish operator demand, provide Meta credentials, settle event eligibility or replace Meta's required runtime contribution.

Use the checked recovery bundle for a private local transfer; a new GitHub repository is not needed to begin. Public repository publication remains a later separately approved action. Preserve existing timestamps and commit history. Prefer an isolated normal-user checkout, with no production credentials or automatic deployment hooks. Development compute and eventual judge-facing hosting are separate choices.

## Proposed architecture

- Retain the pure TypeScript quantity/planner/verifier modules as the domain layer.
- Add an application service for evidence, update interpretation, clarification, approval, snapshot versions and event history.
- Isolate the eligible Meta client behind a small interface returning untrusted structured proposals. Verify current official model/API docs before implementation; no provider endpoint/model is newly selected by this plan.
- Proposed UI: a small React/Next.js coordinator workbench with server-side model calls. Exact dependencies must be pinned and verified when introduced. No UI framework has been installed in this project yet.
- Proposed persistence: a single-process local SQLite store behind a repository interface, contingent on the server/runtime and deployment target. Use atomic version checks and explicit reset/export. If the final host lacks durable local disk, change the storage adapter before deployment; do not pretend local SQLite is portable to every host.
- Run privately/local-only during development. Authentication, multi-user tenancy and public hosting are separate scope decisions; a local named approval is not authenticated authorization.

## Milestones and acceptance criteria

### 0. Reproduce and qualify the environment — HTO01, HTO03, HTO14

Inspect OS/architecture, available RAM/disk, Node, npm, Git, Claude version and effective account mode without printing secrets. The current project requires Node >=24.12.0 and <25. Check compatible runtime before installing or upgrading anything. Recover the Git bundle into a new path; do not overwrite an existing repository. Run npm ci --ignore-scripts, npm test, npm run typecheck and npm run demo. Record commit and results; inspect existing remotes/hooks before enabling any sync. Confirm build-window treatment with organizers before claiming October 26 work is an eligible contribution.

Acceptance: same source baseline and replay balances; eight tests/typecheck pass on the server; approved account confirmed; no credentials or public exposure added. No migration has occurred yet.

### 1. Reliable update-review workflow — HTO04, HTO05, HTO08

Define an intake record with immutable source ID, revision, grower/lot identity, text and evidence spans. Represent new total, added quantity, correction, forecast and unknown semantics explicitly. An unresolved operation, lot, unit, pack, grade or date blocks inventory mutation. Preserve clarification questions and supplied answers as linked evidence; changing the evidence changes the review hash. A duplicate source revision cannot alter inventory twice. Use atomic snapshot-version checks, not just client-side hashes, before committing approved updates. Support correction history rather than replacing evidence.

Current code handles absolute totals only and has no persistence/idempotency store. Those limitations must remain visible until fixed. Fractional quantities, pounds and variable case weights need explicit conversion/rounding rules driven by sample records; keep unsupported cases unresolved rather than silently approximated.

Acceptance: held-out development cases for total-vs-delta, correction, duplicate revision, stale approval, conflicting identifiers and missing case size. Every committed change has source/review provenance; ambiguous or unsupported inputs leave inventory unchanged. Establish these contracts before wiring model output into state changes.

### 2. Useful Meta interpretation — HTO06, HTO09, HTO11

Interpret pasted text first. Provide only the relevant permitted grower/lot/order context. Return a bounded structured proposal and explicit missing/contradictory fields. Treat message content as data, including any embedded instructions. Validate output shape and references; the model cannot create permissions, set priorities, approve a substitution, mutate inventory or perform external actions. Use server-only secrets, bounded body/context/output, timeout and an explicit request budget. Failed/invalid output stays unresolved; never substitute canned success as a live result. Live inference needs separately authorized credentials/usage.

Acceptance: genuine eligible Meta output identifies a useful ambiguity, a supplied answer resolves it, the coordinator reviews the resulting proposal, and deterministic checks produce the expected change. Test failure/malformed/injection-like inputs without state changes. Record usage and include verification/correction work in cost. A bounded hard request/token budget is not the same as a guaranteed currency cap.

### 3. Coordinator workbench — HTO07

Keep three work areas: (1) searchable supply/order tables, (2) incoming evidence and clarification/review, (3) proposed allocations with differences and unresolved exceptions. Show original/current/proposed quantities and source evidence together. Explain which allocations changed and why; keep product, grade, date, unit and permission constraints visible. Separate unresolved forecast supply from allocatable confirmed supply. Avoid a separate page for every workflow step.

Acceptance: complete the canonical replay through the UI; approval binds the actual reviewed revision; invalid/stale actions show actionable errors and preserve state; exported evidence reflects the same snapshot; verify browser interaction and a production build separately from unit tests. Desktop demonstration first, with basic mobile readability for grower update capture.

### 4. Commitments and outcome recording — HTO08, HTO11

Agree with an operator what may be replanned, what is reserved and who can approve changes. The initial planner replans from scratch. Add locked reservations/minimal-change constraints only with an explicit rule; never silently consume committed supply. Distinguish draft plan, approved reservation, buyer confirmation, completed handoff and disposition. Supplied transport/handling constraints must be represented if feasibility claims depend on them; otherwise label those checks unperformed.

Acceptance: reserved supply is not double-booked; a revised harvest below existing commitments becomes an explicit conflict; no proposal is reported as a completed handoff. Actual loss-prevention claims require independently supported disposition/counterfactual evidence.

### 5. Comparison, demo and submission — HTO02, HTO09–HTO15

In parallel with development, seek one permitted hub workflow and grower feedback; no outreach is sent by this plan. Independently label and freeze representative exceptions before model tuning. Compare manual spreadsheet/checklist, human structured intake + planner, and Meta-assisted intake + identical planner. Report semantic errors, required clarifications, balances, coordinator effort and total task cost. Set success thresholds with the operator before evaluating results. A synthetic fallback can demonstrate engineering but cannot substitute for adoption/loss evidence.

Acceptance: actual Meta contribution; held-out correctness/effort results; repeatable end-to-end flow and failure path; source/data rights; clear contribution disclosure; accessible three-minute video and required public repository after approval. Submission deadline November 4, 2026, 8 p.m. Central. No winning probability or production readiness is asserted.

## Delivery ordering and cut line

Environment reproduction and operator/input validation can proceed independently. Implement review contracts first, then model interpretation and the small UI against those contracts. Do not postpone the first genuine Meta test until the final day. Evaluate before adding integrations. Scope-freeze target is November 2, video/rehearsal November 3, submission November 4; these are planning targets, not completion estimates.

Keep: meaningful clarification, correct allocation/residuals, approval provenance, a complete observable workflow and honest evidence. Defer: marketplace, buyers discovered by AI, payments, route optimization, accounting sync, automatic email/SMS, broad integrations, crop forecasts, autonomous food-safety decisions, carbon claims and elaborate dashboards. Audio/photo inputs are optional only after the text workflow demonstrates value.

## Claude handoff protocol

Give Claude this scope, README, current Notion specification or an authorized export, and the Asana acceptance criteria. Do not assume CLI has this chat's memory or connector permissions. Start with milestone 0, report findings, then implement milestone 1 in a branch. Use normal permission prompts; do not bypass permissions or enable automatic deployment. Do not spawn agents, use premium/max reasoning or make paid API calls without the project owner's explicit approval under the standing cost rules. Do not assume this plan selects a Claude model.

For each milestone: state files changed and behavior, run relevant checks, report actual outcomes/limitations, commit a reviewable diff and identify the next blocker. Keep code and docs in Git. Asana is task status; Notion is product/specification authority; neither replaces source control. No second agent should edit the same branch concurrently. Recovery is the previous clean commit/bundle, preserving newer work on a separate branch before any rollback.

## Server decision conditions and remaining questions

Confirmed by the project owner: personal development server; existing Claude subscription. Still needed: OS, RAM/free disk, access method and installed versions. Anthropic documents 4 GB+ RAM for Claude Code; 8 GB+ is a proposed comfort target for CLI + builds + browser testing, not a measured requirement for this app. No GPU is proposed because the current plan uses hosted Meta inference rather than local model serving.

Claude Remote Control can let the project owner steer a server-local session from Claude web/mobile, with filesystem/execution on the server. The process must stay running, and subscription/authentication requirements apply. It uses outbound HTTPS and does not require opening an inbound Remote Control port. That does not publish the application's own UI or provide this ChatGPT conversation access to the server.

Verify effective billing: an ANTHROPIC_API_KEY environment variable can take precedence over a subscription and incur API charges. Check only whether it is set; never print or paste its value. Existing subscription use does not establish unlimited availability or zero marginal cost.

## Official references checked October 26, 2026

- Claude Code system requirements: https://code.claude.com/docs/en/setup
- Remote Control execution, requirements and networking: https://code.claude.com/docs/en/remote-control
- Subscription authentication/billing precedence: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan

## Pending decisions

Server transfer and account/network changes have not been performed. No Notion or Asana changes were made by this scoping pass. Before pushing the new scope to Notion, ask approval to add milestone acceptance criteria, the proposed server workflow and the server information still unverified. Preserve the already approved canvas and original cybersecurity history.
