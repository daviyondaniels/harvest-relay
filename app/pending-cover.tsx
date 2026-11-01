import { pendingCover } from "../src/orders.ts";
import type { Workbench } from "../src/workbench.ts";
import { grower } from "./lib/format.ts";
import { reviewCoverLink, waitingCover } from "./lib/view.ts";

// Under a shortfall: a grower's updates still waiting for review may already cover it, so the
// coordinator reads them before calling anyone. One line per grower, naming how many; only
// updates that could raise supply count (src/orders.ts). Shown on Overview, Orders and Pack.
export function PendingCover({ w, orderId }: { w: Workbench; orderId: string }) {
  return <>{pendingCover(w, orderId).map(g => (
    <span key={g.growerId} className="pending-cover small">
      {waitingCover(grower(g.growerId), g.items.length)} <a href={`/review?item=${encodeURIComponent(g.items[0].id)}`}>{reviewCoverLink(grower(g.growerId), g.items.length)}</a>
    </span>
  ))}</>;
}
