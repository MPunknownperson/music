import type { ScaleName } from "../types";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

/** Semitone offsets from the tonic for each scale. */
export const SCALE_INTERVALS: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export const SCALE_LABELS: Record<ScaleName, string> = {
  major: "Major (Ionian)",
  minor: "Natural minor (Aeolian)",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  locrian: "Locrian",
  harmonicMinor: "Harmonic minor",
  melodicMinor: "Melodic minor",
  pentatonic: "Major pentatonic",
  minorPentatonic: "Minor pentatonic",
  blues: "Blues",
};

export const SCALE_MOODS: Record<ScaleName, string> = {
  major: "Bright, resolved, the reference point of Western harmony.",
  minor: "Dark and emotional; flat 3rd, 6th and 7th.",
  dorian: "Minor with a raised 6th: soulful, funky, jazzy.",
  phrygian: "Minor with a flat 2nd: Spanish, flamenco and metal.",
  lydian: "Major with a raised 4th: dreamy and cinematic.",
  mixolydian: "Major with a flat 7th: blues-rock and folk.",
  locrian: "Diminished tonic: tense and unstable.",
  harmonicMinor: "Minor with a raised 7th: classical, exotic leading tone.",
  melodicMinor: "Minor with raised 6th and 7th: jazz minor.",
  pentatonic: "Five notes, no semitones; you can't hit a wrong note.",
  minorPentatonic: "The guitar solo scale: rock, blues and pop.",
  blues: "Minor pentatonic plus the ♭5 'blue note'.",
};

export const SCALE_NAMES = Object.keys(SCALE_INTERVALS) as ScaleName[];

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
  { id: "canon", name: "I · V · vi · iii · IV · I · IV · V (canon)", degrees: [0, 4, 5, 2, 3, 0, 3, 4] },
  { id: "blues", name: "I · IV · I · V (blues turn)", degrees: [0, 3, 0, 4] },
  { id: "andalusian", name: "i · VII · VI · V (andalusian)", degrees: [0, 6, 5, 4] },
];

export function getProgression(id: string): Progression {
  return PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0];
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function noteName(pc: number): string {
  return NOTE_NAMES[pitchClass(pc)];
}

export function midiName(midi: number): string {
  return `${NOTE_NAMES[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(midi));
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

export function scalePitchClasses(root: number, scale: ScaleName): number[] {
  return SCALE_INTERVALS[scale].map((iv) => pitchClass(root + iv));
}

export function inScale(midi: number, root: number, scale: ScaleName): boolean {
  return scalePitchClasses(root, scale).includes(pitchClass(midi));
}

/** Diatonic triad (root, third, fifth) built on a scale degree. Returns MIDI notes. */
export function chordAt(root: number, scale: ScaleName, degree: number): number[] {
  const n = scaleSize(scale);
  const ext = scaleMidi(root, scale, 3);
  const d = ((degree % n) + n) % n;
  return [ext[d], ext[d + 2], ext[d + 4]];
}

/** Diatonic seventh chord on a scale degree. */
export function seventhAt(root: number, scale: ScaleName, degree: number): number[] {
  const n = scaleSize(scale);
  const ext = scaleMidi(root, scale, 3);
  const d = ((degree % n) + n) % n;
  return [ext[d], ext[d + 2], ext[d + 4], ext[d + 6]];
}

/** Human-readable chord name, e.g. "C", "Am", "Bdim". */
export function chordName(root: number, scale: ScaleName, degree: number): string {
  const c = chordAt(root, scale, degree);
  return `${NOTE_NAMES[pitchClass(c[0])]}${triadSuffix(c)}`;
}

function triadSuffix(c: number[]): string {
  const third = c[1] - c[0];
  const fifth = c[2] - c[0];
  if (third === 3) return fifth === 6 ? "dim" : "m";
  if (third === 4 && fifth === 8) return "aug";
  return "";
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** Roman numeral for a diatonic degree, lowercase for minor/diminished. */
export function romanAt(root: number, scale: ScaleName, degree: number): string {
  const c = chordAt(root, scale, degree);
  const s = triadSuffix(c);
  const base = ROMAN[degree % 7] ?? String(degree + 1);
  if (s === "m") return base.toLowerCase();
  if (s === "dim") return `${base.toLowerCase()}°`;
  if (s === "aug") return `${base}+`;
  return base;
}

export interface ChordQuality {
  id: string;
  label: string;
  symbol: string;
  intervals: number[];
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { id: "maj", label: "Major", symbol: "", intervals: [0, 4, 7] },
  { id: "min", label: "Minor", symbol: "m", intervals: [0, 3, 7] },
  { id: "dim", label: "Diminished", symbol: "dim", intervals: [0, 3, 6] },
  { id: "aug", label: "Augmented", symbol: "aug", intervals: [0, 4, 8] },
  { id: "sus2", label: "Suspended 2nd", symbol: "sus2", intervals: [0, 2, 7] },
  { id: "sus4", label: "Suspended 4th", symbol: "sus4", intervals: [0, 5, 7] },
  { id: "7", label: "Dominant 7th", symbol: "7", intervals: [0, 4, 7, 10] },
  { id: "maj7", label: "Major 7th", symbol: "maj7", intervals: [0, 4, 7, 11] },
  { id: "m7", label: "Minor 7th", symbol: "m7", intervals: [0, 3, 7, 10] },
  { id: "m7b5", label: "Half-diminished", symbol: "m7♭5", intervals: [0, 3, 6, 10] },
  { id: "dim7", label: "Diminished 7th", symbol: "dim7", intervals: [0, 3, 6, 9] },
  { id: "add9", label: "Add 9", symbol: "add9", intervals: [0, 4, 7, 14] },
  { id: "6", label: "Major 6th", symbol: "6", intervals: [0, 4, 7, 9] },
  { id: "9", label: "Dominant 9th", symbol: "9", intervals: [0, 4, 7, 10, 14] },
];

export function getQuality(id: string): ChordQuality {
  return CHORD_QUALITIES.find((q) => q.id === id) ?? CHORD_QUALITIES[0];
}

export function buildChord(rootMidi: number, qualityId: string): number[] {
  return getQuality(qualityId).intervals.map((iv) => rootMidi + iv);
}

/** Detects the quality of a diatonic triad/7th to look up guitar shapes. */
export function qualityOf(notes: number[]): string {
  const ivs = notes.map((n) => n - notes[0]).sort((a, b) => a - b).join(",");
  const q = CHORD_QUALITIES.find((c) => c.intervals.join(",") === ivs);
  return q?.id ?? "maj";
}

export const INTERVALS = [
  { semis: 0, short: "P1", name: "Unison", feel: "Identical pitch" },
  { semis: 1, short: "m2", name: "Minor 2nd", feel: "Tense, Jaws theme" },
  { semis: 2, short: "M2", name: "Major 2nd", feel: "Stepwise, Happy Birthday" },
  { semis: 3, short: "m3", name: "Minor 3rd", feel: "Sad, the minor colour" },
  { semis: 4, short: "M3", name: "Major 3rd", feel: "Happy, the major colour" },
  { semis: 5, short: "P4", name: "Perfect 4th", feel: "Open, Here Comes the Bride" },
  { semis: 6, short: "TT", name: "Tritone", feel: "Unstable, The Simpsons" },
  { semis: 7, short: "P5", name: "Perfect 5th", feel: "Strong, power chords" },
  { semis: 8, short: "m6", name: "Minor 6th", feel: "Bittersweet" },
  { semis: 9, short: "M6", name: "Major 6th", feel: "Warm, My Bonnie" },
  { semis: 10, short: "m7", name: "Minor 7th", feel: "Bluesy, dominant pull" },
  { semis: 11, short: "M7", name: "Major 7th", feel: "Dreamy, leading tone" },
  { semis: 12, short: "P8", name: "Octave", feel: "Same note, doubled frequency" },
];

/** Circle of fifths: pitch classes clockwise from C. */
export const CIRCLE_OF_FIFTHS = Array.from({ length: 12 }, (_, i) => (i * 7) % 12);

export function relativeMinorPc(majorPc: number): number {
  return pitchClass(majorPc + 9);
}

/** Number of sharps (+) or flats (-) in a major key signature. */
export function keySignature(majorPc: number): number {
  const idx = CIRCLE_OF_FIFTHS.indexOf(pitchClass(majorPc));
  return idx <= 6 ? idx : idx - 12;
}
