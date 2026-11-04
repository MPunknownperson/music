import type { Metadata } from "next";
import TheoryClient from "@/components/theory/TheoryClient";

export const metadata: Metadata = { title: "Theory lab · Fret & Key" };

export default function TheoryPage() {
  return <TheoryClient />;
}
