import { CHORD_QUALITIES, NOTE_NAMES, pitchClass } from "@/engine/music/theory";

/** Names the chord formed by a set of MIDI notes, e.g. "Am7", "C/E". */
export function detectChord(midis: number[]): string | null {
  if (midis.length === 0) return null;
  const sorted = [...midis].sort((a, b) => a - b);
  const bass = pitchClass(sorted[0]);
  const pcs = Array.from(new Set(sorted.map(pitchClass)));
  if (pcs.length === 1) return NOTE_NAMES[pcs[0]];
  if (pcs.length === 2) {
    const iv = pitchClass(pcs[1] - pcs[0]);
    if (iv === 7 || iv === 5) return `${NOTE_NAMES[iv === 7 ? pcs[0] : pcs[1]]}5`;
  }
  let best: { name: string; score: number } | null = null;
  for (const root of pcs) {
    for (const q of CHORD_QUALITIES) {
      const qpcs = q.intervals.map((iv) => pitchClass(root + iv));
      const set = new Set(qpcs);
      if (!pcs.every((p) => set.has(p))) continue;
      const missing = qpcs.filter((p) => !pcs.includes(p)).length;
      if (missing > 1) continue;
      const score = 10 - missing * 4 - q.intervals.length + (root === bass ? 3 : 0);
      const slash = root !== bass ? `/${NOTE_NAMES[bass]}` : "";
      const name = `${NOTE_NAMES[root]}${q.symbol}${slash}`;
      if (!best || score > best.score) best = { name, score };
    }
  }
  return best?.name ?? null;
}
