import assert from "node:assert/strict";
import { answer, propose } from "../evaluation/scenario.ts";
import { BUYERS, CONTACTS, demoSnapshot } from "../src/demo.ts";
import { templateDraft } from "../src/draft.ts";
import { options, shortages, type Option } from "../src/orders.ts";
import { SEED } from "../src/seed.ts";
import { createLedger, type Source } from "../src/updates.ts";
import { approve, createWorkbench, interpret, preview, receive, type Workbench } from "../src/workbench.ts";
import { factsFor, startResolution } from "../src/resolve.ts";

// Order resolution on the demo hub: after the morning's three updates, order-b is 60 lb short.
export const T = (m: number) => new Date(Date.UTC(2026, 9, 28, 14, m)).toISOString();
export const ME = "Hub coordinator";
export const names: Record<string, string> = { ...Object.fromEntries(CONTACTS.map(c => [c.id, c.name])), ...BUYERS };
export const seed = (id: string) => SEED.find(m => m.source.id === id)!;
export const known = (w: Workbench) => [...new Set([...w.ledger.snapshot.lots, ...w.ledger.snapshot.orders].map(x => x.product))];
export const short = (w: Workbench, orderId = "order-b") => shortages(w.ledger).find(s => s.orderId === orderId)?.short ?? 0;

export function take(w: Workbench, source: Source, reading: (w: Workbench) => ReturnType<typeof propose>, m: number): Workbench {
  w = receive(w, source, T(m));
  const id = w.items.at(-1)!.id;
  w = interpret(w, id, reading(w), "test reading", ME, T(m));
  return approve(w, id, ME, preview(w, id).reviewHash!, T(m));
}
export function morning(): Workbench {
  let w = createWorkbench(createLedger(demoSnapshot()));
  const cuke = seed("msg-cucumber"), zuke = seed("msg-zucchini"), tom = seed("msg-tomato");
  w = take(w, cuke.source, w => propose(w.ledger, "p-cuke", cuke.source,
    { operation: "add-quantity", lotId: "lot-c", quantity: { amount: 4, unit: "case", pack: { amount: 6, unit: "lb" } }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another four cases", "standard cucumbers", "Friday"] },
    [answer("pack", "How much is in each case?", cuke.reply!, "6 lb in each")]), 1);
  w = take(w, zuke.source, w => propose(w.ledger, "p-zuke", zuke.source,
    { operation: "replace-total", lotId: "lot-d", quantity: { amount: 4, unit: "case", pack: { amount: 10, unit: "lb" } }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["four cases of standard zucchini", "Friday"] },
    [answer("pack", "How much is in each case?", zuke.reply!, "10 lb in each case"), answer("operation", "Is this the new total?", zuke.reply!, "That's the whole lot")]), 2);
  w = take(w, tom.source, w => propose(w.ledger, "p-tom", tom.source,
    { operation: "replace-total", lotId: "lot-a", quantity: { amount: 60, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 60 lb of standard tomatoes", "Friday", "replacing the earlier 120 lb total"] }), 3);
  return w;
}
export function pick(w: Workbench, f: (o: Option) => boolean, orderId = "order-b"): Option {
  const o = options(w.ledger, orderId, CONTACTS).find(f);
  assert.ok(o, "option offered");
  return o;
}
export function start(w: Workbench, o: Option, m: number, orderId = "order-b"): Workbench {
  const facts = factsFor(w, orderId, o, names);
  return startResolution(w, orderId, o, CONTACTS, facts, templateDraft(facts, known(w)), ME, T(m));
}
export const askB = (o: Option) => o.kind === "ask-grower" && o.contactId === "grower-b";
export const zucchini = (o: Option) => o.kind === "offer-substitute" && o.product === "zucchini";
export const notice = (o: Option) => o.kind === "notify-short";
export const MORE: Source = { id: "msg-tomato-more", revision: 1, growerId: "grower-b", text: "We can bring another 30 lb of standard tomatoes Friday." };
export const more = (w: Workbench) => propose(w.ledger, "p-more", MORE, { operation: "add-quantity", lotId: "lot-b", quantity: { amount: 30, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["another 30 lb of standard tomatoes", "Friday"] });

