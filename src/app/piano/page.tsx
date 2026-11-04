import type { Metadata } from "next";
import PianoClient from "@/components/piano/PianoClient";

export const metadata: Metadata = { title: "Piano · Fret & Key" };

export default function PianoPage() {
  return <PianoClient />;
}
