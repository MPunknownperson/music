import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arena · Music & Game Engine",
  description:
    "Synth piano and guitar, a generative composer, a rhythm arena whose rules adapt to the player, and motion controls.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,#312e81_0%,transparent_55%),radial-gradient(circle_at_bottom_right,#701a75_0%,transparent_50%)] opacity-80"
        />
        <main className="px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
