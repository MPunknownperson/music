import type { Instrument } from "../types";

export const GM_NAMES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet", "Celesta", "Glockenspiel",
  "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer", "Drawbar Organ",
  "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica",
  "Tango Accordion", "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar", "Muted Guitar",
  "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics", "Acoustic Bass", "Finger Bass",
  "Pick Bass", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp",
  "Timpani", "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
  "Choir Aahs", "Voice Oohs", "Synth Choir", "Orchestra Hit", "Trumpet", "Trombone", "Tuba",
  "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2", "Soprano Sax",
  "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet", "Piccolo",
  "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Square Lead", "Saw Lead", "Calliope Lead", "Chiff Lead", "Charang Lead", "Voice Lead",
  "Fifths Lead", "Bass + Lead", "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad",
  "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad", "Rain FX", "Soundtrack FX", "Crystal FX",
  "Atmosphere FX", "Brightness FX", "Goblins FX", "Echoes FX", "Sci-Fi FX", "Sitar", "Banjo",
  "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai", "Tinkle Bell", "Agogo",
  "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter",
  "Applause", "Gunshot",
];

/** Programs shipped inside /public/soundfonts (everything else streams on demand). */
export const LOCAL_PROGRAMS = new Set([
  0, 1, 4, 5, 6, 11, 12, 16, 19, 24, 25, 26, 27, 29, 32, 33, 34, 40, 42, 46, 48, 52, 56, 65, 73, 89,
]);

export const GM_FAMILIES: { name: string; from: number; to: number }[] = [
  { name: "Piano & keys", from: 0, to: 7 },
  { name: "Chromatic percussion", from: 8, to: 15 },
  { name: "Organ & accordion", from: 16, to: 23 },
  { name: "Guitar", from: 24, to: 31 },
  { name: "Bass", from: 32, to: 39 },
  { name: "Strings", from: 40, to: 47 },
  { name: "Ensemble & choir", from: 48, to: 55 },
  { name: "Brass", from: 56, to: 63 },
  { name: "Reeds & pipes", from: 64, to: 79 },
  { name: "Synth leads", from: 80, to: 87 },
  { name: "Synth pads", from: 88, to: 95 },
  { name: "Ethnic & percussion", from: 104, to: 119 },
];

export type PatchSource = "sample" | "faust" | "synth";

export interface Patch {
  id: string;
  name: string;
  family: string;
  source: PatchSource;
  /** General MIDI program for sampled patches. */
  program?: number;
  /** Faust string model parameters. */
  model?: Partial<{
    brightness: number;
    damping: number;
    stiffness: number;
    bodyMix: number;
    pluckPos: number;
    gain: number;
    release: number;
    octave: number;
  }>;
  /** Built-in synth recipe. */
  synth?: "saw" | "square" | "fm" | "pad" | "pluck" | "bell";
}

export const PHYSICAL_PATCHES: Patch[] = [
  { id: "phys.steel", name: "Steel-string acoustic", family: "Physical model", source: "faust",
    model: { brightness: 0.62, damping: 0.3, stiffness: 0.3, bodyMix: 0.6, pluckPos: 0.16 } },
  { id: "phys.nylon", name: "Nylon classical", family: "Physical model", source: "faust",
    model: { brightness: 0.34, damping: 0.42, stiffness: 0.1, bodyMix: 0.7, pluckPos: 0.24 } },
  { id: "phys.electric", name: "Clean electric", family: "Physical model", source: "faust",
    model: { brightness: 0.72, damping: 0.18, stiffness: 0.42, bodyMix: 0.16, pluckPos: 0.11 } },
  { id: "phys.harp", name: "Concert harp", family: "Physical model", source: "faust",
    model: { brightness: 0.5, damping: 0.12, stiffness: 0.08, bodyMix: 0.5, pluckPos: 0.32 } },
  { id: "phys.bass", name: "Upright / electric bass", family: "Physical model", source: "faust",
    model: { brightness: 0.28, damping: 0.3, stiffness: 0.18, bodyMix: 0.55, pluckPos: 0.2, octave: -12 } },
  { id: "phys.koto", name: "Koto / zither", family: "Physical model", source: "faust",
    model: { brightness: 0.8, damping: 0.22, stiffness: 0.62, bodyMix: 0.42, pluckPos: 0.08 } },
];

export const SYNTH_PATCHES: Patch[] = [
  { id: "syn.saw", name: "Analog saw lead", family: "Synth", source: "synth", synth: "saw" },
  { id: "syn.square", name: "Hollow square", family: "Synth", source: "synth", synth: "square" },
  { id: "syn.fm", name: "FM electric piano", family: "Synth", source: "synth", synth: "fm" },
  { id: "syn.pad", name: "Wide string pad", family: "Synth", source: "synth", synth: "pad" },
  { id: "syn.pluck", name: "Poly pluck", family: "Synth", source: "synth", synth: "pluck" },
  { id: "syn.bell", name: "Glass bell", family: "Synth", source: "synth", synth: "bell" },
];

export function samplePatch(program: number): Patch {
  return {
    id: `gm.${program}`,
    name: GM_NAMES[program] ?? `Program ${program}`,
    family: GM_FAMILIES.find((f) => program >= f.from && program <= f.to)?.name ?? "SoundFont",
    source: "sample",
    program,
  };
}

export const ALL_PATCHES: Patch[] = [...PHYSICAL_PATCHES, ...SYNTH_PATCHES];

export function findPatch(id: string): Patch {
  const built = ALL_PATCHES.find((p) => p.id === id);
  if (built) return built;
  const m = /^gm\.(\d+)$/.exec(id);
  if (m) return samplePatch(Math.max(0, Math.min(127, Number(m[1]))));
  return PHYSICAL_PATCHES[0];
}

export const DEFAULT_PATCHES: Record<Instrument, string> = {
  piano: "gm.0",
  epiano: "gm.4",
  guitar: "phys.steel",
  bass: "phys.bass",
  synth: "syn.saw",
  strings: "gm.48",
  kick: "drum",
  snare: "drum",
  hat: "drum",
  clap: "drum",
};

export const DRUM_NAMES: Record<number, string> = {
  35: "Acoustic kick", 36: "Kick", 37: "Side stick", 38: "Snare", 39: "Clap", 40: "Snare rim",
  41: "Low tom", 42: "Closed hat", 43: "High tom", 44: "Pedal hat", 45: "Mid tom", 46: "Open hat",
  47: "Low-mid tom", 48: "Hi-mid tom", 49: "Crash", 50: "High tom", 51: "Ride", 52: "China",
  53: "Ride bell", 54: "Tambourine", 56: "Cowbell",
};
