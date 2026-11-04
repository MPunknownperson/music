import { desc } from "drizzle-orm";
import { db } from "@/db";
import { gameSessions } from "@/db/schema";
import type { GameRules, InputMode } from "@/engine/types";
import { clamp } from "@/engine/util";
import { intParam, num, oneOf } from "@/lib/validate";

export const dynamic = "force-dynamic";

const MODES: readonly InputMode[] = ["keyboard", "tilt"];

/** Recent arena runs, newest first. Used to build the behaviour profile. */
export async function GET(req: Request) {
  const limit = intParam(new URL(req.url).searchParams.get("limit"), 20, 1, 100);
  const rows = await db
    .select()
    .from(gameSessions)
    .orderBy(desc(gameSessions.createdAt), desc(gameSessions.id))
    .limit(limit);
  return Response.json({ sessions: rows });
}

/** Stores a finished run together with the rule program that configured it. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Body must be an object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const rules =
    typeof b.rules === "object" && b.rules !== null ? (b.rules as GameRules) : null;

  const [inserted] = await db
    .insert(gameSessions)
    .values({
      mode: oneOf(b.mode, MODES, "keyboard"),
      score: Math.round(clamp(num(b.score, 0), 0, 10_000_000)),
      maxCombo: Math.round(clamp(num(b.maxCombo, 0), 0, 100000)),
      hits: Math.round(clamp(num(b.hits, 0), 0, 100000)),
      misses: Math.round(clamp(num(b.misses, 0), 0, 100000)),
      accuracy: clamp(num(b.accuracy, 0), 0, 1),
      meanOffsetMs: clamp(num(b.meanOffsetMs, 0), -1000, 1000),
      motionRatio: clamp(num(b.motionRatio, 0), 0, 1),
      bpm: Math.round(clamp(num(b.bpm, 100), 40, 240)),
      laneCount: Math.round(clamp(num(b.laneCount, 4), 3, 5)),
      rules,
    })
    .returning();

  return Response.json({ session: inserted }, { status: 201 });
}
