import { composePattern } from "@/engine/music/composer";
import { chordAt } from "@/engine/music/theory";
import type { Instrument, NoteEvent, Pattern, Role, ScaleName } from "@/engine/types";

export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;

export interface StudioNote {
  step: number;
  midi: number;
  /** Length in steps (16th notes). */
  len: number;
  vel: number;
}

export interface SongTrack {
  id: string;
  name: string;
  inst: Instrument;
  role: Role;
  volume: number;
  muted: boolean;
  solo: boolean;
  color: string;
  notes: StudioNote[];
}

export interface Song {
  id: string;
  title: string;
  bpm: number;
  root: number;
  scale: ScaleName;
  bars: number;
  swing: number;
  tracks: SongTrack[];
  createdAt: number;
  updatedAt: number;
}

export interface DrumRow {
  midi: number;
  label: string;
  inst: Instrument;
}

export const DRUM_ROWS: DrumRow[] = [
  { midi: 46, label: "Open hat", inst: "hat" },
  { midi: 42, label: "Hi-hat", inst: "hat" },
  { midi: 39, label: "Clap", inst: "clap" },
  { midi: 38, label: "Snare", inst: "snare" },
  { midi: 36, label: "Kick", inst: "kick" },
];

export function drumInst(midi: number): Instrument {
  return DRUM_ROWS.find((r) => r.midi === midi)?.inst ?? "kick";
}

export const TRACK_COLORS = ["#ff7a29", "#35c9b0", "#f2c46d", "#ff4d6d", "#8b7bff", "#4fb3ff"];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newTrack(partial: Partial<SongTrack> & Pick<SongTrack, "name" | "inst" | "role">, index = 0): SongTrack {
  return {
    id: uid(),
    volume: 0.85,
    muted: false,
    solo: false,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    notes: [],
    ...partial,
  };
}

export function newSong(title = "Untitled song"): Song {
  const now = Date.now();
  return {
    id: uid(),
    title,
    bpm: 100,
    root: 48,
    scale: "major",
    bars: 4,
    swing: 0,
    tracks: [
      newTrack({ name: "Lead", inst: "piano", role: "melody" }, 0),
      newTrack({ name: "Chords", inst: "guitar", role: "chord" }, 1),
      newTrack({ name: "Bass", inst: "bass", role: "bass" }, 2),
      newTrack({ name: "Drums", inst: "kick", role: "drum" }, 3),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function isDrumTrack(t: SongTrack): boolean {
  return t.role === "drum";
}

/** Converts one track into transport events. */
export function trackEvents(song: Song, t: SongTrack): NoteEvent[] {
  return t.notes
    .filter((n) => n.step < song.bars * STEPS_PER_BAR)
    .map((n) => {
      const offBeat = n.step % 4 === 2;
      const beat = n.step / STEPS_PER_BEAT + (offBeat ? song.swing * 0.25 : 0);
      return {
        beat,
        midi: [n.midi],
        dur: n.len / STEPS_PER_BEAT,
        vel: Math.min(1, n.vel * t.volume),
        inst: isDrumTrack(t) ? drumInst(n.midi) : t.inst,
        role: t.role,
      };
    });
}

/** Full song as a single pattern, honouring mute and solo. */
export function songToPattern(song: Song): Pattern {
  const anySolo = song.tracks.some((t) => t.solo);
  const events = song.tracks
    .filter((t) => (anySolo ? t.solo : !t.muted))
    .flatMap((t) => trackEvents(song, t))
    .sort((a, b) => a.beat - b.beat);
  return { name: song.title, bpm: song.bpm, lengthBeats: song.bars * 4, events };
}

/** Pattern used by the arena: melody track becomes the chart. */
export function songToArenaPattern(song: Song): Pattern {
  return songToPattern({ ...song, tracks: song.tracks.map((t) => ({ ...t, muted: false, solo: false })) });
}

function findTrack(song: Song, role: Role): SongTrack | undefined {
  return song.tracks.find((t) => t.role === role);
}

/** Uses the generative composer to fill melody, chords, bass and drums. */
export function generateIntoSong(song: Song, opts: { seed: number; progression: number[]; density: number }): Song {
  const pat = composePattern({
    seed: opts.seed,
    bpm: song.bpm,
    root: song.root,
    scale: song.scale,
    bars: song.bars,
    instrument: "piano",
    progression: opts.progression,
    density: opts.density,
    swing: 0,
    drums: true,
  });
  const buckets: Record<Role, StudioNote[]> = { melody: [], chord: [], bass: [], drum: [] };
  for (const ev of pat.events) {
    const step = Math.round(ev.beat * STEPS_PER_BEAT);
    const len = Math.max(1, Math.round(ev.dur * STEPS_PER_BEAT));
    for (const m of ev.midi) buckets[ev.role].push({ step, midi: m, len, vel: ev.vel });
  }
  // Backbeat snare on beats 2 and 4.
  for (let bar = 0; bar < song.bars; bar++) {
    buckets.drum.push({ step: bar * 16 + 4, midi: 38, len: 1, vel: 0.8 });
    buckets.drum.push({ step: bar * 16 + 12, midi: 38, len: 1, vel: 0.85 });
  }
  const tracks = song.tracks.map((t) => {
    const first = findTrack(song, t.role);
    if (first?.id !== t.id) return t;
    return { ...t, notes: buckets[t.role] };
  });
  return { ...song, tracks, updatedAt: Date.now() };
}

/** Writes a chord progression (one chord per bar) into a track. */
export function progressionNotes(song: Song, degrees: number[], style: "block" | "strum" | "arp"): StudioNote[] {
  const out: StudioNote[] = [];
  for (let bar = 0; bar < song.bars; bar++) {
    const chord = chordAt(song.root, song.scale, degrees[bar % degrees.length] ?? 0);
    const base = bar * STEPS_PER_BAR;
    if (style === "block") {
      for (const m of chord) out.push({ step: base, midi: m, len: 16, vel: 0.6 });
    } else if (style === "strum") {
      for (const s of [0, 6, 8, 12]) for (const m of chord) out.push({ step: base + s, midi: m, len: s === 0 ? 6 : 2, vel: s === 0 ? 0.7 : 0.55 });
    } else {
      const arp = [chord[0], chord[1], chord[2], chord[0] + 12];
      for (let s = 0; s < 8; s++) out.push({ step: base + s * 2, midi: arp[s % 4], len: 2, vel: 0.55 });
    }
  }
  return out;
}

/** Converts a pattern from the composer or arena into song tracks (import). */
export function patternEventsToNotes(events: NoteEvent[]): StudioNote[] {
  return events.flatMap((ev) =>
    ev.midi.map((m) => ({
      step: Math.round(ev.beat * STEPS_PER_BEAT),
      midi: m,
      len: Math.max(1, Math.round(ev.dur * STEPS_PER_BEAT)),
      vel: ev.vel,
    })),
  );
}
