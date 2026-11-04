import { NOTE_NAMES, buildChord, pitchClass } from "./theory";

export interface Tuning {
  id: string;
  name: string;
  /** MIDI notes of open strings, low (6th) to high (1st). */
  strings: number[];
}

export const TUNINGS: Tuning[] = [
  { id: "standard", name: "Standard (E A D G B E)", strings: [40, 45, 50, 55, 59, 64] },
  { id: "dropD", name: "Drop D (D A D G B E)", strings: [38, 45, 50, 55, 59, 64] },
  { id: "halfDown", name: "Half-step down (E♭)", strings: [39, 44, 49, 54, 58, 63] },
  { id: "dadgad", name: "DADGAD", strings: [38, 45, 50, 55, 57, 62] },
  { id: "openG", name: "Open G (D G D G B D)", strings: [38, 43, 50, 55, 59, 62] },
  { id: "openD", name: "Open D (D A D F# A D)", strings: [38, 45, 50, 54, 57, 62] },
];

export function getTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

export const FRET_COUNT = 15;
export const FRET_MARKERS = [3, 5, 7, 9, 12, 15];

/** Fret positions per string, -1 = muted, 0 = open. Low string first. */
export type Shape = number[];

/** Hand-tuned open shapes for standard tuning, keyed by "<Root><quality>". */
const OPEN_SHAPES: Record<string, Shape> = {
  "Cmaj": [-1, 3, 2, 0, 1, 0],
  "Dmaj": [-1, -1, 0, 2, 3, 2],
  "Emaj": [0, 2, 2, 1, 0, 0],
  "Gmaj": [3, 2, 0, 0, 0, 3],
  "Amaj": [-1, 0, 2, 2, 2, 0],
  "Amin": [-1, 0, 2, 2, 1, 0],
  "Dmin": [-1, -1, 0, 2, 3, 1],
  "Emin": [0, 2, 2, 0, 0, 0],
  "C7": [-1, 3, 2, 3, 1, 0],
  "D7": [-1, -1, 0, 2, 1, 2],
  "E7": [0, 2, 0, 1, 0, 0],
  "G7": [3, 2, 0, 0, 0, 1],
  "A7": [-1, 0, 2, 0, 2, 0],
  "B7": [-1, 2, 1, 2, 0, 2],
  "Cmaj7": [-1, 3, 2, 0, 0, 0],
  "Dmaj7": [-1, -1, 0, 2, 2, 2],
  "Fmaj7": [-1, -1, 3, 2, 1, 0],
  "Gmaj7": [3, 2, 0, 0, 0, 2],
  "Amaj7": [-1, 0, 2, 1, 2, 0],
  "Am7": [-1, 0, 2, 0, 1, 0],
  "Dm7": [-1, -1, 0, 2, 1, 1],
  "Em7": [0, 2, 0, 0, 0, 0],
  "Asus2": [-1, 0, 2, 2, 0, 0],
  "Dsus2": [-1, -1, 0, 2, 3, 0],
  "Asus4": [-1, 0, 2, 2, 3, 0],
  "Dsus4": [-1, -1, 0, 2, 3, 3],
  "Esus4": [0, 2, 2, 2, 0, 0],
  "Bdim": [-1, 2, 3, 4, 3, -1],
};

function shapeKey(rootPc: number, quality: string): string {
  const n = NOTE_NAMES[rootPc];
  if (quality === "min") return `${n}min`;
  if (quality === "maj") return `${n}maj`;
  if (quality === "m7") return `${n}m7`;
  return `${n}${quality}`;
}

/** Generic voicing search: works for any tuning and chord quality. */
function searchShape(tuning: Tuning, rootPc: number, pcs: number[]): Shape {
  let best: { shape: Shape; score: number } | null = null;
  for (let pos = 0; pos <= 10; pos++) {
    const shape: Shape = [];
    let foundRoot = false;
    for (const open of tuning.strings) {
      let pick = -1;
      const candidates = pos === 0 ? [0, 1, 2, 3] : [pos, pos + 1, pos + 2, pos + 3];
      for (const f of candidates) {
        const pc = pitchClass(open + f);
        if (!foundRoot) {
          if (pc === rootPc) {
            pick = f;
            break;
          }
        } else if (pcs.includes(pc)) {
          pick = f;
          break;
        }
      }
      if (pick >= 0 && !foundRoot) foundRoot = true;
      shape.push(pick);
    }
    const sounding = shape.filter((f) => f >= 0).length;
    if (sounding < 3) continue;
    const covered = new Set(shape.map((f, i) => (f >= 0 ? pitchClass(tuning.strings[i] + f) : -1)));
    const coverage = pcs.filter((p) => covered.has(p)).length;
    // Penalise internal muted strings (hard to play).
    const first = shape.findIndex((f) => f >= 0);
    const holes = shape.slice(first).filter((f) => f < 0).length;
    const score = coverage * 10 + sounding * 2 - pos * 0.6 - holes * 6;
    if (!best || score > best.score) best = { shape, score };
  }
  return best?.shape ?? tuning.strings.map(() => 0);
}

/** Movable barre shapes (relative to the barre fret) rooted on the 6th (E) and 5th (A) strings. */
const E_SHAPES: Record<string, Shape> = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  "7": [0, 2, 0, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, -1, 1, 1, 0, -1],
  sus4: [0, 2, 2, 2, 0, 0],
};
const A_SHAPES: Record<string, Shape> = {
  maj: [-1, 0, 2, 2, 2, 0],
  min: [-1, 0, 2, 2, 1, 0],
  "7": [-1, 0, 2, 0, 2, 0],
  m7: [-1, 0, 2, 0, 1, 0],
  maj7: [-1, 0, 2, 1, 2, 0],
  sus2: [-1, 0, 2, 2, 0, 0],
  sus4: [-1, 0, 2, 2, 3, 0],
  dim: [-1, 0, 1, 2, 1, -1],
  add9: [-1, 0, 2, 4, 2, 0],
};

function barre(rel: Shape, fret: number): Shape {
  return rel.map((f) => (f < 0 ? -1 : f + fret));
}

export function chordShape(tuning: Tuning, rootPc: number, quality: string): Shape {
  if (tuning.id === "standard") {
    const open = OPEN_SHAPES[shapeKey(rootPc, quality)];
    if (open) return open;
    const eFret = pitchClass(rootPc - 4) || 12;
    const aFret = pitchClass(rootPc - 9) || 12;
    const e = E_SHAPES[quality];
    const a = A_SHAPES[quality];
    if (e && (!a || eFret <= aFret)) return barre(e, eFret);
    if (a) return barre(a, aFret);
  }
  const pcs = buildChord(rootPc, quality).map(pitchClass);
  return searchShape(tuning, rootPc, pcs);
}

/** MIDI notes sounded by a shape (with capo), low to high. */
export function shapeNotes(tuning: Tuning, shape: Shape, capo = 0): number[] {
  const out: number[] = [];
  shape.forEach((f, i) => {
    if (f >= 0) out.push(tuning.strings[i] + f + capo);
  });
  return out;
}

export function fretMidi(tuning: Tuning, stringIndex: number, fret: number, capo = 0): number {
  return tuning.strings[stringIndex] + fret + capo;
}
