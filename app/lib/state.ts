import { RECHECK } from "./notice.ts";

// What Review says about a message, chosen from its state alone so a test can check each one.
export const CHANGED = "You changed the details, so check the change below, then approve.";
export type Unread = { call: boolean; closed: boolean; handShown: boolean; startComplete: boolean; live: number };
// The line over a message nobody has read yet: what to do next, by what the page offers.
export function unreadNote(s: Unread): string {
  const head = s.call ? "Check what they said." : "This message has not been read yet.";
  if (s.closed) return head;
  return `${head} ${s.handShown ? "Check the details below, then save and approve." : s.startComplete ? "Save these details, then approve." : s.live > 0 ? "Use Read automatically below, or enter the details yourself." : "Enter the details below."}`;
}
// After "save and approve" did not approve: either the values differ from the ones shown (check them again),
// or something is still open and the item waits.
export const WAITING_REPLY = "Answers applied. One more detail needs an answer.";
export const WAITING_HAND = "Details saved. One more thing needs an answer before it can be approved.";
export function stopNote(form: "reply" | "hand", changed: boolean): { text: string; on?: string } {
  return changed ? { text: CHANGED, on: RECHECK } : { text: form === "reply" ? WAITING_REPLY : WAITING_HAND };
}
