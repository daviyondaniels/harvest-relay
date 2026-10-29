import { pendingCover } from "../src/orders.ts";
import type { Workbench } from "../src/workbench.ts";
import { grower } from "./lib/format.ts";

// Under a shortfall: a grower's update still waiting for review may already cover it, so the
// coordinator reads it before calling anyone. Shown on Overview, Orders and Pack.
export function PendingCover({ w, orderId }: { w: Workbench; orderId: string }) {
  return <>{pendingCover(w, orderId).map(i => (
    <span key={i.id} className="pending-cover small">
      {grower(i.source.growerId)}&apos;s unreviewed update may cover this. <a href={`/review?item=${encodeURIComponent(i.id)}`}>Review it first<span className="sr-only"> ({grower(i.source.growerId)})</span></a>
    </span>
  ))}</>;
}
