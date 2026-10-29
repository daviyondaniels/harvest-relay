"use client";
import { useEffect } from "react";
import { askName } from "./name-event.ts";

// Rendered by a page whose form was refused because no name is saved: it points the
// coordinator at the header's name field, with the server's message beside it.
export function NameNeeded({ text }: { text: string }) {
  useEffect(() => { askName(text); }, [text]);
  return null;
}
