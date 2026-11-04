import { clamp } from "../util";
import type { Instrument, NoteEvent, Pattern, Role } from "../types";
import { midiToFreq } from "./theory";

const BAR_BEATS = 4;
const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;

interface Track {
  id: number;
  pattern: Pattern;
  /** Absolute beat at which the current loop of the pattern starts. */
  loopStart: number;
  cursor: number;
  loop: boolean;
  done: boolean;
}

export interface TransportEvent {
  type: "start" | "stop" | "beat" | "note" | "track-end";
  /** Absolute beat position of the event. */
  beat: number;
  /** AudioContext time (seconds) at which the event sounds. */
  time: number;
  inst?: Instrument;
  role?: Role;
  midi?: number[];
  trackId?: number;
}

export type TransportListener = (e: TransportEvent) => void;

export interface NoteOptions {
  vel?: number;
  dur?: number;
  /** AudioContext time to start at (defaults to now). */
  when?: number;
  /** Seconds between strummed notes of a chord (guitar only). */
  strum?: number;
}

function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
  }
  return buf;
}

/**
 * Music engine: synthesized piano / guitar / drums on the Web Audio API, a
 * sample-accurate multi-track transport, and an event bus that the game and
 * UI layers subscribe to.
 */
export class MusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;

  private volume = 0.8;
  private bpm = 100;
  /** AudioContext time at which beat 0 sounds. */
  private origin = 0;
  private running = false;
  private tracks: Track[] = [];
  private nextTrackId = 1;
  private nextBeatTick = 0;
  private uiQueue: TransportEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<TransportListener>();

  get context(): AudioContext | null {
    return this.ctx;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get tempo(): number {
    return this.bpm;
  }

  /** Creates (on first call) and resumes the AudioContext. Call from a user gesture. */
  async ensure(): Promise<AudioContext> {
    if (typeof window === "undefined") {
      throw new Error("MusicEngine can only run in the browser");
    }
    if (!this.ctx) {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio is not supported in this browser");
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.build(this.ctx);
    }
    if (this.ctx.state !== "running") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = this.volume;

    const comp = ctx.createDynamicsCompressor();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 12000;
    filter.Q.value = 0.5;

    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(filter);
    filter.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    // Shared room reverb.
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 2.2);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    bus.connect(send);
    send.connect(verb);
    verb.connect(master);

    const len = Math.floor(ctx.sampleRate * 1.5);
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.master = master;
    this.bus = bus;
    this.filter = filter;
    this.noise = noise;
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  /** Expression 0..1 maps to the master low-pass cutoff (400 Hz .. 12 kHz). */
  setExpression(v: number): void {
    if (!this.ctx || !this.filter) return;
    const x = clamp(v, 0, 1);
    this.filter.frequency.setTargetAtTime(400 * Math.pow(30, x), this.ctx.currentTime, 0.06);
  }

  // ---------------------------------------------------------------- voices

  private pianoVoice(ctx: AudioContext, dest: AudioNode, midi: number, t: number, vel: number): void {
    const f = midiToFreq(midi);
    // Low notes ring longer than high ones.
    const decay = clamp(3.2 * Math.pow(262 / f, 0.35), 0.7, 4.2);
    const peak = 0.26 * vel;
    const partials: [number, OscillatorType, number, number, number][] = [
      // [freq multiple, wave, amplitude, decay speed factor, detune cents]
      [1, "triangle", 1, 1, 0],
      [1, "sine", 0.45, 1.2, 4],
      [2, "sine", 0.32, 2, 0],
      [3, "sine", 0.14, 3, 0],
      [4, "sine", 0.06, 4, 0],
    ];
    for (const [mult, wave, amp, dfac, detune] of partials) {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = f * mult;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak * amp, t + 0.004);
      g.gain.setTargetAtTime(0.0001, t + 0.004, decay / (4 * dfac));
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + decay * 1.2 + 0.1);
    }
    this.noiseBurst(ctx, dest, t, 0.02, 0.09 * vel, Math.min(f * 6, 6000), "bandpass");
  }

  private guitarVoice(ctx: AudioContext, dest: AudioNode, midi: number, t: number, vel: number, dur: number): void {
    const f = midiToFreq(midi);
    const tau = clamp(2.2 * Math.pow(220 / f, 0.5), 0.6, 2.6);
    // Plucked-string: bright saw pair through a low-pass whose cutoff closes quickly.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2;
    const cutStart = clamp(f * 7 + vel * 1800, 800, 9000);
    lp.frequency.setValueAtTime(cutStart, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.6, 200), t + tau * 0.6);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.22 * vel, t + 0.003);
    env.gain.setTargetAtTime(0.0001, t + 0.003, tau / 4);
    if (dur < tau * 1.5) {
      env.gain.setTargetAtTime(0.0001, t + Math.max(dur, 0.05), 0.04);
    }
    lp.connect(env);
    env.connect(dest);

    for (const detune of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + tau * 1.3 + 0.1);
    }
    this.noiseBurst(ctx, dest, t, 0.015, 0.05 * vel, Math.min(f * 5, 7000), "bandpass");
  }

  private kick(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(ctx: AudioContext, dest: AudioNode, t: number, vel: number): void {
    this.noiseBurst(ctx, dest, t, 0.05, 0.18 * vel, 7000, "highpass");
  }

  private noiseBurst(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    dur: number,
    amp: number,
    freq: number,
    type: BiquadFilterType,
  ): void {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.value = freq;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.9, dur + 0.01);
    src.stop(t + dur + 0.02);
  }

  private strike(inst: Instrument, midis: number[], t: number, vel: number, dur: number, strum: number): void {
    const ctx = this.ctx;
    const dest = this.bus;
    if (!ctx || !dest) return;
    const start = Math.max(t, ctx.currentTime);
    if (inst === "kick") {
      this.kick(ctx, dest, start, vel);
      return;
    }
    if (inst === "hat") {
      this.hat(ctx, dest, start, vel);
      return;
    }
    midis.forEach((m, i) => {
      const when = start + i * strum;
      if (inst === "piano") this.pianoVoice(ctx, dest, m, when, vel);
      else this.guitarVoice(ctx, dest, m, when, vel, dur);
    });
  }

  /** Plays a note or chord immediately (or at `opts.when`). */
  noteOn(inst: Instrument, midi: number | number[], opts: NoteOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const midis = Array.isArray(midi) ? midi : [midi];
    const when = opts.when ?? ctx.currentTime;
    const strum = opts.strum ?? (inst === "guitar" && midis.length > 1 ? 0.025 : 0);
    this.strike(inst, midis, when, opts.vel ?? 0.8, opts.dur ?? 1, strum);
  }

  // ------------------------------------------------------------- transport

  /** Converts an AudioContext time to a beat position on the transport. */
  beatAt(time: number): number {
    return ((time - this.origin) * this.bpm) / 60;
  }

  beatNow(): number {
    return this.ctx ? this.beatAt(this.ctx.currentTime) : 0;
  }

  timeOfBeat(beat: number): number {
    return this.origin + (beat * 60) / this.bpm;
  }

  on(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(e: TransportEvent): void {
    this.listeners.forEach((l) => l(e));
  }

  /** Starts (or restarts) the transport. Clears all tracks. */
  async start(bpm: number, leadSeconds = 0.15): Promise<void> {
    const ctx = await this.ensure();
    if (this.running) this.stop();
    this.bpm = clamp(Math.round(bpm), 40, 240);
    this.origin = ctx.currentTime + leadSeconds;
    this.running = true;
    this.nextBeatTick = 0;
    this.timer = setInterval(this.tick, TICK_MS);
    this.emit({ type: "start", beat: 0, time: this.origin });
    this.tick();
  }

  /** Stops the transport and removes every track. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const was = this.running;
    this.running = false;
    this.tracks = [];
    this.uiQueue = [];
    if (was) {
      this.emit({ type: "stop", beat: this.beatNow(), time: this.ctx?.currentTime ?? 0 });
    }
  }

  private nextBarBeat(): number {
    if (!this.running) return 0;
    return Math.max(0, Math.ceil(this.beatNow() / BAR_BEATS) * BAR_BEATS);
  }

  /**
   * Adds a pattern as a track. Tracks can be added while the transport is
   * running; they start at `startBeat` (default: the next bar line).
   */
  addTrack(pattern: Pattern, opts: { startBeat?: number; loop?: boolean } = {}): number {
    const id = this.nextTrackId++;
    this.tracks.push({
      id,
      pattern: { ...pattern, lengthBeats: Math.max(0.25, pattern.lengthBeats) },
      loopStart: opts.startBeat ?? this.nextBarBeat(),
      cursor: 0,
      loop: !!opts.loop,
      done: false,
    });
    return id;
  }

  /** Convenience: restart the transport with a single pattern. */
  async playPattern(pattern: Pattern, loop = false): Promise<number> {
    await this.start(pattern.bpm);
    return this.addTrack(pattern, { startBeat: 0, loop });
  }

  private scheduleEvent(ev: NoteEvent, abs: number, trackId: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = Math.max(this.timeOfBeat(abs), ctx.currentTime);
    const strum = ev.inst === "guitar" && ev.midi.length > 1 ? 0.025 : 0;
    this.strike(ev.inst, ev.midi, t, ev.vel, ev.dur, strum);
    this.uiQueue.push({
      type: "note",
      beat: abs,
      time: t,
      inst: ev.inst,
      role: ev.role,
      midi: ev.midi,
      trackId,
    });
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const now = ctx.currentTime;
    const horizon = this.beatAt(now + LOOKAHEAD_S);

    while (this.nextBeatTick < horizon) {
      this.uiQueue.push({
        type: "beat",
        beat: this.nextBeatTick,
        time: this.timeOfBeat(this.nextBeatTick),
      });
      this.nextBeatTick++;
    }

    for (const tr of this.tracks) {
      if (tr.done) continue;
      const evs = tr.pattern.events;
      if (evs.length === 0) {
        tr.done = true;
        continue;
      }
      for (;;) {
        if (tr.cursor >= evs.length) {
          if (!tr.loop) {
            tr.done = true;
            this.uiQueue.push({
              type: "track-end",
              beat: tr.loopStart + tr.pattern.lengthBeats,
              time: this.timeOfBeat(tr.loopStart + tr.pattern.lengthBeats),
              trackId: tr.id,
            });
            break;
          }
          tr.loopStart += tr.pattern.lengthBeats;
          tr.cursor = 0;
        }
        const ev = evs[tr.cursor];
        const abs = tr.loopStart + ev.beat;
        if (abs >= horizon) break;
        this.scheduleEvent(ev, abs, tr.id);
        tr.cursor++;
      }
    }
    this.tracks = this.tracks.filter((t) => !t.done);

    if (this.uiQueue.length > 0) {
      const due: TransportEvent[] = [];
      const rest: TransportEvent[] = [];
      for (const e of this.uiQueue) (e.time <= now ? due : rest).push(e);
      this.uiQueue = rest;
      due.sort((a, b) => a.time - b.time);
      for (const e of due) this.emit(e);
    }
  };
}
