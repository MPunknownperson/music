import { clamp, average } from "../util";
import type { MusicEngine } from "../music/audio";
import type {
  GameRules,
  HitVia,
  InputMode,
  Judgement,
  NoteEvent,
  Pattern,
  RunSummary,
} from "../types";

export interface ArenaNote {
  id: number;
  lane: number;
  /** Beat position (transport coordinates) at which the note should be hit. */
  hitBeat: number;
  midi: number;
  state: "pending" | "hit" | "miss";
  judgement: Judgement | null;
}

export type ArenaEvent =
  | { type: "hit"; judgement: Judgement; lane: number; combo: number; score: number; via: HitVia }
  | { type: "miss"; lane: number; combo: number }
  | { type: "stray"; lane: number }
  | { type: "finish"; summary: RunSummary };

/** Base timing windows in milliseconds; scaled by rules.windowScale. */
const PERFECT_MS = 45;
const GREAT_MS = 90;
const GOOD_MS = 140;

/** Builds the chart from melody events. Lanes follow the melodic contour. */
function buildChart(pattern: Pattern, laneCount: number): { lane: number; beat: number; midi: number }[] {
  const mel = pattern.events.filter((e: NoteEvent) => e.role === "melody" && e.midi.length > 0);
  if (mel.length === 0) return [];
  const pitches = mel.map((e) => e.midi[0]);
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  const span = Math.max(1, hi - lo);
  return mel.map((e) => ({
    beat: e.beat,
    midi: e.midi[0],
    lane: clamp(Math.floor(((e.midi[0] - lo) / span) * laneCount), 0, laneCount - 1),
  }));
}

/**
 * Arena rhythm game. Timing is judged against the music transport clock, so
 * the game and the music engine share one beat grid. The accompaniment plays
 * as a track; melody notes are the chart and sound when the player hits them.
 */
export class ArenaGame {
  readonly rules: GameRules;
  readonly pattern: Pattern;
  readonly notes: ArenaNote[];
  readonly samples: { lane: number; hit: boolean; offsetMs: number | null; via: HitVia | null; beat: number }[] = [];
  readonly mode: InputMode;

  score = 0;
  combo = 0;
  maxCombo = 0;
  hits = 0;
  misses = 0;
  playerLane = 0;
  finished = false;

  private readonly audio: MusicEngine;
  private readonly accompaniment: Pattern;
  private readonly endBeat: number;
  private listeners = new Set<(e: ArenaEvent) => void>();

  constructor(audio: MusicEngine, rules: GameRules, pattern: Pattern, mode: InputMode) {
    this.audio = audio;
    this.rules = rules;
    this.pattern = pattern;
    this.mode = mode;
    this.accompaniment = {
      ...pattern,
      events: pattern.events.filter((e) => e.role !== "melody"),
    };
    this.notes = buildChart(pattern, rules.laneCount).map((c, i) => ({
      id: i + 1,
      lane: c.lane,
      hitBeat: c.beat,
      midi: c.midi,
      state: "pending",
      judgement: null,
    }));
    this.endBeat = pattern.lengthBeats + 1;
  }

  subscribe(listener: (e: ArenaEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(e: ArenaEvent): void {
    this.listeners.forEach((l) => l(e));
  }

  /** Converts a window in ms to beats at the rule tempo. */
  private beatsFor(ms: number): number {
    return (ms / 1000) * (this.rules.bpm / 60);
  }

  private windowMs(base: number): number {
    return base * this.rules.windowScale;
  }

  get laneCount(): number {
    return this.rules.laneCount;
  }

  /** Current transport beat, used by renderers. */
  currentBeat(): number {
    return this.audio.beatNow();
  }

  /** Starts the accompaniment and the shared clock. */
  async start(): Promise<void> {
    await this.audio.start(this.rules.bpm, 0.2);
    this.audio.addTrack(this.accompaniment, { startBeat: 0, loop: false });
  }

  /** Called every animation frame. Marks missed notes and detects the end of the run. */
  update(): void {
    if (this.finished || !this.audio.isRunning) return;
    const beat = this.audio.beatNow();
    const missBeats = this.beatsFor(this.windowMs(GOOD_MS));
    for (const n of this.notes) {
      if (n.state === "pending" && beat - n.hitBeat > missBeats) {
        n.state = "miss";
        n.judgement = "miss";
        this.misses++;
        this.combo = 0;
        this.samples.push({ lane: n.lane, hit: false, offsetMs: null, via: null, beat: n.hitBeat });
        this.emit({ type: "miss", lane: n.lane, combo: 0 });
      }
    }
    if (beat > this.endBeat) this.finish();
  }

  /** Registers a press in `lane`. Returns the judgement, or null for a stray press. */
  hit(lane: number, via: HitVia): Judgement | null {
    if (this.finished || !this.audio.isRunning) return null;
    const beat = this.audio.beatNow();
    const goodBeats = this.beatsFor(this.windowMs(GOOD_MS));

    let best: ArenaNote | null = null;
    let bestDist = Infinity;
    for (const n of this.notes) {
      if (n.state !== "pending" || n.lane !== lane) continue;
      const d = Math.abs(beat - n.hitBeat);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    if (!best || bestDist > goodBeats) {
      this.combo = 0;
      this.emit({ type: "stray", lane });
      return null;
    }

    const offsetMs = ((beat - best.hitBeat) * 60000) / this.rules.bpm;
    const a = Math.abs(offsetMs);
    const judgement: Judgement =
      a <= this.windowMs(PERFECT_MS) ? "perfect" : a <= this.windowMs(GREAT_MS) ? "great" : "good";

    best.state = "hit";
    best.judgement = judgement;
    this.hits++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const multiplier = 1 + Math.floor(this.combo / 10) * 0.1;
    const base = judgement === "perfect" ? 300 : judgement === "great" ? 200 : 100;
    this.score += Math.round(base * multiplier);
    this.samples.push({
      lane,
      hit: true,
      offsetMs: Math.round(offsetMs * 10) / 10,
      via,
      beat: best.hitBeat,
    });

    // The game invokes the music engine: the player's hit sounds the melody note.
    this.audio.noteOn(this.rules.instrument, best.midi, { vel: 0.9, dur: 1.2 });
    this.emit({ type: "hit", judgement, lane, combo: this.combo, score: this.score, via });
    return judgement;
  }

  /** Maps a normalised tilt value (-1..1) to a lane. */
  setLaneFromTilt(tilt: number): void {
    const x = clamp(tilt * this.rules.tiltSensitivity, -1, 1);
    this.playerLane = clamp(Math.round(((x + 1) / 2) * (this.rules.laneCount - 1)), 0, this.rules.laneCount - 1);
  }

  moveLane(delta: number): void {
    this.playerLane = clamp(this.playerLane + delta, 0, this.rules.laneCount - 1);
  }

  /** Notes that should be drawn around the given beat. */
  visibleNotes(beat: number, ahead = 4, behind = 0.8): ArenaNote[] {
    return this.notes.filter((n) => n.hitBeat >= beat - behind && n.hitBeat <= beat + ahead);
  }

  progress(): number {
    return clamp(this.audio.beatNow() / this.endBeat, 0, 1);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.stop();
    this.emit({ type: "finish", summary: this.summary() });
  }

  summary(): RunSummary {
    const total = Math.max(1, this.notes.length);
    const offsets = this.samples.filter((s) => s.hit && s.offsetMs !== null).map((s) => s.offsetMs as number);
    const motionHits = this.samples.filter((s) => s.via === "shake").length;
    return {
      mode: this.mode,
      score: this.score,
      accuracy: Math.round((this.hits / total) * 1000) / 1000,
      meanOffsetMs: Math.round(average(offsets) * 10) / 10,
      motionRatio: this.hits > 0 ? Math.round((motionHits / this.hits) * 1000) / 1000 : 0,
      maxCombo: this.maxCombo,
      bpm: this.rules.bpm,
      laneCount: this.rules.laneCount,
      hits: this.hits,
      misses: this.misses,
    };
  }
}
