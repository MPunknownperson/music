import type { Patch } from "./patches";

/**
 * Piano performance and voicing model.
 *
 * Everything here maps to something a piano technician or a recording engineer
 * would recognise: hammer felt hardness, unison detune, string inharmonicity,
 * bridge coupling, damper efficiency, lid position, mic distance, stretch
 * tuning and the velocity response of the action.
 */

export interface PianoSettings {
  hammer: number;
  unison: number;
  inharmonicity: number;
  sustain: number;
  coupling: number;
  soundboard: number;
  lid: number;
  damper: number;
  resonance: number;
  stretch: number;
  tuning: number;
  velocityCurve: number;
  dynamics: number;
  sampleLayer: number;
  width: number;
  distance: number;
  releaseNoise: number;
  polyphony: number;
}

export const DEFAULT_PIANO: PianoSettings = {
  hammer: 0.52,
  unison: 0.7,
  inharmonicity: 0.34,
  sustain: 0.55,
  coupling: 0.32,
  soundboard: 0.45,
  lid: 0.78,
  damper: 0.68,
  resonance: 0.35,
  stretch: 0.5,
  tuning: 440,
  velocityCurve: 0,
  dynamics: 0.85,
  sampleLayer: 0.22,
  width: 0.55,
  distance: 0.3,
  releaseNoise: 0.35,
  polyphony: 32,
};

export interface PianoPreset {
  id: string;
  name: string;
  note: string;
  settings: PianoSettings;
}

const p = (over: Partial<PianoSettings>): PianoSettings => ({ ...DEFAULT_PIANO, ...over });

export const PIANO_PRESETS: PianoPreset[] = [
  {
    id: "concert",
    name: "Concert grand",
    note: "Nine-foot concert instrument, lid fully open, close mics.",
    settings: p({}),
  },
  {
    id: "felt",
    name: "Felt piano",
    note: "Felt between hammers and strings — intimate, dark, mechanical.",
    settings: p({ hammer: 0.14, lid: 0.34, soundboard: 0.6, sustain: 0.44, distance: 0.16, sampleLayer: 0.1, dynamics: 0.7, releaseNoise: 0.6, resonance: 0.45 }),
  },
  {
    id: "upright",
    name: "Studio upright",
    note: "Small soundboard, quick decay, hammers close to the strings.",
    settings: p({ hammer: 0.6, sustain: 0.34, soundboard: 0.62, coupling: 0.45, unison: 1.3, lid: 0.55, distance: 0.2, width: 0.4 }),
  },
  {
    id: "pop",
    name: "Bright pop",
    note: "Hard voicing and a tight low end so the piano cuts through a mix.",
    settings: p({ hammer: 0.86, lid: 0.95, sustain: 0.48, dynamics: 0.55, velocityCurve: 0.35, distance: 0.12, sampleLayer: 0.3, width: 0.7 }),
  },
  {
    id: "classical",
    name: "Recital hall",
    note: "Distant pair in a large room, wide dynamics, long aftersound.",
    settings: p({ hammer: 0.4, sustain: 0.72, lid: 0.7, distance: 0.78, width: 0.8, dynamics: 1, resonance: 0.55 }),
  },
  {
    id: "honky",
    name: "Honky-tonk",
    note: "Badly tuned unisons and a hard, worn action.",
    settings: p({ hammer: 0.78, unison: 3.4, inharmonicity: 0.6, coupling: 0.6, sustain: 0.36, lid: 0.85, stretch: 0.2, soundboard: 0.55 }),
  },
  {
    id: "prepared",
    name: "Prepared",
    note: "Short, damped, metallic — objects on the strings.",
    settings: p({ hammer: 0.7, sustain: 0.12, damper: 0.9, inharmonicity: 0.92, coupling: 0.75, unison: 2.4, soundboard: 0.3, lid: 0.6 }),
  },
  {
    id: "hybrid",
    name: "Sampled hybrid",
    note: "Recorded hammer attack layered over the modelled string body.",
    settings: p({ sampleLayer: 0.75, hammer: 0.5, soundboard: 0.3, distance: 0.25 }),
  },
];

export function pianoPreset(id: string): PianoPreset {
  return PIANO_PRESETS.find((x) => x.id === id) ?? PIANO_PRESETS[0];
}

/**
 * Railsback stretch: real pianos are tuned flat in the bass and sharp in the
 * treble so that the inharmonic partials of low notes line up with the
 * fundamentals of high ones. `amount` scales the full ±30 cent curve.
 */
export function stretchCents(midi: number, amount: number): number {
  if (midi < 60) return -amount * 30 * Math.pow((60 - midi) / 39, 1.6);
  return amount * 34 * Math.pow((midi - 60) / 48, 1.6);
}

export function pianoFrequency(midi: number, s: PianoSettings): number {
  const cents = stretchCents(midi, s.stretch);
  return s.tuning * Math.pow(2, (midi - 69 + cents / 100) / 12);
}

/** Action response: curve shapes the taper, dynamics sets the pp–ff window. */
export function mapVelocity(raw: number, s: PianoSettings): number {
  const v = Math.max(0, Math.min(1, raw));
  const shaped = Math.pow(v, Math.pow(2, -s.velocityCurve * 1.15));
  const floor = (1 - s.dynamics) * 0.55;
  const level = floor + shaped * (1 - floor);
  // piano loudness is roughly a 1.6 power of key speed
  return Math.max(0.02, Math.min(1, Math.pow(level, 1.35)));
}

export function velocityLabel(v: number): string {
  if (v < 0.16) return "ppp";
  if (v < 0.3) return "pp";
  if (v < 0.44) return "p";
  if (v < 0.58) return "mp";
  if (v < 0.7) return "mf";
  if (v < 0.84) return "f";
  if (v < 0.94) return "ff";
  return "fff";
}

/** Bass notes ring far longer under the damper than treble ones. */
export function damperSeconds(midi: number, s: PianoSettings): number {
  const low = Math.max(0, 1 - midi / 72);
  return 0.055 + (1 - s.damper) * (0.28 + low * 0.55);
}

interface TuningTable {
  sampleRate: number;
  hards: number[];
  notes: number[];
  comp: number[][];
}

let table: TuningTable | null = null;
let tablePromise: Promise<TuningTable | null> | null = null;

export async function loadPianoTuning(): Promise<TuningTable | null> {
  if (table) return table;
  if (!tablePromise) {
    tablePromise = fetch("/faust/piano-tuning.json")
      .then((r) => (r.ok ? (r.json() as Promise<TuningTable>) : null))
      .then((t) => {
        table = t;
        return t;
      })
      .catch(() => null);
  }
  return tablePromise;
}

function lerpRow(row: number[], midi: number, notes: number[]): number {
  const x = Math.max(notes[0], Math.min(notes[notes.length - 1], midi)) - notes[0];
  const i = Math.floor(x);
  const j = Math.min(row.length - 1, i + 1);
  const f = x - i;
  return row[i] * (1 - f) + row[j] * f;
}

/** Loop-delay compensation measured for this exact note and hammer hardness. */
export function tuningCompensation(midi: number, hard: number): number {
  if (!table) return 5;
  const { hards, notes, comp } = table;
  const h = Math.max(hards[0], Math.min(hards[hards.length - 1], hard));
  let lo = 0;
  while (lo < hards.length - 2 && hards[lo + 1] < h) lo++;
  const hi = lo + 1;
  const f = (h - hards[lo]) / Math.max(1e-6, hards[hi] - hards[lo]);
  return lerpRow(comp[lo], midi, notes) * (1 - f) + lerpRow(comp[hi], midi, notes) * f;
}

/** The Faust parameter set for one struck note. */
export function pianoVoiceParams(midi: number, velocity: number, s: PianoSettings) {
  const gain = mapVelocity(velocity, s);
  const hard = Math.max(0, Math.min(1, s.hammer * 0.65 + gain * 0.45));
  return {
    freq: pianoFrequency(midi, s),
    gain,
    hard,
    params: {
      hammer: s.hammer,
      detune: s.unison,
      inharmonicity: s.inharmonicity,
      decay: s.sustain,
      coupling: s.coupling,
      board: s.soundboard,
      lid: s.lid,
      damper: s.damper,
      releaseNoise: s.releaseNoise,
      tuneComp: tuningCompensation(midi, hard),
    },
  };
}

/** Stereo image of the keyboard from the player's seat: bass left, treble right. */
export function pianoPan(midi: number, width: number): number {
  return 0.5 + ((midi - 60) / 48) * 0.42 * width;
}

export const PIANO_PATCH: Patch = {
  id: "phys.piano",
  name: "Modelled grand piano",
  family: "Physical model",
  source: "faust",
};
