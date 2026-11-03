import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Suspense, type ReactNode } from "react";
import { rememberedName } from "./lib/name.ts";
import { ClearErrors } from "./clear-errors.tsx";
import { Header, TabBar } from "./nav.tsx";
import type { Theme } from "./theme.tsx";
import { Who } from "./who.tsx";
import { PITCH } from "./lib/pitch.ts";
import "./globals.css";

const type = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { template: "%s · Harvest Relay", default: "Harvest Relay" },
  description: PITCH
};

export default async function Layout({ children }: { children: ReactNode }) {
  const saved = (await cookies()).get("theme")?.value;
  const theme: Theme = saved === "light" || saved === "dark" ? saved : "auto";
  const name = await rememberedName();
  return (
    <html lang="en" data-theme={theme === "auto" ? undefined : theme}>
      <body className={type.className}>
        <header className="top">
          <Header theme={theme} name={name} who={<Who name={name} />} />
        </header>
        <main id="main" tabIndex={-1} className="page">{children}</main>
        <TabBar />
        <Suspense fallback={null}><ClearErrors /></Suspense>
      </body>
    </html>
  );
}
