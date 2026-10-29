import { normalize } from "./quantity.ts";
import type { Resolution } from "./resolve.ts";
import { shortages } from "./orders.ts";
import type { Workbench } from "./workbench.ts";

// What the tool can observe about the delivery day, and nothing more (docs/EVIDENCE.md E24).
export type Measures = {
  shortsDetected: number;
  resolvedBy: { grower: number; substitute: number; notice: number; shipShort: number };
  minutesToBuyerNotice: { orderId: string; minutes: number }[];
};

export function measures(w: Workbench): Measures {
  const short = new Set([...w.resolutions.map(r => r.orderId), ...shortages(w.ledger).map(s => s.orderId), ...(w.lock?.shippedShort.map(s => s.orderId) ?? [])]);
  // A grower resolved it by a recorded yes (a lot was added), or by a linked reply whose approved
  // event raised the confirmed amount of a lot of the order's product. Forecasts and cuts do not count.
  const lotProduct = new Map(w.ledger.snapshot.lots.map(l => [l.id, l.product]));
  const raised = (r: Resolution) => {
    const event = w.ledger.events.find(e => e.id === w.items.find(i => i.id === r.linkedItemId)?.eventId);
    const product = w.ledger.snapshot.orders.find(o => o.id === r.orderId)?.product;
    return !!event && event.effect !== "forecast" && lotProduct.get(event.lotId) === product && normalize(event.lotAfter).amount > normalize(event.lotBefore).amount;
  };
  const grower = w.resolutions.filter(r => r.option.kind === "ask-grower" && (r.status === "accepted" || raised(r))).length;
  const substitute = w.resolutions.filter(r => r.option.kind === "offer-substitute" && r.status === "accepted").length;
  const notice = w.resolutions.filter(r => r.option.kind === "notify-short" && r.status === "sent").length;

  const minutes: Measures["minutesToBuyerNotice"] = [];
  for (const orderId of [...new Set(w.resolutions.map(r => r.orderId))].sort()) {
    const mine = w.resolutions.filter(r => r.orderId === orderId);
    // The earliest resolution that names a cause supplies it for the whole order.
    const cause = mine.find(r => r.causeItemId)?.causeItemId, item = w.items.find(i => i.id === cause);
    const ids = new Set(mine.map(r => r.id));
    const sent = w.outbox.filter(m => ids.has(m.resolutionId) && m.to.kind === "buyer").map(m => Date.parse(m.sentAt)).sort((a, b) => a - b)[0];
    if (item && sent !== undefined) minutes.push({ orderId, minutes: (sent - Date.parse(item.receivedAt)) / 60000 });
  }
  return { shortsDetected: short.size, resolvedBy: { grower, substitute, notice, shipShort: w.lock?.shippedShort.length ?? 0 }, minutesToBuyerNotice: minutes };
}
