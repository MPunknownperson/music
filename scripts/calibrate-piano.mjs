/**
 * Calibrates the piano waveguide: the loop filters add a few samples of delay
 * that would otherwise flatten every note by a frequency-dependent amount.
 * We measure the real fundamental once per note/hammer setting and store the
 * exact delay compensation, so the model plays in tune across all 88 keys.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createFaustDsp } from "./dsp-core.generated.mjs";

const sr = 48000;
const bs = 128;
const meta = JSON.parse(await readFile("public/faust/piano.json", "utf8"));
const mod = new WebAssembly.Module(await readFile("public/faust/piano.wasm"));

function fundamental(freq, comp, hard, seconds) {
  const d = createFaustDsp(mod, meta, sr, bs);
  d.clear();
  d.set("freq", freq);
  d.set("gain", 0.2 + hard * 0.7);
  d.set("hammer", hard);
  d.set("tuneComp", comp);
  d.set("board", 0);
  d.set("coupling", 0.12);
  d.set("gate", 1);
  const n = Math.ceil((sr * seconds) / bs) * bs;
  const out = new Float32Array(n);
  for (let b = 0; b * bs < n; b++) {
    d.compute(bs);
    out.set(d.outs[0], b * bs);
  }
  const start = Math.floor(sr * Math.min(0.06, seconds * 0.2));
  const W = Math.min(12000, n - start - 1600);
  const maxLag = Math.min(2600, Math.floor((sr / freq) * 1.8));
  // Normalised autocorrelation: immune to the decay envelope and to the
  // shrinking overlap that would otherwise bias the peak toward short lags.
  const corr = (lag) => {
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = start; i < start + W; i++) {
      const x = out[i], y = out[i + lag];
      sxy += x * y; sxx += x * x; syy += y * y;
    }
    return sxy / Math.sqrt(Math.max(sxx * syy, 1e-20));
  };
  let bestLag = 0;
  let best = -Infinity;
  for (let lag = Math.max(4, Math.floor((sr / freq) * 0.6)); lag < maxLag; lag++) {
    const v = corr(lag);
    if (v > best) { best = v; bestLag = lag; }
  }
  if (best < 0.5) return freq; // unusable window, leave the estimate alone
  const y0 = corr(bestLag - 1), y1 = corr(bestLag), y2 = corr(bestLag + 1);
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  return sr / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
}

const hards = [0.2, 0.5, 0.8, 1.0];
const notes = [];
for (let midi = 21; midi <= 108; midi += 1) notes.push(midi);
const table = { sampleRate: sr, hards, notes, comp: [] };
let worst = 0;
const offenders = [];
for (const hard of hards) {
  const row = [];
  for (const midi of notes) {
    const target = 440 * Math.pow(2, (midi - 69) / 12);
    const seconds = midi < 45 ? 0.5 : 0.32;
    const guess = 5;
    const measured = fundamental(target, guess, hard, seconds);
    // extra loop delay is independent of the compensation, so one pass solves it
    let comp = guess + sr / measured - sr / target;
    comp = Math.max(0, Math.min(13, comp));
    const check = fundamental(target, comp, hard, seconds);
    let cents = 1200 * Math.log2(check / target);
    if (Math.abs(cents) > 120) { comp = 5; cents = 1200 * Math.log2(fundamental(target, comp, hard, seconds) / target); }
    worst = Math.max(worst, Math.abs(cents));
    if (Math.abs(cents) > 15) offenders.push(`m${midi}/h${hard}:${cents.toFixed(0)}c comp=${comp.toFixed(2)}`);
    row.push(Number(comp.toFixed(4)));
  }
  table.comp.push(row);
}
await writeFile("public/faust/piano-tuning.json", JSON.stringify(table));
console.log("offenders:", offenders.slice(0, 24).join(" "), offenders.length ? `(${offenders.length} total)` : "");
console.log(`piano tuning calibrated: ${notes.length} keys × ${hards.length} voicings, worst error ${worst.toFixed(1)} cents`);
