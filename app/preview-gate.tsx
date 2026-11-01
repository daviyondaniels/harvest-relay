"use client";
import { useEffect, useState, type ReactNode } from "react";

// The outcome shown beside a form that was filled in for the coordinator ("If saved as shown:") is
// worked out on the server from those values. Once the coordinator changes a value the outcome no
// longer describes the form, so it gives way to a plain line: what they type is checked when they
// press the button, before anything is approved. The name, the reply text and the quote do not
// change what the outcome is worked out from, so editing them leaves it standing.
const KEEPS = new Set(["who", "reply", "quote", "andApprove", "recorded"]);
export function PreviewGate({ form, note, children }: { form: string; note: string; children: ReactNode }) {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const el = document.getElementById(form);
    if (!el) return;
    const on = (e: Event) => { const t = e.target as HTMLInputElement | null; if (t?.name && !KEEPS.has(t.name)) setChanged(true); };
    el.addEventListener("input", on); el.addEventListener("change", on);
    return () => { el.removeEventListener("input", on); el.removeEventListener("change", on); };
  }, [form]);
  return changed ? <p className="small" role="status">{note}</p> : <>{children}</>;
}
