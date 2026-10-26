import { scenario, shortage, surplus } from "../evaluation/scenario.ts";
import { proposeAllocations, verifyPlan } from "../src/planner.ts";
import { commitUpdate, createLedger, reviewUpdate } from "../src/updates.ts";

let ledger = createLedger(scenario());
const before = proposeAllocations(ledger.snapshot); verifyPlan(ledger.snapshot, before);
const short = shortage(ledger);
ledger = commitUpdate(ledger, short, { reviewer: "synthetic-demo-reviewer", reviewHash: reviewUpdate(ledger, short).hash });
const blocked = reviewUpdate(ledger, surplus(ledger));
const clarified = surplus(ledger, true);
ledger = commitUpdate(ledger, clarified, { reviewer: "synthetic-demo-reviewer", reviewHash: reviewUpdate(ledger, clarified).hash });
const after = proposeAllocations(ledger.snapshot); verifyPlan(ledger.snapshot, after);
console.log(JSON.stringify({ label: "Synthetic development replay. No Meta inference, customer validation, confirmed deliveries or waste-prevention claim.", before, clarification: blocked.questions, after, events: ledger.events, forecasts: ledger.forecasts }, null, 2));
