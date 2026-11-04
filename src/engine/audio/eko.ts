/** EBU R128 / ITU-R BS.1770 loudness measurement, normalisation and gapless scheduling. */

/** K-weighting filter coefficients (BS.1770-4) for a given sample rate. */
function kWeighting(ctx: BaseAudioContext, input: AudioNode, output: AudioNode) {
  const fs = ctx.sampleRate;
  // Stage 1: shelving filter (+4 dB head model)
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf = ctx.createBiquadFilter();
  shelf.type = "peaking";
  // Implemented as an exact biquad through an IIRFilterNode when available.
  const b = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0];
  const a = [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // Stage 2: high pass
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / fs);
  const b2 = [1, -2, 1];
  const a2 = [1, (2 * (K1 * K1 - 1)) / (1 + K1 / Q1 + K1 * K1), (1 - K1 / Q1 + K1 * K1) / (1 + K1 / Q1 + K1 * K1)];
  const IIR = (ctx as unknown as { createIIRFilter?: (f: number[], fb: number[]) => IIRFilterNode }).createIIRFilter;
  if (IIR) {
    const s1 = IIR.call(ctx, b, a);
    const s2 = IIR.call(ctx, b2, a2);
    input.connect(s1);
    s1.connect(s2);
    s2.connect(output);
  } else {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = f1;
    input.connect(shelf);
    shelf.connect(hp);
    hp.connect(output);
  }
}

export interface LoudnessInfo {
  /** Integrated loudness in LUFS. */
  lufs: number;
  /** Sample peak in dBFS. */
  peakDb: number;
  /** True-peak estimate (4x oversampled) in dBTP. */
  truePeakDb: number;
}

/** Offline K-weighted loudness analysis of a rendered buffer. */
export async function measureLoudness(buffer: AudioBuffer): Promise<LoudnessInfo> {
  const OfflineCtor =
    (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  // 4x oversampled true-peak estimate via linear interpolation of neighbours.
  let truePeak = peak;
  const ch = buffer.getChannelData(0);
  for (let i = 1; i < ch.length; i++) {
    for (let k = 1; k < 4; k++) {
      const v = Math.abs(ch[i - 1] + ((ch[i] - ch[i - 1]) * k) / 4);
      if (v > truePeak) truePeak = v;
    }
  }
  if (!OfflineCtor || peak === 0) {
    return { lufs: -Infinity, peakDb: -Infinity, truePeakDb: -Infinity };
  }
  const off = new OfflineCtor(1, buffer.length, buffer.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const sink = off.createGain();
  kWeighting(off, src, sink);
  sink.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const d = rendered.getChannelData(0);
  // 400 ms blocks, 75% overlap, gated at -70 LUFS then -10 LU relative.
  const blockLen = Math.floor(buffer.sampleRate * 0.4);
  const step = Math.max(1, Math.floor(blockLen / 4));
  const blocks: number[] = [];
  for (let i = 0; i + blockLen <= d.length; i += step) {
    let sum = 0;
    for (let j = 0; j < blockLen; j++) sum += d[i + j] * d[i + j];
    blocks.push(sum / blockLen);
  }
  const toLufs = (ms: number) => -0.691 + 10 * Math.log10(Math.max(ms, 1e-12));
  const absolute = blocks.filter((ms) => toLufs(ms) > -70);
  if (absolute.length === 0) return { lufs: -Infinity, peakDb: -Infinity, truePeakDb: -Infinity };
  const meanAbs = absolute.reduce((s, v) => s + v, 0) / absolute.length;
  const relGate = toLufs(meanAbs) - 10;
  const gated = absolute.filter((ms) => toLufs(ms) > relGate);
  const mean = gated.reduce((s, v) => s + v, 0) / Math.max(1, gated.length);
  return {
    lufs: toLufs(mean),
    peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
    truePeakDb: 20 * Math.log10(Math.max(truePeak, 1e-9)),
  };
}

/** Normalises in place to a target loudness with a true-peak ceiling. */
export async function normalizeLoudness(buffer: AudioBuffer, targetLufs = -14, ceilingDb = -1): Promise<LoudnessInfo> {
  const info = await measureLoudness(buffer);
  if (!Number.isFinite(info.lufs)) return info;
  let gain = Math.pow(10, (targetLufs - info.lufs) / 20);
  const ceiling = Math.pow(10, ceilingDb / 20);
  if (info.truePeakDb > -60) {
    const maxGain = ceiling / Math.pow(10, info.truePeakDb / 20);
    gain = Math.min(gain, maxGain);
  }
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      // Soft ceiling instead of hard clipping when the target pushes peaks up.
      const v = d[i] * gain;
      d[i] = Math.abs(v) > ceiling ? Math.sign(v) * (ceiling + (1 - Math.exp(-(Math.abs(v) - ceiling) * 4)) * (1 - ceiling)) : v;
    }
  }
  return measureLoudness(buffer);
}

/** 16-bit/24-bit WAV encoding used to hand rendered audio to Howler. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const chs = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const view = new DataView(new ArrayBuffer(44 + len * chs * 2));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + len * chs * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, chs, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * chs * 2, true);
  view.setUint16(32, chs * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, len * chs * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/**
 * Gapless chain player: schedules successive buffers on the audio clock with
 * sample-accurate start times and an equal-power crossfade, so a loop or a
 * chord progression never clicks or drops a sample at the seam.
 */
export class GaplessChain {
  private ctx: AudioContext;
  private out: GainNode;
  private nextTime = 0;
  private sources: { src: AudioBufferSourceNode; gain: GainNode; end: number }[] = [];
  private timer: number | null = null;
  private queue: { buffer: AudioBuffer; loop: boolean }[] = [];
  private onAdvance?: (index: number) => void;
  private index = 0;
  playing = false;

  constructor(ctx: AudioContext, out: GainNode, private crossfade = 0.02) {
    this.ctx = ctx;
    this.out = out;
  }

  setCrossfade(seconds: number) {
    this.crossfade = Math.max(0, seconds);
  }

  setOnAdvance(fn: (index: number) => void) {
    this.onAdvance = fn;
  }

  push(buffer: AudioBuffer, loop = false) {
    this.queue.push({ buffer, loop });
    if (this.playing) this.fill();
  }

  clearQueue() {
    this.queue = [];
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.index = 0;
    this.fill();
    this.timer = window.setInterval(() => this.fill(), 60);
  }

  private fill() {
    const horizon = this.ctx.currentTime + 0.5;
    let guard = 0;
    while (this.nextTime < horizon && this.queue.length > 0 && guard++ < 16) {
      const item = this.queue[0];
      if (!item.loop) this.queue.shift();
      const src = this.ctx.createBufferSource();
      src.buffer = item.buffer;
      const gain = this.ctx.createGain();
      const start = Math.max(this.nextTime, this.ctx.currentTime);
      const xf = Math.min(this.crossfade, item.buffer.duration / 4);
      gain.gain.setValueAtTime(this.index === 0 ? 1 : 0, start);
      if (this.index > 0 && xf > 0) {
        // equal-power fade-in against the tail of the previous buffer
        const steps = 16;
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) curve[i] = Math.sin(((i / (steps - 1)) * Math.PI) / 2);
        gain.gain.setValueCurveAtTime(curve, start, xf);
      }
      src.connect(gain);
      gain.connect(this.out);
      src.start(start);
      const end = start + item.buffer.duration;
      this.sources.push({ src, gain, end });
      this.nextTime = end - xf;
      const idx = this.index++;
      if (this.onAdvance) {
        const delay = Math.max(0, (start - this.ctx.currentTime) * 1000);
        window.setTimeout(() => this.playing && this.onAdvance?.(idx), delay);
      }
      if (item.loop && this.queue.length > 1) break;
    }
    this.sources = this.sources.filter((s) => {
      if (s.end < this.ctx.currentTime - 0.2) {
        try {
          s.src.stop();
        } catch {
          /* already finished */
        }
        s.src.disconnect();
        s.gain.disconnect();
        return false;
      }
      return true;
    });
  }

  stop(fade = 0.05) {
    this.playing = false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    for (const s of this.sources) {
      s.gain.gain.cancelScheduledValues(t);
      s.gain.gain.setValueAtTime(s.gain.gain.value, t);
      s.gain.gain.linearRampToValueAtTime(0, t + fade);
      try {
        s.src.stop(t + fade + 0.02);
      } catch {
        /* ignore */
      }
    }
    this.sources = [];
    this.queue = [];
  }
}
