import { scenario, shortage, surplus } from "../evaluation/scenario.ts";
import { proposeAllocations, verifyPlan } from "../src/planner.ts";
import { applyUpdate, reviewUpdate } from "../src/updates.ts";

let state = scenario();
const before = proposeAllocations(state); verifyPlan(state, before);
const events = [];
const short = shortage(state);
let applied = applyUpdate(state, short, { reviewer: "synthetic-demo-reviewer", proposalHash: reviewUpdate(state, short).hash });
state = applied.snapshot; events.push(applied.event);
const blocked = reviewUpdate(state, surplus(state));
const clarified = surplus(state, true);
applied = applyUpdate(state, clarified, { reviewer: "synthetic-demo-reviewer", proposalHash: reviewUpdate(state, clarified).hash });
state = applied.snapshot; events.push(applied.event);
const after = proposeAllocations(state); verifyPlan(state, after);
console.log(JSON.stringify({ label: "Synthetic development replay. No Meta inference, customer validation, confirmed deliveries or waste-prevention claim.", before, clarification: blocked.questions, after, events }, null, 2));
