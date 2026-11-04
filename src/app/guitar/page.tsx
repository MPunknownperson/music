import type { Metadata } from "next";
import GuitarClient from "@/components/guitar/GuitarClient";

export const metadata: Metadata = { title: "Guitar · Fret & Key" };

export default function GuitarPage() {
  return <GuitarClient />;
}
