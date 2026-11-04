import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Nav from "@/components/ui/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fret & Key · Music production and instrument studio",
  description:
    "Play a simulated piano and guitar, explore scales and chords, compose multi-track songs and practise rhythm. Works with touch, computer keyboards and game controllers.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#131217",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Nav />
        <main className="mx-auto max-w-7xl px-3 pb-24 pt-4 sm:px-4 md:pb-10">{children}</main>
      </body>
    </html>
  );
}
