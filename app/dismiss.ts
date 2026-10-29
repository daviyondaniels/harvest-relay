import { useEffect, type RefObject } from "react";

// Closes an open disclosure on Escape, returning focus to the button that opened it, on a
// press outside it, or when the keyboard moves focus out of it, so it never covers the
// focused control. Escape inside a modal dialog belongs to the dialog, so it is left alone.
export function useDismiss(open: boolean, close: () => void, area: RefObject<HTMLElement | null>, button: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target instanceof Element && e.target.closest("dialog"))) return;
      close();
      button.current?.focus();
    };
    const press = (e: PointerEvent) => { if (e.target instanceof Node && !area.current?.contains(e.target)) close(); };
    const leave = (e: FocusEvent) => { if (e.relatedTarget instanceof Node && !area.current?.contains(e.relatedTarget)) close(); };
    const el = area.current;
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", press);
    el?.addEventListener("focusout", leave);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", press); el?.removeEventListener("focusout", leave); };
  }, [open, close, area, button]);
}
