import { clamp } from "../util";
import { mulberry32 } from "../music/composer";
import { PROGRESSIONS, getProgression } from "../music/theory";
import type { BehaviorProfile, GameRules, ScaleName, SessionSummary } from "../types";

export const DEFAULT_RULES: GameRules = {
  version: 1,
  bpm: 100,
  laneCount: 4,
  scale: "major",
  root: 57,
  progression: [0, 4, 5, 3],
  density: 0.7,
  windowScale: 1,
  tiltSensitivity: 1,
  instrument: "piano",
  swing: 0.1,
  source: ["DEFAULT baseline program"],
};

/** Recency-weighted profile of the player from the most recent sessions (newest first). */
export function buildProfile(history: SessionSummary[]): BehaviorProfile {
  if (history.length === 0) {
    return {
      sessions: 0,
      accuracy: 0.5,
      meanOffsetMs: 0,
      motionRatio: 0,
      avgCombo: 0,
      skill: 0.35,
    };
  }
  let wsum = 0;
  let acc = 0;
  let off = 0;
  let mot = 0;
  let combo = 0;
  history.forEach((h, i) => {
    const w = Math.pow(0.8, i);
    wsum += w;
    acc += w * h.accuracy;
    off += w * h.meanOffsetMs;
    mot += w * h.motionRatio;
    combo += w * h.maxCombo;
  });
  const accuracy = acc / wsum;
  const meanOffsetMs = off / wsum;
  const avgCombo = combo / wsum;
  const skill = clamp(
    0.55 * accuracy +
      0.25 * Math.min(1, avgCombo / 40) +
      0.2 * (1 - Math.min(1, Math.abs(meanOffsetMs) / 60)),
    0,
    1,
  );
  return {
    sessions: history.length,
    accuracy,
    meanOffsetMs,
    motionRatio: mot / wsum,
    avgCombo,
    skill,
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Generates the rule program for the next run. Each rule is a condition on
 * the profile plus a patch to the configuration; the fired rules are recorded
 * in `source` so the generated logic is always inspectable. A seeded
 * exploration step varies key, scale and progression between sessions.
 */
export function generateRules(p: BehaviorProfile): GameRules {
  const seed = Math.floor(p.skill * 1000) * 7919 + p.sessions * 104729 + Math.round(p.meanOffsetMs) * 31 + 17;
  const rnd = mulberry32(seed);
  const r: GameRules = { ...DEFAULT_RULES, progression: [...DEFAULT_RULES.progression] };
  const src: string[] = [
    `PROFILE skill=${p.skill.toFixed(2)} accuracy=${pct(p.accuracy)} offset=${p.meanOffsetMs.toFixed(0)}ms motion=${pct(p.motionRatio)} sessions=${p.sessions}`,
  ];

  const when = (cond: boolean, text: string, patch: () => void) => {
    if (!cond) return;
    patch();
    src.push(text);
  };

  when(p.accuracy < 0.55, "IF accuracy < 55% THEN windowScale = 1.35; density = 0.55", () => {
    r.windowScale = 1.35;
    r.density = 0.55;
  });
  when(p.accuracy >= 0.85, "IF accuracy >= 85% THEN windowScale = 0.8; density = 0.9", () => {
    r.windowScale = 0.8;
    r.density = 0.9;
  });
  when(
    p.accuracy >= 0.55 && p.accuracy < 0.85,
    "IF 55% <= accuracy < 85% THEN windowScale = 1.0; density = 0.7",
    () => {
      r.windowScale = 1;
      r.density = 0.7;
    },
  );
  when(p.meanOffsetMs < -18, "IF player rushes (offset < -18ms) THEN bpm -= 6; swing = 0.18", () => {
    r.bpm -= 6;
    r.swing = 0.18;
  });
  when(p.meanOffsetMs > 18, "IF player drags (offset > +18ms) THEN windowScale += 0.15; swing = 0", () => {
    r.windowScale += 0.15;
    r.swing = 0;
  });
  when(p.skill >= 0.7, "IF skill >= 0.70 THEN laneCount = 5; bpm += 10", () => {
    r.laneCount = 5;
    r.bpm += 10;
  });
  when(p.skill < 0.4, "IF skill < 0.40 THEN laneCount = 3; bpm -= 8", () => {
    r.laneCount = 3;
    r.bpm -= 8;
  });
  when(p.avgCombo >= 30, "IF avgCombo >= 30 THEN progression = ii · V · I · vi (jazz)", () => {
    r.progression = getProgression("jazz").degrees;
  });
  when(p.motionRatio >= 0.3, "IF motionRatio >= 30% THEN instrument = guitar; tiltSensitivity = 1.4", () => {
    r.instrument = "guitar";
    r.tiltSensitivity = 1.4;
  });

  // Autonomous exploration: seeded variation of key, scale and progression.
  const roots = [50, 52, 53, 55, 57, 58];
  const scales: ScaleName[] =
    p.skill >= 0.6 ? ["dorian", "minor", "blues", "pentatonic"] : ["major", "pentatonic", "minor"];
  r.root = roots[Math.floor(rnd() * roots.length)];
  r.scale = scales[Math.floor(rnd() * scales.length)];
  if (p.avgCombo < 30) {
    r.progression = [...PROGRESSIONS[Math.floor(rnd() * PROGRESSIONS.length)].degrees];
  }
  src.push(`EXPLORE seed=${seed} THEN root=${r.root} scale=${r.scale} progression=[${r.progression.join(",")}]`);

  r.bpm = clamp(Math.round(r.bpm), 70, 150);
  r.density = clamp(r.density, 0.2, 1);
  r.windowScale = clamp(r.windowScale, 0.6, 1.6);
  r.swing = clamp(r.swing, 0, 0.33);
  r.source = src;
  return r;
}
