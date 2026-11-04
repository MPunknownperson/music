import type { ScaleName } from "../types";

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** Semitone offsets from the tonic for each scale. */
export const SCALE_INTERVALS: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};

export const SCALE_LABELS: Record<ScaleName, string> = {
  major: "Major",
  minor: "Natural minor",
  dorian: "Dorian",
  pentatonic: "Major pentatonic",
  blues: "Blues",
};

/** Selectable tonics: C3 .. B3 as MIDI numbers. */
export const ROOT_OPTIONS: number[] = Array.from({ length: 12 }, (_, i) => 48 + i);

export interface Progression {
  id: string;
  name: string;
  /** Scale-degree indices (0-based). */
  degrees: number[];
}

export const PROGRESSIONS: Progression[] = [
  { id: "pop", name: "I · V · vi · IV (pop)", degrees: [0, 4, 5, 3] },
  { id: "jazz", name: "ii · V · I · vi (jazz)", degrees: [1, 4, 0, 5] },
  { id: "doowop", name: "I · vi · IV · V (doo-wop)", degrees: [0, 5, 3, 4] },
  { id: "lift", name: "vi · IV · I · V (minor lift)", degrees: [5, 3, 0, 4] },
  { id: "modal", name: "I · IV · vi · V (modal)", degrees: [0, 3, 5, 4] },
];

export function getProgression(id: string): Progression {
  return PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0];
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${NOTE_NAMES[pc]}${Math.floor(midi / 12) - 1}`;
}

export function scaleSize(scale: ScaleName): number {
  return SCALE_INTERVALS[scale].length;
}

/** Ascending MIDI notes of a scale across `octaves` octaves starting at `root`. */
export function scaleMidi(root: number, scale: ScaleName, octaves = 2): number[] {
  const intervals = SCALE_INTERVALS[scale];
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const iv of intervals) out.push(root + o * 12 + iv);
  }
  return out;
}

/** Diatonic triad (root, third, fifth) built on a scale degree. Returns MIDI notes. */
export function chordAt(root: number, scale: ScaleName, degree: number): number[] {
  const n = scaleSize(scale);
  const ext = scaleMidi(root, scale, 3);
  const d = ((degree % n) + n) % n;
  return [ext[d], ext[d + 2], ext[d + 4]];
}

/** Human-readable chord name, e.g. "C", "Am", "Bdim". */
export function chordName(root: number, scale: ScaleName, degree: number): string {
  const c = chordAt(root, scale, degree);
  const third = c[1] - c[0];
  const fifth = c[2] - c[0];
  let suffix = "";
  if (third === 3) suffix = fifth === 6 ? "dim" : "m";
  return `${NOTE_NAMES[c[0] % 12]}${suffix}`;
}
