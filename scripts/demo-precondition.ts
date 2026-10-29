import { answer, propose } from "../evaluation/scenario.ts";
import { SEED, needsReset } from "../src/seed.ts";
import { openStore } from "../src/store.ts";
import type { Interpretation } from "../src/updates.ts";
import { approve, interpret, preview, type Workbench } from "../src/workbench.ts";

// Dev only, free: puts the demo hub in the order-resolution demo's starting state while the
// seed readings wait for their re-record at the current prompt. The three morning messages
// get hand readings (the same ones tests/story.ts uses) and are approved in demo order:
// cucumber, zucchini, tomato. Leaves Riverbend School Kitchen 60 lb short of tomatoes.
//   HARVEST_DEV=1 node scripts/demo-precondition.ts      (after "Reset demo"; the server may keep running)
// It is not part of the app and cannot be reached from the web server. Opt-in: it runs only
// with HARVEST_DEV=1 and NODE_ENV unset or "development".
const env = process.env.NODE_ENV;
if (process.env.HARVEST_DEV !== "1" || (env !== undefined && env !== "development")) throw new Error("demo-precondition is a development helper; set HARVEST_DEV=1 (with NODE_ENV unset or development) to run it");

const ME = "Hub coordinator", LABEL = "Hand reading (demo precondition script)";
const store = openStore(process.env.HARVEST_DB ?? "data/workbench.db"), stored = store.load();
if (!stored || needsReset(stored.state)) throw new Error("No current demo state; open the app or press Reset demo first");
const seed = (id: string) => SEED.find(m => m.source.id === id)!;
type Reading = Omit<Interpretation, "spans" | "unresolved"> & { quotes: string[] };
const lb = (amount: number) => ({ amount, unit: "lb" as const });
const day = { grade: "standard", deliveryOn: "2026-10-30" };

let w: Workbench = stored.state;
function take(id: string, reading: Reading, clarify: (s: ReturnType<typeof seed>) => ReturnType<typeof answer>[] = () => []): void {
  const m = seed(id), item = w.items.find(i => i.source.id === id);
  if (!item || item.state !== "open" || item.proposal) throw new Error(`${id} is not an unread open message; press Reset demo first`);
  const at = new Date().toISOString();
  w = interpret(w, item.id, propose(w.ledger, `hand-${id}`, m.source, reading, clarify(m)), LABEL, ME, at);
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, at);
}
take("msg-cucumber", { operation: "add-quantity", lotId: "lot-c", quantity: { amount: 4, unit: "case", pack: lb(6) }, ...day, quotes: ["Another four cases", "standard cucumbers", "Friday"] },
  m => [answer("pack", "How much is in each case?", m.reply!, "6 lb in each")]);
take("msg-zucchini", { operation: "replace-total", lotId: "lot-d", quantity: { amount: 4, unit: "case", pack: lb(10) }, ...day, quotes: ["four cases of standard zucchini", "Friday"] },
  m => [answer("pack", "How much is in each case?", m.reply!, "10 lb in each case"), answer("operation", "Is this the new total?", m.reply!, "That's the whole lot")]);
take("msg-tomato", { operation: "replace-total", lotId: "lot-a", quantity: lb(60), ...day, quotes: ["Only 60 lb of standard tomatoes", "Friday", "replacing the earlier 120 lb total"] });
store.save(stored.version, w);
store.close();
console.log("Demo precondition applied: cucumber, zucchini and tomato approved; reload the app.");
