import type { Metadata } from "next";
import ArenaClient from "@/components/arena/ArenaClient";

export const metadata: Metadata = { title: "Rhythm arena · Fret & Key" };
export const dynamic = "force-dynamic";

export default async function ArenaPage({
  searchParams,
}: {
  searchParams: Promise<{ song?: string; comp?: string }>;
}) {
  const { song, comp } = await searchParams;
  return <ArenaClient initialCompId={song ?? comp ?? null} />;
}
