import { clamp } from "../util";

export interface Built {
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  rel: number;
  natural: number;
}

export type SynthKind = "saw" | "square" | "fm" | "pad" | "pluck" | "bell" | "piano";

function out(ctx: BaseAudioContext, dest: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = 1;
  g.connect(dest);
  return g;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const key = "__noise";
  const cache = ctx as unknown as Record<string, AudioBuffer | undefined>;
  if (cache[key]) return cache[key]!;
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  cache[key] = buf;
  return buf;
}

function burst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  dur: number,
  amp: number,
  freq: number,
  type: BiquadFilterType,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(amp, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 0.8, dur + 0.02);
  src.stop(t + dur + 0.03);
  return src;
}

/** Additive piano used when SoundFonts are unavailable (offline, blocked CDN). */
export function pianoFallback(ctx: BaseAudioContext, dest: AudioNode, f: number, t: number, vel: number): Built {
  const o = out(ctx, dest);
  const decay = clamp(3.8 * Math.pow(262 / f, 0.4), 0.7, 7);
  const peak = 0.24 * vel;
  const bright = 0.5 + vel * 0.8;
  const partials: [number, number, number][] = [
    [1, 1, 1], [2, 0.3 * bright, 2], [3, 0.13 * bright, 3], [4, 0.07 * bright, 4], [5, 0.03 * bright, 5],
  ];
  const sources: AudioScheduledSourceNode[] = [];
  for (const [mult, amp, dfac] of partials) {
    if (f * mult > 16000) continue;
    for (const det of mult === 1 ? [-2.5, 2.5] : [0]) {
      const osc = ctx.createOscillator();
      osc.type = mult === 1 ? "triangle" : "sine";
      osc.frequency.value = f * mult * (1 + 0.0004 * mult * mult);
      osc.detune.value = det;
      const g = ctx.createGain();
      const a = peak * amp * (det === 0 ? 1 : 0.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(a, t + 0.004);
      g.gain.setTargetAtTime(0.0001, t + 0.004, decay / (4 * dfac));
      osc.connect(g);
      g.connect(o);
      osc.start(t);
      osc.stop(t + decay * 1.3 + 0.1);
      sources.push(osc);
    }
  }
  sources.push(burst(ctx, o, t, 0.02, 0.08 * vel, Math.min(f * 6, 6000), "bandpass"));
  return { out: o, sources, rel: 0.13, natural: decay * 1.3 };
}

export function synthVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  kind: SynthKind,
  f: number,
  t: number,
  vel: number,
): Built {
  if (kind === "piano") return pianoFallback(ctx, dest, f, t, vel);
  const o = out(ctx, dest);
  const sources: AudioScheduledSourceNode[] = [];

  if (kind === "fm" || kind === "bell") {
    const ratio = kind === "bell" ? 3.5 : 1;
    const decay = kind === "bell" ? 3.2 : clamp(2.8 * Math.pow(262 / f, 0.3), 0.8, 4);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * (kind === "bell" ? 4 : 1.6 + vel * 2.6), t);
    mg.gain.setTargetAtTime(f * 0.2, t, 0.16);
    mod.connect(mg);
    mg.connect(car.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.22 * vel, t + 0.005);
    env.gain.setTargetAtTime(0.0001, t + 0.005, decay / 4);
    car.connect(env);
    env.connect(o);
    for (const n of [car, mod]) {
      n.start(t);
      n.stop(t + decay * 1.2 + 0.1);
      sources.push(n);
    }
    return { out: o, sources, rel: 0.12, natural: decay * 1.2 };
  }

  const pad = kind === "pad";
  const pluck = kind === "pluck";
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = pad ? 0.7 : pluck ? 6 : 4;
  if (pad) lp.frequency.value = 2400;
  else {
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.linearRampToValueAtTime(clamp(f * 10 * (0.5 + vel), 700, 13000), t + (pluck ? 0.006 : 0.03));
    lp.frequency.setTargetAtTime(f * (pluck ? 1.6 : 3), t + 0.03, pluck ? 0.12 : 0.3);
  }
  const env = ctx.createGain();
  const attack = pad ? 0.4 : 0.006;
  const level = (pad ? 0.07 : 0.12) * vel;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(level, t + attack);
  if (pluck) env.gain.setTargetAtTime(0.0001, t + attack, 0.35);
  else env.gain.setTargetAtTime(level * (pad ? 0.85 : 0.62), t + attack, 0.3);
  lp.connect(env);
  env.connect(o);
  const detunes = pad ? [-13, -5, 4, 12] : [-7, 7];
  for (const dt of detunes) {
    const osc = ctx.createOscillator();
    osc.type = kind === "square" ? "square" : "sawtooth";
    osc.frequency.value = f;
    osc.detune.value = dt;
    osc.connect(lp);
    osc.start(t);
    sources.push(osc);
  }
  if (pad) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.8;
    const lg = ctx.createGain();
    lg.gain.value = 5;
    lfo.connect(lg);
    for (const s of sources) lg.connect((s as OscillatorNode).detune);
    lfo.start(t);
    sources.push(lfo);
  }
  return { out: o, sources, rel: pad ? 0.6 : 0.14, natural: pad ? Infinity : pluck ? 2.2 : Infinity };
}

/** Karplus–Strong fallback for browsers without AudioWorklet. */
export function ksFallback(
  ctx: BaseAudioContext,
  dest: AudioNode,
  f: number,
  t: number,
  vel: number,
  bass = false,
): Built {
  const o = out(ctx, dest);
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / f));
  const t60 = bass ? clamp(3.4 * Math.pow(82 / f, 0.3), 1.4, 4) : clamp(3.2 * Math.pow(110 / f, 0.55), 0.8, 4);
  const len = Math.floor(sr * Math.min(t60 * 1.1, 4));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const ring = new Float32Array(period);
  let lp = 0;
  const bright = bass ? 0.25 : 0.62;
  for (let i = 0; i < period; i++) {
    lp += bright * (Math.random() * 2 - 1 - lp);
    ring[i] = lp;
  }
  const mean = ring.reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period; i++) ring[i] -= mean;
  const loss = Math.pow(0.001, 1 / (f * t60));
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % period];
    ring[idx] = loss * (0.5 * cur + 0.5 * nxt);
    d[i] = cur;
    idx = (idx + 1) % period;
  }
  let peak = 0;
  for (let i = 0; i < Math.min(len, period * 4); i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = (period * f) / sr;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = bass ? 900 + vel * 1400 : 2600 + vel * 6000;
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = bass ? 120 : 205;
  body.gain.value = 4;
  const g = ctx.createGain();
  g.gain.value = (bass ? 0.4 : 0.3) * vel;
  src.connect(tone);
  tone.connect(body);
  body.connect(g);
  g.connect(o);
  src.start(t);
  return { out: o, sources: [src], rel: 0.08, natural: buf.duration };
}

export function drumVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  t: number,
  vel: number,
): Built {
  const o = out(ctx, dest);
  const sources: AudioScheduledSourceNode[] = [];
  if (midi === 36 || midi === 35) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(168, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.95, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(g);
    g.connect(o);
    osc.start(t);
    osc.stop(t + 0.36);
    sources.push(osc, burst(ctx, o, t, 0.008, 0.25 * vel, 2800, "bandpass"));
    return { out: o, sources, rel: 0.05, natural: 0.36 };
  }
  if (midi === 38 || midi === 40 || midi === 37) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(midi === 37 ? 420 : 225, t);
    osc.frequency.exponentialRampToValueAtTime(midi === 37 ? 300 : 145, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.34 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g);
    g.connect(o);
    osc.start(t);
    osc.stop(t + 0.14);
    sources.push(osc, burst(ctx, o, t, midi === 37 ? 0.05 : 0.2, 0.4 * vel, 2400, "highpass"));
    return { out: o, sources, rel: 0.05, natural: 0.25 };
  }
  if (midi === 39) {
    [0, 0.011, 0.023].forEach((off, i) => {
      sources.push(burst(ctx, o, t + off, i === 2 ? 0.19 : 0.03, 0.34 * vel, 1500, "bandpass"));
    });
    return { out: o, sources, rel: 0.05, natural: 0.26 };
  }
  if (midi === 46 || midi === 44) {
    sources.push(burst(ctx, o, t, midi === 46 ? 0.36 : 0.09, 0.2 * vel, 8200, "highpass"));
    return { out: o, sources, rel: 0.03, natural: 0.4 };
  }
  if (midi >= 49) {
    sources.push(burst(ctx, o, t, 1.4, 0.16 * vel, 6500, "highpass"));
    return { out: o, sources, rel: 0.1, natural: 1.5 };
  }
  if (midi >= 41 && midi <= 50) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const f = 150 + (50 - midi) * 22;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g);
    g.connect(o);
    osc.start(t);
    osc.stop(t + 0.32);
    sources.push(osc, burst(ctx, o, t, 0.02, 0.1 * vel, 3000, "bandpass"));
    return { out: o, sources, rel: 0.05, natural: 0.32 };
  }
  sources.push(burst(ctx, o, t, 0.05, 0.2 * vel, 8000, "highpass"));
  return { out: o, sources, rel: 0.03, natural: 0.08 };
}
