import type { InboxItem } from "../../src/workbench.ts";

// The order the review queue shows inbox items in. `questions` is the number of open
// review questions per item ID (0 means ready to approve, if the item is open).
export function queueOrder(items: InboxItem[], questions: Map<string, number>): InboxItem[] {
  // TODO(project owner): decide what a coordinator should see first. Until then, oldest first.
  return [...items].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}
