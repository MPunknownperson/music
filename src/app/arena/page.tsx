import ArenaClient from "@/components/arena/ArenaClient";

export const dynamic = "force-dynamic";

export default async function ArenaPage({
  searchParams,
}: {
  searchParams: Promise<{ comp?: string }>;
}) {
  const { comp } = await searchParams;
  const id = comp ? Number.parseInt(comp, 10) : Number.NaN;
  return <ArenaClient initialCompId={Number.isFinite(id) ? id : null} />;
}
