import { clamp } from "../util";
import type { NoteEvent, Pattern, PitchedInstrument, ScaleName } from "../types";
import { chordAt, scaleMidi, scaleSize } from "./theory";

/** Small deterministic PRNG (mulberry32). Same seed → same composition. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ComposeOptions {
  name?: string;
  seed: number;
  bpm: number;
  root: number;
  scale: ScaleName;
  bars: number;
  instrument: PitchedInstrument;
  progression: number[];
  density: number;
  swing: number;
  drums: boolean;
}

/**
 * Generates a full pattern: chord comping, bass, a melodic line on an eighth
 * grid (role "melody", which the arena charts) and optional drums.
 */
export function composePattern(o: ComposeOptions): Pattern {
  const rnd = mulberry32(o.seed);
  const n = scaleSize(o.scale);
  const tones = scaleMidi(o.root, o.scale, 3);
  const prog = o.progression.length > 0 ? o.progression : [0];
  const events: NoteEvent[] = [];
  // Melody index runs over 0 .. 2n-1, pitched one octave above the tonic.
  let cur = 0;
  const maxIdx = 2 * n - 1;

  for (let bar = 0; bar < o.bars; bar++) {
    const bb = bar * 4;
    const chord = chordAt(o.root, o.scale, prog[bar % prog.length]);
    const pcs = chord.map((m) => m % 12);

    events.push({
      beat: bb,
      midi: chord.map((m) => m - 12),
      dur: 4,
      vel: 0.45,
      inst: o.instrument,
      role: "chord",
    });
    events.push({
      beat: bb,
      midi: [chord[0] - 24],
      dur: 1.8,
      vel: 0.7,
      inst: o.instrument,
      role: "bass",
    });
    events.push({
      beat: bb + 2,
      midi: [chord[2] - 24],
      dur: 1.8,
      vel: 0.6,
      inst: o.instrument,
      role: "bass",
    });

    for (let s = 0; s < 8; s++) {
      const strong = s === 0 || s === 4;
      // Swing delays off-beat eighths.
      const beat = bb + s * 0.5 + (s % 2 === 1 ? o.swing * 0.5 : 0);

      if (o.drums) {
        if (s === 0 || s === 4 || (s === 6 && rnd() < 0.3)) {
          events.push({ beat, midi: [36], dur: 0.25, vel: 0.95, inst: "kick", role: "drum" });
        }
        events.push({
          beat,
          midi: [42],
          dur: 0.1,
          vel: s % 2 === 1 ? 0.22 : 0.4,
          inst: "hat",
          role: "drum",
        });
      }

      if (rnd() > o.density * (strong ? 0.95 : 0.55)) continue;

      const steps = [-2, -1, -1, 0, 1, 1, 2, 3, -3];
      let next = clamp(cur + steps[Math.floor(rnd() * steps.length)], 0, maxIdx);
      if (strong) {
        // Land melodic accents on chord tones when a neighbour allows it.
        for (const c of [next, next - 1, next + 1, next - 2, next + 2]) {
          if (c >= 0 && c <= maxIdx && pcs.includes(tones[c + n] % 12)) {
            next = c;
            break;
          }
        }
      }
      cur = next;
      events.push({
        beat,
        midi: [tones[cur + n]],
        dur: rnd() < 0.3 ? 1 : 0.5,
        vel: strong ? 0.9 : 0.6 + rnd() * 0.2,
        inst: o.instrument,
        role: "melody",
      });
    }
  }

  events.sort((a, b) => a.beat - b.beat);
  return {
    name: o.name ?? `Composition ${o.seed}`,
    bpm: o.bpm,
    lengthBeats: o.bars * 4,
    events,
  };
}

/** Chords-only pattern for a progression loop. */
export function progressionPattern(o: {
  name?: string;
  root: number;
  scale: ScaleName;
  degrees: number[];
  bpm: number;
  instrument: PitchedInstrument;
  bars: number;
}): Pattern {
  const events: NoteEvent[] = [];
  const deg = o.degrees.length > 0 ? o.degrees : [0];
  for (let bar = 0; bar < o.bars; bar++) {
    const chord = chordAt(o.root, o.scale, deg[bar % deg.length]);
    events.push({
      beat: bar * 4,
      midi: chord.map((m) => m - 12),
      dur: 4,
      vel: 0.6,
      inst: o.instrument,
      role: "chord",
    });
  }
  return {
    name: o.name ?? "Progression",
    bpm: o.bpm,
    lengthBeats: o.bars * 4,
    events,
  };
}

/** Arpeggio layer the game adds to the music on combo milestones. */
export function makeArpLayer(o: {
  root: number;
  scale: ScaleName;
  progression: number[];
  bpm: number;
  instrument: PitchedInstrument;
  seed: number;
  bars: number;
}): Pattern {
  const rnd = mulberry32(o.seed);
  const events: NoteEvent[] = [];
  const deg = o.progression.length > 0 ? o.progression : [0];
  for (let bar = 0; bar < o.bars; bar++) {
    const c = chordAt(o.root, o.scale, deg[bar % deg.length]);
    const arp = [c[0] + 12, c[1] + 12, c[2] + 12, c[0] + 24];
    const shift = Math.floor(rnd() * 2);
    for (let s = 0; s < 8; s++) {
      events.push({
        beat: bar * 4 + s * 0.5,
        midi: [arp[(s + shift) % arp.length]],
        dur: 0.5,
        vel: 0.42,
        inst: o.instrument,
        role: "chord",
      });
    }
  }
  return {
    name: `Arp layer ${o.seed}`,
    bpm: o.bpm,
    lengthBeats: o.bars * 4,
    events,
  };
}
