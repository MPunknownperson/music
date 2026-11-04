"use client";

import { masterOutput } from "./context";

/**
 * Web Audio DAW mixing desk: channel buses, insert effects (Tuna, the effect
 * suite shipped with Web Audio DAW), a convolution room, a Faust body send,
 * mid/side width, glue compression and a true-peak limiter.
 */

type TunaNode = AudioNode & { input?: AudioNode; output?: AudioNode };
interface TunaFactory {
  Chorus: new (o: Record<string, number>) => TunaNode;
  Overdrive: new (o: Record<string, number>) => TunaNode;
  Compressor: new (o: Record<string, number>) => TunaNode;
  Cabinet: new (o: Record<string, number>) => TunaNode;
  Tremolo: new (o: Record<string, number>) => TunaNode;
  Phaser: new (o: Record<string, number>) => TunaNode;
  Bitcrusher: new (o: Record<string, number>) => TunaNode;
  Filter: new (o: Record<string, number>) => TunaNode;
}

const inp = (n: AudioNode) => (n as TunaNode).input ?? n;
const outp = (n: AudioNode) => (n as TunaNode).output ?? n;

export interface MasterSettings {
  volume: number;
  reverb: number;
  roomSize: number;
  body: number;
  delay: number;
  delayTime: number;
  chorus: number;
  drive: number;
  bass: number;
  treble: number;
  width: number;
  glue: number;
  limiter: boolean;
  tuning: number;
}

export const DEFAULT_MASTER: MasterSettings = {
  volume: 0.82,
  reverb: 0.16,
  roomSize: 0.42,
  body: 0.2,
  delay: 0,
  delayTime: 0.28,
  chorus: 0,
  drive: 0,
  bass: 0,
  treble: 0,
  width: 0.6,
  glue: 0.18,
  limiter: true,
  tuning: 440,
};

/** Natural-sounding impulse response with early reflections and a diffuse tail. */
function makeIR(ctx: BaseAudioContext, size: number): AudioBuffer {
  const seconds = 0.5 + size * 3.2;
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, 2.2 + size * 1.6);
      const n = Math.random() * 2 - 1;
      lp += 0.34 * (n - lp); // darker tail than the early field
      d[i] = (n * 0.35 + lp * 0.9) * env;
    }
    // Discrete early reflections give the room a believable size.
    const taps = [0.011, 0.019, 0.031, 0.047, 0.061, 0.089, 0.113];
    taps.forEach((t, k) => {
      const idx = Math.floor((t + c * 0.003) * (0.6 + size) * ctx.sampleRate);
      if (idx < len) d[idx] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.78, k);
    });
  }
  return buf;
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k <= 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export interface ChannelStrip {
  input: GainNode;
  tone: BiquadFilterNode;
  pan: StereoPannerNode;
  gain: GainNode;
  sendReverb: GainNode;
  sendBody: GainNode;
  sendDelay: GainNode;
  ampDrive: TunaNode | null;
  ampCab: TunaNode | null;
  ampWet: GainNode;
  ampDry: GainNode;
}

export class Daw {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly muteGain: GainNode;
  readonly analyser: AnalyserNode;
  readonly meterAnalyser: AnalyserNode;
  private settings: MasterSettings = { ...DEFAULT_MASTER };
  private tuna: TunaFactory | null = null;

  private preMix: GainNode;
  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;
  private shaper: WaveShaperNode;
  private driveMix: GainNode;
  private dryMix: GainNode;
  private glueComp: DynamicsCompressorNode;
  private expression: BiquadFilterNode;
  private limiter: DynamicsCompressorNode;
  private limiterBypass: GainNode;
  private limiterPath: GainNode;
  private midGain: GainNode;
  private sideGain: GainNode;
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private msEncode: GainNode;
  private convolver: ConvolverNode;
  private reverbReturn: GainNode;
  private bodyReturn: GainNode;
  readonly bodySendBus: GainNode;
  private chorusNode: TunaNode | null = null;
  private chorusWet: GainNode;
  private delayNode: DelayNode | null = null;
  private delayInput: GainNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayReturn: GainNode;
  private channels = new Map<string, ChannelStrip>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const c = ctx;
    this.master = c.createGain();
    this.master.gain.value = this.settings.volume;
    this.muteGain = c.createGain();
    this.muteGain.gain.value = 1;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    this.meterAnalyser = c.createAnalyser();
    this.meterAnalyser.fftSize = 1024;

    this.preMix = c.createGain();
    this.low = c.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 180;
    this.mid = c.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.frequency.value = 900;
    this.mid.Q.value = 0.8;
    this.high = c.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 4200;

    this.shaper = c.createWaveShaper();
    this.shaper.oversample = "4x";
    this.shaper.curve = driveCurve(this.settings.drive);
    this.driveMix = c.createGain();
    this.dryMix = c.createGain();
    this.glueComp = c.createDynamicsCompressor();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1.2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.08;
    this.limiterPath = c.createGain();
    this.limiterBypass = c.createGain();

    this.splitter = c.createChannelSplitter(2);
    this.merger = c.createChannelMerger(2);
    this.midGain = c.createGain();
    this.sideGain = c.createGain();
    this.msEncode = c.createGain();

    this.convolver = c.createConvolver();
    this.convolver.buffer = makeIR(c, this.settings.roomSize);
    this.reverbReturn = c.createGain();
    this.reverbReturn.gain.value = this.settings.reverb;
    this.bodySendBus = c.createGain();
    this.bodyReturn = c.createGain();
    this.bodyReturn.gain.value = this.settings.body;
    this.chorusWet = c.createGain();
    this.chorusWet.gain.value = this.settings.chorus;
    this.delayReturn = c.createGain();
    this.delayReturn.gain.value = this.settings.delay;

    // dry path
    this.preMix.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.high.connect(this.dryMix);
    this.high.connect(this.shaper);
    this.shaper.connect(this.driveMix);
    const sum = c.createGain();
    this.dryMix.connect(sum);
    this.driveMix.connect(sum);
    sum.connect(this.glueComp);

    // effects returns land before the EQ so they get the same tone shaping
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.preMix);
    this.bodyReturn.connect(this.preMix);
    this.chorusWet.connect(this.preMix);
    this.delayReturn.connect(this.preMix);

    // mid/side width
    this.expression = c.createBiquadFilter();
    this.expression.type = "lowpass";
    this.expression.frequency.value = 18000;
    this.expression.Q.value = 0.4;
    this.glueComp.connect(this.expression);
    this.expression.connect(this.splitter);
    const sideInv = c.createGain();
    sideInv.gain.value = -1;
    this.splitter.connect(this.midGain, 0);
    this.splitter.connect(this.midGain, 1);
    this.midGain.gain.value = 0.5;
    this.splitter.connect(this.sideGain, 0);
    this.splitter.connect(sideInv, 1);
    this.sideGain.gain.value = 0.5;
    this.midGain.connect(this.merger, 0, 0);
    this.midGain.connect(this.merger, 0, 1);
    this.sideGain.connect(this.merger, 0, 0);
    const sideInv2 = c.createGain();
    sideInv2.gain.value = -1;
    this.sideGain.connect(sideInv2);
    sideInv2.connect(this.merger, 0, 1);
    this.msEncode.connect(this.limiter);

    this.merger.connect(this.limiterPath);
    this.limiterPath.connect(this.limiter);
    this.merger.connect(this.limiterBypass);
    this.limiter.connect(this.master);
    this.limiterBypass.connect(this.master);
    this.limiterBypass.gain.value = 0;

    // Meter the true output. Howler's master carries this desk *and* any
    // bounced loops, so tapping it shows exactly what reaches the speakers.
    this.master.connect(this.muteGain);
    const out = masterOutput();
    this.muteGain.connect(out);
    const meterTap = out === c.destination ? this.muteGain : out;
    meterTap.connect(this.analyser);
    meterTap.connect(this.meterAnalyser);
    this.applyWidth();
  }

  /** Loads Tuna (Web Audio DAW effects) and inserts the send effects. */
  async initEffects(): Promise<void> {
    if (this.tuna) return;
    const mod = (await import("tunajs")) as unknown as { default: new (ctx: AudioContext) => TunaFactory };
    const Tuna = mod.default;
    const tuna = new Tuna(this.ctx);
    this.tuna = tuna;

    this.chorusNode = new tuna.Chorus({ rate: 0.7, feedback: 0.28, delay: 12, bypass: 0 });
    this.preMix.connect(inp(this.chorusNode));
    outp(this.chorusNode).connect(this.chorusWet);

    // Native filtered feedback delay: sample-accurate, tempo-syncable and
    // free of the range clamping a wrapped third-party delay produces.
    const c = this.ctx;
    this.delayInput = c.createGain();
    this.delayNode = c.createDelay(2);
    this.delayNode.delayTime.value = this.settings.delayTime;
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    this.delayFeedback = c.createGain();
    this.delayFeedback.gain.value = 0.34;
    this.preMix.connect(this.delayInput);
    this.delayInput.connect(this.delayNode);
    this.delayNode.connect(tone);
    tone.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    tone.connect(this.delayReturn);
  }

  /** Attaches the Faust body resonator to its send bus. */
  attachBody(node: AudioNode) {
    this.bodySendBus.connect(node);
    node.connect(this.bodyReturn);
  }

  channel(id: string): ChannelStrip {
    const found = this.channels.get(id);
    if (found) return found;
    const c = this.ctx;
    const input = c.createGain();
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 20000;
    tone.Q.value = 0.4;
    const pan = c.createStereoPanner();
    const gain = c.createGain();
    const ampDry = c.createGain();
    const ampWet = c.createGain();
    ampWet.gain.value = 0;
    const sendReverb = c.createGain();
    const sendBody = c.createGain();
    const sendDelay = c.createGain();
    sendReverb.gain.value = 1;
    sendBody.gain.value = 0.6;
    sendDelay.gain.value = 1;

    input.connect(tone);
    tone.connect(pan);
    pan.connect(ampDry);
    ampDry.connect(gain);
    pan.connect(ampWet);
    gain.connect(this.preMix);
    gain.connect(sendReverb);
    sendReverb.connect(this.convolver);
    gain.connect(sendBody);
    sendBody.connect(this.bodySendBus);
    gain.connect(sendDelay);
    if (this.delayInput) sendDelay.connect(this.delayInput);
    else sendDelay.connect(this.delayReturn);

    const strip: ChannelStrip = { input, tone, pan, gain, sendReverb, sendBody, sendDelay, ampDrive: null, ampCab: null, ampWet, ampDry };
    this.channels.set(id, strip);
    return strip;
  }

  /** Guitar amp insert: overdrive + speaker cabinet, blended by `amount`. */
  setAmp(id: string, amount: number, drive = 0.6) {
    const strip = this.channel(id);
    if (!this.tuna) return;
    if (!strip.ampDrive) {
      strip.ampDrive = new this.tuna.Overdrive({ outputGain: -12, drive, curveAmount: 0.6, algorithmIndex: 0, bypass: 0 });
      strip.ampCab = new this.tuna.Cabinet({ makeupGain: 2, bypass: 0 });
      strip.ampWet.connect(inp(strip.ampDrive));
      outp(strip.ampDrive).connect(inp(strip.ampCab));
      outp(strip.ampCab).connect(strip.gain);
    }
    const wet = Math.max(0, Math.min(1, amount));
    strip.ampWet.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.03);
    strip.ampDry.gain.setTargetAtTime(1 - wet * 0.9, this.ctx.currentTime, 0.03);
  }

  get current(): MasterSettings {
    return { ...this.settings };
  }

  private applyWidth() {
    // mid stays constant, side scales with the width control
    this.sideGain.gain.setTargetAtTime(0.5 * this.settings.width * 2, this.ctx.currentTime, 0.05);
  }

  set(patch: Partial<MasterSettings>) {
    const s = { ...this.settings, ...patch };
    const prev = this.settings;
    this.settings = s;
    const t = this.ctx.currentTime;
    if (patch.volume !== undefined) this.master.gain.setTargetAtTime(s.volume, t, 0.02);
    if (patch.reverb !== undefined) this.reverbReturn.gain.setTargetAtTime(s.reverb * 1.4, t, 0.05);
    if (patch.body !== undefined) this.bodyReturn.gain.setTargetAtTime(s.body * 1.2, t, 0.05);
    if (patch.delay !== undefined) this.delayReturn.gain.setTargetAtTime(s.delay, t, 0.05);
    if (patch.chorus !== undefined) this.chorusWet.gain.setTargetAtTime(s.chorus * 0.7, t, 0.05);
    if (patch.bass !== undefined) this.low.gain.setTargetAtTime(s.bass, t, 0.05);
    if (patch.treble !== undefined) this.high.gain.setTargetAtTime(s.treble, t, 0.05);
    if (patch.width !== undefined) this.applyWidth();
    if (patch.drive !== undefined) {
      this.shaper.curve = driveCurve(s.drive);
      this.driveMix.gain.setTargetAtTime(s.drive * 0.9, t, 0.05);
      this.dryMix.gain.setTargetAtTime(1 - s.drive * 0.45, t, 0.05);
    }
    if (patch.glue !== undefined) {
      this.glueComp.threshold.value = -6 - s.glue * 26;
      this.glueComp.ratio.value = 1.5 + s.glue * 5;
      this.glueComp.attack.value = 0.012;
      this.glueComp.release.value = 0.18;
      this.glueComp.knee.value = 12;
    }
    if (patch.limiter !== undefined) {
      this.limiterPath.gain.setTargetAtTime(s.limiter ? 1 : 0, t, 0.02);
      this.limiterBypass.gain.setTargetAtTime(s.limiter ? 0 : 1, t, 0.02);
    }
    if (patch.delayTime !== undefined && this.delayNode) {
      this.delayNode.delayTime.setTargetAtTime(Math.max(0.02, Math.min(2, s.delayTime)), t, 0.06);
    }
    if (patch.roomSize !== undefined && Math.abs(prev.roomSize - s.roomSize) > 0.01) {
      this.convolver.buffer = makeIR(this.ctx, s.roomSize);
    }
    return s;
  }

  setMuted(v: boolean) {
    this.muteGain.gain.setTargetAtTime(v ? 0 : 1, this.ctx.currentTime, 0.015);
  }

  /** Performance filter (0..1) used by the arena to open the sound with combo. */
  setExpression(v: number) {
    const x = Math.max(0, Math.min(1, v));
    this.expression.frequency.setTargetAtTime(420 * Math.pow(42, x), this.ctx.currentTime, 0.06);
  }

  /** Peak level in dBFS since the last call (for the meter bridge). */
  peakDb(): number {
    const data = new Float32Array(this.meterAnalyser.fftSize);
    this.meterAnalyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    return 20 * Math.log10(Math.max(peak, 1e-6));
  }

  reset() {
    this.set({ ...DEFAULT_MASTER });
    return this.current;
  }
}
