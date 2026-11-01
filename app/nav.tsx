"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { resetAction } from "./actions.ts";
import { useDismiss } from "./dismiss.ts";
import { askName } from "./name-event.ts";
import { ThemeToggle, type Theme } from "./theme.tsx";

// The header, phone first. On a phone or portrait tablet (up to 1023 px): the logo, the page
// name with who is recording, and a Menu holding the pages (Log a call is one of them), the
// theme and, last and set apart, Reset demo. From 1024 px: the logo, the page tabs, who is
// recording and a More menu for the theme and Reset demo. Every tab, Log a call included,
// marks its own page with aria-current. Reset demo asks before it acts. The menu closes on
// Escape, on a press outside it and when focus leaves it (dismiss.ts). The menu shows the full name, which the header may cut short,
// with a "Change name" that opens the header's name field.
const PAGES = [["/", "Overview"], ["/review", "Review updates"], ["/orders", "Orders"], ["/pack", "Pack"], ["/call", "Log a call"]] as const;
function pageName(path: string): string {
  if (path.startsWith("/events")) return "Recorded change";
  return PAGES.find(([href]) => href === "/" ? path === "/" : path.startsWith(href))?.[1] ?? "Harvest Relay";
}

export function Header({ theme, who, name }: { theme: Theme; who: ReactNode; name?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null), reset = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, area, button);
  const links = PAGES.map(([href, label]) => (
    <a key={href} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined}>{label}</a>
  ));
  return <>
    <a className="brand" href="/"><img src="/mark.png" alt="" width={34} height={34} /><span className="brand-text">Harvest Relay</span></a>
    <span className="page-name" aria-hidden="true">{pageName(path)}</span>
    <nav className="nav" aria-label="Main">{links}</nav>
    <div className="who-area">{who}</div>
    <div className="menu-wrap" ref={area}>
      <button type="button" className="menu-button" ref={button} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(o => !o)}>
        <span className="on-phone">Menu</span><span className="on-wide">More</span>
      </button>
      <div id="site-menu" className="menu-panel" hidden={!open}>
        {name && <div className="menu-who">
          <p>Recording as <b>{name}</b></p>
          <button type="button" className="link" onClick={() => { setOpen(false); askName(); }}>Change name</button>
        </div>}
        <nav className="menu-nav" aria-label="Main">{links}</nav>
        <p className="fine-print">Demo data: the growers, buyers and messages are made up.</p>
        <ThemeToggle initial={theme} />
        <div className="menu-apart">
          <button type="button" ref={reset} className="danger" onClick={() => dialog.current?.showModal()}>Reset demo</button>
        </div>
      </div>
      <dialog ref={dialog} className="confirm" aria-labelledby="reset-title" aria-describedby="reset-what" onClose={() => reset.current?.focus()}>
        <h2 id="reset-title">Reset the demo?</h2>
        <p id="reset-what">This clears today's decisions and the remembered name.</p>
        <div className="row">
          <button type="button" autoFocus onClick={() => dialog.current?.close()}>Cancel</button>
          <form action={resetAction}><button type="submit" className="danger">Reset demo</button></form>
        </div>
      </dialog>
    </div>
  </>;
}
