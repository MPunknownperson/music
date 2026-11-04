import type { Instrument, NoteEvent, Role } from "@/engine/types";
import { clamp } from "@/engine/util";

export function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback: string, max = 120): string {
  if (typeof v !== "string") return fallback;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : fallback;
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function intParam(v: string | null, fallback: number, min: number, max: number): number {
  const n = v === null ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

const INSTRUMENTS: readonly Instrument[] = ["piano", "guitar", "kick", "hat"];
const ROLES: readonly Role[] = ["melody", "chord", "bass", "drum"];

/** Validates and sanitises an untrusted list of note events. Returns null when malformed. */
export function parseNoteEvents(input: unknown, maxEvents = 2000): NoteEvent[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > maxEvents) return null;
  const out: NoteEvent[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return null;
    const e = raw as Record<string, unknown>;
    if (!Array.isArray(e.midi) || e.midi.length === 0 || e.midi.length > 8) return null;
    const midi = e.midi.map((m) => (typeof m === "number" && Number.isFinite(m) ? clamp(Math.round(m), 0, 127) : -1));
    if (midi.some((m) => m < 0)) return null;
    out.push({
      beat: clamp(num(e.beat, 0), 0, 100000),
      midi,
      dur: clamp(num(e.dur, 0.5), 0.05, 64),
      vel: clamp(num(e.vel, 0.7), 0, 1),
      inst: oneOf(e.inst, INSTRUMENTS, "piano"),
      role: oneOf(e.role, ROLES, "melody"),
    });
  }
  return out;
}
