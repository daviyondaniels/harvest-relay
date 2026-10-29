"use client";
import { useState } from "react";

// Light, dark or follow the device. The choice is a cookie, so the server renders the
// right theme on the next page load with no flash; this sets it for the current page.
export type Theme = "light" | "dark" | "auto";
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const choose = (t: Theme) => {
    setTheme(t);
    document.cookie = `theme=${t}; path=/; max-age=31536000; samesite=strict`;
    if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  };
  return (
    <div className="theme" role="group" aria-label="Colour theme">
      {(["light", "dark", "auto"] as const).map(t => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => choose(t)}>{t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark"}</button>
      ))}
    </div>
  );
}
