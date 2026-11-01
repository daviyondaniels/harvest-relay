import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { rememberedName } from "./lib/name.ts";
import { Header, TabBar } from "./nav.tsx";
import type { Theme } from "./theme.tsx";
import { Who } from "./who.tsx";
import "./globals.css";

const type = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { template: "%s · Harvest Relay", default: "Harvest Relay" },
  description: "Turn changing grower updates into reviewed supply changes and order impact for a small food hub."
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
      </body>
    </html>
  );
}
