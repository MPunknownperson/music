import type { Metadata } from "next";
import StudioClient from "@/components/studio/StudioClient";

export const metadata: Metadata = { title: "Studio · Fret & Key" };

export default function StudioPage() {
  return <StudioClient />;
}
