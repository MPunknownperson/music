// Shared domain types for the music engine, the arena game engine and the
// adaptive rule generator. Kept free of runtime code so it can be imported
// from both client components and server code (including drizzle schema).

export type PitchedInstrument = "piano" | "guitar";
export type Instrument = PitchedInstrument | "kick" | "hat";
export type Role = "melody" | "chord" | "bass" | "drum";
export type ScaleName = "major" | "minor" | "dorian" | "pentatonic" | "blues";
export type InputMode = "keyboard" | "tilt";
export type HitVia = "keyboard" | "touch" | "shake";
export type Judgement = "perfect" | "great" | "good" | "miss";

export interface NoteEvent {
  /** Start position in beats relative to the pattern start. */
  beat: number;
  /** One or more MIDI note numbers (a chord when length > 1). */
  midi: number[];
  /** Duration in beats. */
  dur: number;
  /** Velocity 0..1. */
  vel: number;
  inst: Instrument;
  role: Role;
}

export interface Pattern {
  name: string;
  bpm: number;
  lengthBeats: number;
  events: NoteEvent[];
}

export interface HitSample {
  lane: number;
  hit: boolean;
  /** Positive = late, negative = early. */
  offsetMs: number | null;
  via: HitVia | null;
  beat: number;
}

/** Aggregated outcome of one arena run. */
export interface SessionSummary {
  accuracy: number;
  meanOffsetMs: number;
  motionRatio: number;
  maxCombo: number;
  bpm: number;
  laneCount: number;
  hits: number;
  misses: number;
}

export interface RunSummary extends SessionSummary {
  mode: InputMode;
  score: number;
}

/** Behaviour profile derived from recent session history. */
export interface BehaviorProfile {
  sessions: number;
  accuracy: number;
  meanOffsetMs: number;
  motionRatio: number;
  avgCombo: number;
  /** 0..1 composite skill estimate. */
  skill: number;
}

/**
 * Rule program that configures the next arena run. Produced by
 * `generateRules` in engine/game/adaptive.ts and stored with every session.
 */
export interface GameRules {
  version: number;
  bpm: number;
  laneCount: 3 | 4 | 5;
  scale: ScaleName;
  /** MIDI tonic, e.g. 57 = A3. */
  root: number;
  /** Scale-degree indices (0-based) of the chord progression. */
  progression: number[];
  density: number;
  windowScale: number;
  tiltSensitivity: number;
  instrument: PitchedInstrument;
  swing: number;
  /** Human-readable trace of the rules that fired. */
  source: string[];
}
