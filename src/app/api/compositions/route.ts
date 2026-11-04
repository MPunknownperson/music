import { desc } from "drizzle-orm";
import { db } from "@/db";
import { compositions } from "@/db/schema";
import type { PitchedInstrument } from "@/engine/types";
import { clamp } from "@/engine/util";
import { intParam, num, oneOf, parseNoteEvents, str } from "@/lib/validate";

export const dynamic = "force-dynamic";

const INSTRUMENTS: readonly PitchedInstrument[] = ["piano", "guitar"];

/** Saved compositions, newest first. */
export async function GET(req: Request) {
  const limit = intParam(new URL(req.url).searchParams.get("limit"), 30, 1, 100);
  const rows = await db
    .select()
    .from(compositions)
    .orderBy(desc(compositions.createdAt), desc(compositions.id))
    .limit(limit);
  return Response.json({ compositions: rows });
}

/** Saves a composition. Events are validated and sanitised before storage. */
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
  const events = parseNoteEvents(b.events);
  if (!events) {
    return Response.json({ error: "events must be a non-empty array of note events" }, { status: 400 });
  }

  const [inserted] = await db
    .insert(compositions)
    .values({
      title: str(b.title, "Untitled", 80),
      bpm: Math.round(clamp(num(b.bpm, 100), 40, 240)),
      instrument: oneOf(b.instrument, INSTRUMENTS, "piano"),
      seed: Math.round(clamp(num(b.seed, 0), 0, 2_147_483_647)),
      events,
    })
    .returning();

  return Response.json({ composition: inserted }, { status: 201 });
}
