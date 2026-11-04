/** Renders the Faust models headlessly and checks they behave like real strings. */
import { readFile } from "node:fs/promises";
import { createFaustDsp } from "./dsp-core.generated.mjs";

const sr = 48000;
const bs = 128;
const meta = JSON.parse(await readFile("public/faust/string.json", "utf8"));
const mod = new WebAssembly.Module(await readFile("public/faust/string.wasm"));

function render(freq, seconds, releaseAt = Infinity) {
  const d = createFaustDsp(mod, meta, sr, bs);
  d.clear();
  d.set("freq", freq);
  d.set("gain", 0.9);
  d.set("brightness", 0.6);
  d.set("gate", 1);
  const out = new Float32Array(Math.ceil((sr * seconds) / bs) * bs);
  let crossings = 0;
  let prev = 0;
  const windows = [];
  for (let b = 0; b * bs < out.length; b++) {
    if (b * bs >= releaseAt * sr) d.set("gate", 0);
    d.compute(bs);
    const src = d.outs[0];
    for (let i = 0; i < bs; i++) {
      const s = src[i];
      out[b * bs + i] = s;
      if (prev <= 0 && s > 0) crossings++;
      prev = s;
    }
    if (b % 8 === 0) {
      let sum = 0;
      for (let i = 0; i < bs; i++) sum += src[i] * src[i];
      windows.push(Math.sqrt(sum / bs));
    }
  }
  let peak = 0;
  let nan = 0;
  for (const s of out) {
    peak = Math.max(peak, Math.abs(s));
    if (!Number.isFinite(s)) nan++;
  }
  // autocorrelation on a steady window gives the true fundamental
  const start = Math.floor(sr * 0.25);
  const W = 8000;
  let bestLag = 0;
  let best = -1;
  for (let lag = 16; lag < 600; lag++) {
    let s = 0;
    for (let i = start; i < start + W; i++) s += out[i] * out[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  void crossings;
  return { peak, nan, detected: sr / bestLag, windows };
}

const a220 = render(220, 2);
const a440 = render(440, 2);
const damped = render(220, 1.2, 0.4);
console.log("A3  peak", a220.peak.toFixed(4), "f0≈", a220.detected.toFixed(1), "Hz  nonfinite", a220.nan);
console.log("A4  peak", a440.peak.toFixed(4), "f0≈", a440.detected.toFixed(1), "Hz  nonfinite", a440.nan);
console.log("decay head/mid/tail", [0, 40, 90].map((i) => a220.windows[i]?.toFixed(5)).join(" → "));
console.log("released head/after", damped.windows[10].toFixed(5), "→", damped.windows[45].toFixed(6));

const bodyMeta = JSON.parse(await readFile("public/faust/body.json", "utf8"));
const bodyMod = new WebAssembly.Module(await readFile("public/faust/body.wasm"));
const body = createFaustDsp(bodyMod, bodyMeta, sr, bs);
body.set("mix", 0.5);
body.set("decay", 0.7);
let bodyPeak = 0;
let bodyTail = 0;
for (let b = 0; b < 400; b++) {
  for (let i = 0; i < bs; i++) {
    const imp = b === 0 && i === 0 ? 1 : 0;
    body.ins[0][i] = imp;
    body.ins[1][i] = imp;
  }
  body.compute(bs);
  for (let i = 0; i < bs; i++) {
    bodyPeak = Math.max(bodyPeak, Math.abs(body.outs[0][i]), Math.abs(body.outs[1][i]));
    if (b > 300) bodyTail = Math.max(bodyTail, Math.abs(body.outs[0][i]));
  }
}
console.log("body impulse peak", bodyPeak.toFixed(4), "tail", bodyTail.toFixed(6));

const ok =
  a220.peak > 0.02 && a220.nan === 0 && Math.abs(a220.detected - 220) < 4 &&
  Math.abs(a440.detected - 440) < 8 &&
  a220.windows[90] < a220.windows[0] &&
  damped.windows[45] < damped.windows[10] * 0.2 &&
  bodyPeak > 0.01 && bodyTail > 0;
console.log(ok ? "PASS: strings + body" : "FAIL: string model");
if (!ok) process.exit(1);
// ------------------------------------------------------------- piano model
const pMeta = JSON.parse(await readFile("public/faust/piano.json", "utf8"));
const pMod = new WebAssembly.Module(await readFile("public/faust/piano.wasm"));
const tuning = JSON.parse(await readFile("public/faust/piano-tuning.json", "utf8"));
function compFor(midi, hard) {
  const { hards, notes, comp } = tuning;
  const row = (r) => {
    const x = Math.max(0, Math.min(notes.length - 1, midi - notes[0]));
    const i = Math.floor(x), j = Math.min(r.length - 1, i + 1), f = x - i;
    return r[i] * (1 - f) + r[j] * f;
  };
  const h = Math.max(hards[0], Math.min(hards[hards.length - 1], hard));
  let lo = 0;
  while (lo < hards.length - 2 && hards[lo + 1] < h) lo++;
  const f = (h - hards[lo]) / (hards[lo + 1] - hards[lo]);
  return row(comp[lo]) * (1 - f) + row(comp[lo + 1]) * f;
}

function piano(freq, seconds, opts = {}) {
  const d = createFaustDsp(pMod, pMeta, sr, bs);
  d.clear();
  d.set("freq", freq);
  d.set("gain", opts.gain ?? 0.85);
  for (const k of ["hammer", "detune", "inharmonicity", "decay", "coupling", "board", "lid", "damper"]) {
    if (opts[k] !== undefined) d.set(k, opts[k]);
  }
  const gain = opts.gain ?? 0.85;
  const hard = Math.min(1, (opts.hammer ?? 0.5) * 0.65 + gain * 0.45);
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  d.set("tuneComp", compFor(midi, hard));
  d.set("gate", 1);
  const out = new Float32Array(Math.ceil((sr * seconds) / bs) * bs);
  const win = [];
  for (let b = 0; b * bs < out.length; b++) {
    if (b * bs >= (opts.releaseAt ?? Infinity) * sr) d.set("gate", 0);
    d.compute(bs);
    out.set(d.outs[0], b * bs);
    if (b % 10 === 0) {
      let s = 0;
      for (let i = 0; i < bs; i++) s += d.outs[0][i] * d.outs[0][i];
      win.push(Math.sqrt(s / bs));
    }
  }
  const start = Math.floor(sr * (opts.window ?? 0.3));
  const W = 6000;
  let bestLag = 0;
  let best = -1;
  for (let lag = 8; lag < 900; lag++) {
    let s = 0;
    for (let i = start; i < start + W; i++) s += out[i] * out[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  let peak = 0;
  let bad = 0;
  for (const s of out) { peak = Math.max(peak, Math.abs(s)); if (!Number.isFinite(s)) bad++; }
  // spectral centroid of a steady window
  const goertzel = (f) => {
    let s1 = 0, s2 = 0;
    const w = 2 * Math.cos((2 * Math.PI * f) / sr);
    for (let i = start; i < start + W; i++) { const s = out[i] + w * s1 - s2; s2 = s1; s1 = s; }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - s1 * s2 * w)) / W;
  };
  const h = [1, 2, 3, 4, 5, 6].map((n) => goertzel(freq * n));
  return { peak, bad, f0: sr / bestLag, win, harmonics: h };
}

const soft = piano(220, 2.5, { gain: 0.3, hammer: 0.2 });
const loud = piano(220, 2.5, { gain: 1.0, hammer: 0.9 });
const bass = piano(65.4, 3, {});
const treble = piano(1046.5, 2, {});
const pDamped = piano(220, 2, { releaseAt: 0.5 });
const brightSum = (r) => r.harmonics.slice(1).reduce((s, v) => s + v, 0) / Math.max(r.harmonics[0], 1e-9);

console.log("piano A3 soft   peak", soft.peak.toFixed(3), "f0", soft.f0.toFixed(1), "brightness", brightSum(soft).toFixed(2));
console.log("piano A3 loud   peak", loud.peak.toFixed(3), "f0", loud.f0.toFixed(1), "brightness", brightSum(loud).toFixed(2));
console.log("piano C2        peak", bass.peak.toFixed(3), "f0", bass.f0.toFixed(1));
console.log("piano C6        peak", treble.peak.toFixed(3), "f0", treble.f0.toFixed(1));
const wi = (t) => Math.min(soft.win.length - 1, Math.round((t * sr) / (bs * 10)));
console.log("piano sustain   0.05s", soft.win[wi(0.05)].toFixed(4), "1.0s", soft.win[wi(1)].toFixed(4), "2.4s", soft.win[wi(2.4)].toFixed(5));
const di = (t) => Math.min(pDamped.win.length - 1, Math.round((t * sr) / (bs * 10)));
console.log("piano damped    0.45s", pDamped.win[di(0.45)].toFixed(4), "→ 1.2s", pDamped.win[di(1.2)].toFixed(6));

const pianoOk =
  soft.bad === 0 && loud.bad === 0 &&
  soft.peak > 0.01 && loud.peak > soft.peak &&
  Math.abs(soft.f0 - 220) < 5 && Math.abs(bass.f0 - 65.4) < 2 && Math.abs(treble.f0 - 1046.5) < 12 &&
  brightSum(loud) > brightSum(soft) * 1.15 &&
  soft.win[wi(2.4)] < soft.win[wi(0.05)] * 0.75 && soft.win[wi(2.4)] > 0.00002 &&
  pDamped.win[di(1.2)] < pDamped.win[di(0.45)] * 0.05;
console.log(pianoOk ? "PASS: piano is pitched, velocity-bright, two-stage decaying and pDamped." : "FAIL: piano model");
process.exit(pianoOk ? 0 : 1);
