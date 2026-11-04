import { clamp } from "../util";
import type { Instrument, NoteEvent, Pattern, Role } from "../types";
import { midiToFreq } from "./theory";
import { Daw, DEFAULT_MASTER, type MasterSettings } from "../audio/daw";
import { SympatheticResonance } from "../audio/resonance";
import {
  DEFAULT_PIANO,
  PIANO_PRESETS,
  loadPianoTuning,
  mapVelocity,
  pianoFrequency,
  pianoPan,
  pianoVoiceParams,
  type PianoSettings,
} from "../audio/piano";
import { FaustEngine, type StringParams } from "../audio/faust";
import { DEFAULT_PATCHES, findPatch, type Patch } from "../audio/patches";
import { drumVoice, ksFallback, synthVoice } from "../audio/synths";
import { loadProgram, startDrumSample, startSample } from "../audio/soundfont";
import { ensureContext, howlerGlobal, peekContext, primeSilence } from "../audio/context";
import { GaplessChain, encodeWav, normalizeLoudness } from "../audio/eko";

const BAR_BEATS = 4;
const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;

interface Track {
  id: number;
  pattern: Pattern;
  loopStart: number;
  cursor: number;
  loop: boolean;
  done: boolean;
}

export interface TransportEvent {
  type: "start" | "stop" | "beat" | "note" | "track-end";
  beat: number;
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
  when?: number;
  /** Seconds between strummed chord notes. Negative = upstroke. */
  strum?: number;
  /** Stereo position 0..1 for modelled strings. */
  pan?: number;
  params?: Partial<StringParams>;
}

export interface Voice {
  midi: number;
  release(): void;
}

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  piano: "Grand piano",
  epiano: "Electric piano",
  guitar: "Acoustic guitar",
  bass: "Bass guitar",
  synth: "Lead synth",
  strings: "String pad",
  kick: "Kick",
  snare: "Snare",
  hat: "Hi-hat",
  clap: "Clap",
};

export interface EngineStatus {
  running: boolean;
  faust: "off" | "loading" | "ready" | "unavailable";
  samples: number;
  loading: string[];
  message: string;
  muted: boolean;
  pianoVoices: number;
  pedal: number;
}

type StatusListener = (s: EngineStatus) => void;

function safeStop(src: AudioScheduledSourceNode, at: number) {
  try {
    src.stop(at);
  } catch {
    /* already stopped */
  }
}

/**
 * The music engine.
 *
 * Voices come from three sources, chosen per instrument patch:
 *  · WebAudioFont SoundFonts — recorded instruments, hundreds of GM timbres
 *  · Faust physical models compiled to WASM — vibrating strings + soundboard
 *  · built-in synths and drums (also the fallback when the others can't load)
 *
 * Everything is mixed on the Web Audio DAW desk (channel strips, sends, EQ,
 * drive, width, glue compression, limiter) and leaves through Howler's master
 * gain, so one control mutes the whole app on every platform.
 */
export class MusicEngine {
  private ctx: AudioContext | null = null;
  private daw: Daw | null = null;
  readonly faust = new FaustEngine();

  private patchIds: Record<Instrument, string> = { ...DEFAULT_PATCHES };
  private patchCache = new Map<string, Patch>();
  private loading = new Set<string>();
  private loadedSamples = 0;
  private faustState: EngineStatus["faust"] = "off";
  private message = "";

  private bpm = 100;
  private origin = 0;
  private running = false;
  private tracks: Track[] = [];
  private nextTrackId = 1;
  private nextBeatTick = 0;
  private scheduledUntil = 0;
  private uiQueue: TransportEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<TransportListener>();
  private statusListeners = new Set<StatusListener>();
  private sustain = false;
  private sustained: (() => void)[] = [];
  private metronome = false;
  private nextVoiceId = 1;
  private humanize = 0.25;
  private initPromise: Promise<void> | null = null;
  private recorder: AudioWorkletNode | null = null;
  private mutedFlag = false;
  private pianoSettings: PianoSettings = { ...DEFAULT_PIANO };
  private pianoPresetId = "concert";
  private pianoMode: "model" | "sample" = "model";
  private resonance: SympatheticResonance | null = null;
  private pianoVoices = new Map<number, { midi: number; at: number; gain: number }>();
  private heldPiano = new Map<number, number>();
  private pedalValue = 0;

  // ------------------------------------------------------------------ status

  get context(): AudioContext | null {
    return this.ctx;
  }

  get desk(): Daw | null {
    return this.daw;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get tempo(): number {
    return this.bpm;
  }

  get analyserNode(): AnalyserNode | null {
    return this.daw?.analyser ?? null;
  }

  get sustainOn(): boolean {
    return this.sustain;
  }

  status(): EngineStatus {
    return {
      running: this.ctx?.state === "running",
      faust: this.faustState,
      samples: this.loadedSamples,
      loading: [...this.loading],
      message: this.message,
      muted: this.mutedFlag,
      pianoVoices: this.pianoVoices.size,
      pedal: this.pedalValue,
    };
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status());
    return () => this.statusListeners.delete(fn);
  }

  private emitStatus() {
    const s = this.status();
    this.statusListeners.forEach((l) => l(s));
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  // ------------------------------------------------------------------- setup

  async ensure(): Promise<AudioContext> {
    const ctx = await ensureContext();
    if (this.ctx !== ctx || !this.daw) {
      this.ctx = ctx;
      this.daw = new Daw(ctx);
      this.daw.set({ ...DEFAULT_MASTER });
      primeSilence(ctx);
      this.initPromise = this.initAsync(ctx);
    }
    if (this.initPromise) await this.initPromise.catch(() => undefined);
    return ctx;
  }

  private async initAsync(ctx: AudioContext) {
    const daw = this.daw!;
    await daw.initEffects().catch(() => undefined);
    this.faustState = "loading";
    this.emitStatus();
    const ok = await this.faust.init(ctx);
    this.faustState = ok ? "ready" : "unavailable";
    if (ok && this.faust.body) {
      daw.attachBody(this.faust.body);
      this.faust.setBodyParams({ size: 0.45, decay: 0.5, mix: 0.6, tone: 0.5, width: 0.7 });
    }
    if (ok && this.faust.strings) {
      this.faust.strings.connect(daw.channel("guitar").input);
      this.faust.onEnded(() => undefined);
    }
    if (ok && this.faust.piano) {
      const strip = daw.channel("piano");
      this.faust.piano.connect(strip.input);
      this.resonance = new SympatheticResonance(ctx, 12);
      this.faust.piano.connect(this.resonance.input);
      this.resonance.output.connect(strip.input);
      await loadPianoTuning();
      this.applyPianoTone();
    }
    this.applyChannelDefaults();
    // Recorder for real-time bounces.
    try {
      this.recorder = new AudioWorkletNode(ctx, "pcm-recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      // A worklet with no outputs can be pruned from the render graph, so the
      // recorder passes silence into a muted sink to guarantee it is pulled.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      this.recorder.connect(sink);
      sink.connect(ctx.destination);
      daw.master.connect(this.recorder);
      // addEventListener does not implicitly start a MessagePort
      this.recorder.port.start();
    } catch {
      this.recorder = null;
    }
    this.message = ok ? "Physical models ready" : "Sampled + synth voices";
    this.emitStatus();
    // Warm the default sampled patches in the background.
    for (const id of ["piano", "epiano", "strings"] as Instrument[]) {
      const patch = this.patch(id);
      if (patch.source === "sample" && patch.program !== undefined) void this.warm(patch.program);
    }
  }

  private async warm(program: number) {
    if (!this.ctx) return;
    const key = `gm.${program}`;
    if (this.loading.has(key)) return;
    this.loading.add(key);
    this.emitStatus();
    try {
      await loadProgram(this.ctx, program);
      this.loadedSamples++;
    } catch {
      this.message = "SoundFont unavailable — using synthesis";
    } finally {
      this.loading.delete(key);
      this.emitStatus();
    }
  }

  /**
   * Send levels chosen per instrument family: a grand piano does not want the
   * guitar body resonator, a bass does not want a wide stereo room.
   */
  private applyChannelDefaults() {
    const d = this.daw;
    if (!d) return;
    const table: Record<string, { rev: number; body: number; delay: number; pan: number }> = {
      piano: { rev: 0.8, body: 0, delay: 0.25, pan: 0 },
      epiano: { rev: 0.7, body: 0, delay: 0.5, pan: 0 },
      guitar: { rev: 0.75, body: 0.85, delay: 0.4, pan: 0 },
      bass: { rev: 0.12, body: 0.35, delay: 0, pan: 0 },
      synth: { rev: 0.6, body: 0.1, delay: 0.7, pan: 0 },
      strings: { rev: 1, body: 0.1, delay: 0.3, pan: 0 },
      kick: { rev: 0.35, body: 0, delay: 0.1, pan: 0 },
    };
    for (const [id, v] of Object.entries(table)) {
      const strip = d.channel(id);
      strip.sendReverb.gain.value = v.rev;
      strip.sendBody.gain.value = v.body;
      strip.sendDelay.gain.value = v.delay;
      strip.pan.pan.value = v.pan;
    }
  }

  // ------------------------------------------------------------------- piano

  get piano(): PianoSettings {
    return { ...this.pianoSettings };
  }

  get pianoPreset(): string {
    return this.pianoPresetId;
  }

  get engineMode(): "model" | "sample" {
    return this.pianoMode;
  }

  setPianoMode(mode: "model" | "sample") {
    this.pianoMode = mode;
    if (mode === "sample") void this.warm(0);
    this.emitStatus();
  }

  private applyPianoTone() {
    const d = this.daw;
    if (!d) return;
    const s = this.pianoSettings;
    const strip = d.channel("piano");
    // distant mics hear less direct highs and more of the room
    strip.tone.frequency.setTargetAtTime(17000 - s.distance * 12000, this.now(), 0.08);
    strip.sendReverb.gain.setTargetAtTime(0.35 + s.distance * 1.15, this.now(), 0.08);
    this.resonance?.setAmount(s.resonance * (0.25 + this.pedalValue * 0.75));
  }

  setPiano(patch: Partial<PianoSettings>, presetId?: string) {
    this.pianoSettings = { ...this.pianoSettings, ...patch };
    if (presetId !== undefined) this.pianoPresetId = presetId;
    const live = this.pianoSettings;
    this.faust.setPianoParams({
      hammer: live.hammer,
      detune: live.unison,
      inharmonicity: live.inharmonicity,
      decay: live.sustain,
      coupling: live.coupling,
      board: live.soundboard,
      lid: live.lid,
      damper: live.damper,
      releaseNoise: live.releaseNoise,
    });
    this.applyPianoTone();
    this.emitStatus();
    return this.piano;
  }

  loadPianoPreset(id: string) {
    const preset = PIANO_PRESETS.find((p) => p.id === id) ?? PIANO_PRESETS[0];
    return this.setPiano(preset.settings, preset.id);
  }

  /** Currently sounding keys, for the UI and the resonance bank. */
  activePianoNotes(): number[] {
    return [...this.pianoVoices.values()].map((v) => v.midi);
  }

  private updateResonance() {
    if (!this.resonance) return;
    const notes = new Set<number>();
    for (const v of this.pianoVoices.values()) notes.add(v.midi);
    for (const m of this.heldPiano.values()) notes.add(m);
    this.resonance.setNotes([...notes].sort((a, b) => a - b).map((m) => pianoFrequency(m, this.pianoSettings)));
  }

  private retirePiano(id: number) {
    this.pianoVoices.delete(id);
    this.heldPiano.delete(id);
    this.updateResonance();
  }

  private pianoVoice(midi: number, vel: number, dur: number, opts: NoteOptions, hold: boolean): Voice {
    const s = this.pianoSettings;
    const { freq, gain, params } = pianoVoiceParams(midi, vel, s);
    const id = this.nextVoiceId++;
    const pan = opts.pan ?? pianoPan(midi, s.width);
    this.faust.strikePiano(id, freq, { gain, pan, params });

    // optional recorded hammer/attack layer over the modelled string
    if (s.sampleLayer > 0.02 && this.ctx && this.daw) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = s.sampleLayer * 0.5;
      g.connect(this.daw.channel("piano").input);
      const at = ctx.currentTime;
      g.gain.setValueAtTime(s.sampleLayer * 0.5, at + 0.18);
      g.gain.linearRampToValueAtTime(0, at + 0.55);
      void startSample(ctx, g, 0, midi, { when: at, duration: 0.6, velocity: gain })
        .then((h) => window.setTimeout(() => { h?.stop(); g.disconnect(); }, 800))
        .catch(() => g.disconnect());
    }

    // polyphony: steal the oldest, quietest sounding note
    this.pianoVoices.set(id, { midi, at: this.now(), gain });
    if (this.pianoVoices.size > s.polyphony) {
      let oldest = -1;
      let oldestAt = Infinity;
      for (const [vid, v] of this.pianoVoices) {
        if (vid !== id && v.at < oldestAt) { oldestAt = v.at; oldest = vid; }
      }
      if (oldest >= 0) {
        this.faust.dampPiano(oldest);
        this.retirePiano(oldest);
      }
    }
    this.updateResonance();

    let released = false;
    const damp = () => {
      if (released) return;
      released = true;
      if (hold && this.pedalValue > 0.03) {
        this.heldPiano.set(id, midi);
        this.faust.setPianoVoice(id, { damper: s.damper * this.pedalValue });
        this.updateResonance();
        return;
      }
      this.faust.dampPiano(id);
      window.setTimeout(() => this.retirePiano(id), 400);
    };
    if (!hold) window.setTimeout(damp, Math.max(80, dur * 1000));
    return { midi, release: damp };
  }

  // ----------------------------------------------------------------- patches

  patch(inst: Instrument): Patch {
    const id = this.patchIds[inst];
    let p = this.patchCache.get(id);
    if (!p) {
      p = findPatch(id);
      this.patchCache.set(id, p);
    }
    return p;
  }

  patchId(inst: Instrument): string {
    return this.patchIds[inst];
  }

  setPatch(inst: Instrument, patchId: string) {
    this.patchIds[inst] = patchId;
    const p = this.patch(inst);
    if (p.source === "sample" && p.program !== undefined) void this.warm(p.program);
    if (inst === "guitar" || inst === "bass") this.faust.setStringParams((p.model ?? {}) as Partial<StringParams>);
    this.emitStatus();
  }

  // ------------------------------------------------------------------ master

  get master(): MasterSettings {
    return this.daw?.current ?? { ...DEFAULT_MASTER };
  }

  setMaster(patch: Partial<MasterSettings>): MasterSettings {
    if (!this.daw) return { ...DEFAULT_MASTER, ...patch };
    const next = this.daw.set(patch);
    if (patch.body !== undefined || patch.roomSize !== undefined) {
      this.faust.setBodyParams({ size: next.roomSize, decay: 0.35 + next.roomSize * 0.45, mix: 0.7 });
    }
    return next;
  }

  resetMaster(): MasterSettings {
    return this.daw?.reset() ?? { ...DEFAULT_MASTER };
  }

  peakDb(): number {
    return this.daw?.peakDb() ?? -60;
  }

  /** One switch for the entire app: Howler's master gain feeds every voice. */
  setMuted(v: boolean) {
    this.mutedFlag = v;
    this.daw?.setMuted(v);
    // Howler's master also feeds bounced loops played through Howl
    howlerGlobal()?.mute(v);
    this.emitStatus();
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  setVolume(v: number) {
    this.setMaster({ volume: clamp(v, 0, 1) });
  }

  setExpression(v: number) {
    this.daw?.setExpression(v);
  }

  setAmp(inst: Instrument, amount: number, drive = 0.6) {
    this.daw?.setAmp(inst, amount, drive);
  }

  setHumanize(v: number) {
    this.humanize = clamp(v, 0, 1);
  }

  channelGain(inst: Instrument, gain: number) {
    this.daw?.channel(inst).gain.gain.setTargetAtTime(gain, this.now(), 0.03);
  }

  channelPan(inst: Instrument, pan: number) {
    this.daw?.channel(inst).pan.pan.setTargetAtTime(clamp(pan, -1, 1), this.now(), 0.03);
  }

  setMetronome(on: boolean) {
    this.metronome = on;
  }

  setSustain(on: boolean) {
    this.setPedal(on ? 1 : 0);
  }

  get pedal(): number {
    return this.pedalValue;
  }

  /** Continuous damper pedal: 0 = up, 1 = fully down, in between = half pedal. */
  setPedal(value: number) {
    const v = clamp(value, 0, 1);
    const was = this.pedalValue;
    this.pedalValue = v;
    this.sustain = v > 0.03;
    if (v > 0.03) {
      for (const [id] of this.heldPiano) this.faust.setPianoVoice(id, { damper: this.pianoSettings.damper * v });
    } else if (was > 0.03) {
      for (const id of [...this.heldPiano.keys()]) {
        this.faust.dampPiano(id);
        window.setTimeout(() => this.retirePiano(id), 400);
      }
      this.heldPiano.clear();
      for (const release of this.sustained) release();
      this.sustained = [];
    }
    this.resonance?.setAmount(this.pianoSettings.resonance * (0.25 + v * 0.75));
    this.updateResonance();
    this.emitStatus();
  }

  // ------------------------------------------------------------------ voices

  private freqOf(midi: number): number {
    const a4 = this.daw?.current.tuning ?? 440;
    return a4 === 440 ? midiToFreq(midi) : a4 * Math.pow(2, (midi - 69) / 12);
  }

  /** Starts a sounding voice. `hold` keeps it alive until release() is called. */
  private startVoice(inst: Instrument, midi: number, when: number, vel: number, dur: number, opts: NoteOptions, hold: boolean): Voice {
    const ctx = this.ctx;
    const daw = this.daw;
    if (!ctx || !daw) return { midi, release: () => undefined };
    if (inst === "piano" && this.pianoMode === "model" && this.faust.ready && this.faust.piano) {
      return this.pianoVoice(midi, vel, dur, opts, hold);
    }
    const patch = this.patch(inst);
    const t = Math.max(when, ctx.currentTime);
    let released = false;
    let stopFn: (() => void) | null = null;
    const id = this.nextVoiceId++;

    const finish = () => {
      if (released) return;
      released = true;
      if (this.sustain && hold) {
        this.sustained.push(() => stopFn?.());
        return;
      }
      stopFn?.();
    };

    if (patch.source === "faust" && this.faust.ready) {
      const model = patch.model ?? {};
      const pan = opts.pan ?? 0.5;
      this.faust.pluck(id, this.freqOf(midi + (model.octave ?? 0)), {
        gain: clamp(vel * (model.gain ?? 1), 0.05, 1.4),
        pan,
        params: { ...model, ...opts.params } as Partial<StringParams>,
      });
      stopFn = () => this.faust.release(id);
      if (!hold) window.setTimeout(() => finish(), Math.max(60, dur * 1000));
      return { midi, release: finish };
    }

    if (patch.source === "sample" && patch.program !== undefined) {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(daw.channel(inst).input);
      const pan = ctx.createStereoPanner();
      pan.pan.value = opts.pan !== undefined ? opts.pan * 2 - 1 : clamp((midi - 60) / 90, -0.35, 0.35);
      pan.connect(g);
      let handle: { stop: () => void } | null = null;
      let cancelled = false;
      const release = () => {
        cancelled = true;
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.setTargetAtTime(0.0001, now, 0.045);
        window.setTimeout(() => {
          handle?.stop();
          g.disconnect();
          pan.disconnect();
        }, 260);
      };
      stopFn = release;
      if (!hold) {
        // Sampled one-shots end on their own; tidy the per-note nodes afterwards.
        window.setTimeout(release, Math.max(0, (t - ctx.currentTime + Math.max(0.12, dur)) * 1000) + 500);
      }
      void startSample(ctx, pan, patch.program, midi, {
        when: t,
        duration: hold ? 24 : Math.max(0.12, dur),
        velocity: clamp(vel, 0.05, 1),
      })
        .then((h) => {
          handle = h;
          if (cancelled) release();
        })
        .catch(() => {
          // SoundFont unavailable: fall back to synthesis for this note.
          const b = synthVoice(ctx, daw.channel(inst).input, "piano", this.freqOf(midi), ctx.currentTime, vel);
          stopFn = () => this.releaseBuilt(b, ctx.currentTime);
          if (cancelled) stopFn();
        });
      return { midi, release: finish };
    }

    const dest = daw.channel(inst).input;
    let built;
    if (patch.source === "faust") {
      built = ksFallback(ctx, dest, this.freqOf(midi), t, vel, inst === "bass");
    } else {
      built = synthVoice(ctx, dest, patch.synth ?? "saw", this.freqOf(midi), t, vel);
    }
    stopFn = () => this.releaseBuilt(built, ctx.currentTime);
    if (!hold) {
      const off = t + Math.max(0.06, dur);
      if (off < t + built.natural || !Number.isFinite(built.natural)) {
        this.releaseBuilt(built, off);
      }
    }
    return { midi, release: finish };
  }

  private releaseBuilt(b: { out: GainNode; sources: AudioScheduledSourceNode[]; rel: number }, at: number) {
    b.out.gain.cancelScheduledValues(at);
    b.out.gain.setValueAtTime(b.out.gain.value || 1, at);
    b.out.gain.setTargetAtTime(0.0001, at, b.rel / 3);
    for (const s of b.sources) safeStop(s, at + b.rel * 2 + 0.05);
  }

  private drum(midi: number, t: number, vel: number) {
    const ctx = this.ctx;
    const daw = this.daw;
    if (!ctx || !daw) return;
    const dest = daw.channel("kick").input;
    void startDrumSample(ctx, dest, midi, t, vel).then((ok) => {
      if (ok) return;
      const b = drumVoice(ctx, dest, midi, Math.max(t, ctx.currentTime), vel);
      if (Number.isFinite(b.natural)) this.releaseBuilt(b, Math.max(t, ctx.currentTime) + b.natural);
    });
  }

  /** Plays a note or chord for a fixed duration. */
  noteOn(inst: Instrument, midi: number | number[], opts: NoteOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const midis = Array.isArray(midi) ? midi : [midi];
    const when = opts.when ?? ctx.currentTime;
    const vel = opts.vel ?? 0.8;
    if (inst === "kick" || inst === "snare" || inst === "hat" || inst === "clap") {
      for (const m of midis) this.drum(m, when, vel);
      return;
    }
    const patch = this.patch(inst);
    const strum = opts.strum ?? (patch.source === "faust" && midis.length > 1 ? 0.018 : 0);
    const order = strum < 0 ? [...midis].reverse() : midis;
    const gap = Math.abs(strum);
    const dur = opts.dur ?? 2.5;
    order.forEach((m, i) => {
      const jitter = this.humanize * (Math.random() - 0.5) * 0.008;
      const v = clamp(vel * (1 - this.humanize * 0.12 * Math.random()), 0.05, 1);
      this.startVoice(inst, m, when + i * gap + jitter, v, dur, { ...opts, pan: opts.pan ?? this.panFor(i, order.length) }, false);
    });
  }

  private panFor(index: number, total: number): number {
    if (total <= 1) return 0.5;
    return 0.36 + (index / (total - 1)) * 0.28;
  }

  /** Starts a held note; call release() on key/string up. Honours the pedal. */
  press(inst: Instrument, midi: number, vel = 0.8, delay = 0, opts: NoteOptions = {}): Voice {
    if (!this.ctx) return { midi, release: () => undefined };
    if (inst === "kick" || inst === "snare" || inst === "hat" || inst === "clap") {
      this.drum(midi, this.ctx.currentTime + delay, vel);
      return { midi, release: () => undefined };
    }
    return this.startVoice(inst, midi, this.ctx.currentTime + delay, vel, 24, opts, true);
  }

  /** Physical string helpers for two-handed guitar performance. */
  pluckString(id: number, midi: number, vel: number, pan: number, params?: Partial<StringParams>) {
    if (this.faust.ready) {
      this.faust.pluck(id, this.freqOf(midi), { gain: vel, pan, params });
      return true;
    }
    this.noteOn("guitar", midi, { vel, pan, params, dur: 3 });
    return false;
  }

  dampString(id: number) {
    this.faust.release(id);
  }

  chokeStrings(id?: number) {
    this.faust.choke(id);
  }

  allNotesOff() {
    this.faust.allOff();
    this.faust.pianoAllOff();
    this.pianoVoices.clear();
    this.heldPiano.clear();
    this.setPedal(0);
    this.updateResonance();
  }

  /** Struck-key helper for the piano page (velocity already mapped by the caller). */
  strikeKey(midi: number, velocity: number, opts: NoteOptions = {}): Voice {
    if (!this.ctx) return { midi, release: () => undefined };
    if (this.pianoMode === "model" && this.faust.ready) return this.pianoVoice(midi, velocity, 24, opts, true);
    return this.press("piano", midi, mapVelocity(velocity, this.pianoSettings), 0, opts);
  }

  click(accent: boolean, when?: number) {
    const ctx = this.ctx;
    const daw = this.daw;
    if (!ctx || !daw) return;
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1175;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.16 : 0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g);
    g.connect(daw.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  // --------------------------------------------------------------- transport

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
    return () => this.listeners.delete(listener);
  }

  private emit(e: TransportEvent) {
    this.listeners.forEach((l) => l(e));
  }

  async start(bpm: number, leadSeconds = 0.15): Promise<void> {
    const ctx = await this.ensure();
    if (this.running) this.stop();
    this.bpm = clamp(Math.round(bpm), 40, 240);
    this.origin = ctx.currentTime + leadSeconds;
    this.running = true;
    this.nextBeatTick = 0;
    this.scheduledUntil = 0;
    this.timer = setInterval(this.tick, TICK_MS);
    this.emit({ type: "start", beat: 0, time: this.origin });
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const was = this.running;
    this.running = false;
    this.tracks = [];
    this.uiQueue = [];
    if (was) this.emit({ type: "stop", beat: this.beatNow(), time: this.ctx?.currentTime ?? 0 });
  }

  private nextBarBeat(): number {
    if (!this.running) return 0;
    return Math.max(0, Math.ceil(this.beatNow() / BAR_BEATS) * BAR_BEATS);
  }

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

  replaceTrack(id: number, pattern: Pattern): void {
    const tr = this.tracks.find((t) => t.id === id);
    if (!tr) return;
    const events = [...pattern.events].sort((a, b) => a.beat - b.beat);
    tr.pattern = { ...pattern, events, lengthBeats: Math.max(0.25, pattern.lengthBeats) };
    while (tr.loop && tr.loopStart + tr.pattern.lengthBeats <= this.scheduledUntil) {
      tr.loopStart += tr.pattern.lengthBeats;
    }
    const pos = this.scheduledUntil - tr.loopStart;
    const idx = events.findIndex((e) => e.beat >= pos);
    tr.cursor = idx < 0 ? events.length : idx;
  }

  async playPattern(pattern: Pattern, loop = false): Promise<number> {
    await this.start(pattern.bpm);
    return this.addTrack(pattern, { startBeat: 0, loop });
  }

  private scheduleEvent(ev: NoteEvent, abs: number, trackId: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = Math.max(this.timeOfBeat(abs), ctx.currentTime);
    const durSec = (ev.dur * 60) / this.bpm;
    if (ev.inst === "kick" || ev.inst === "snare" || ev.inst === "hat" || ev.inst === "clap") {
      for (const m of ev.midi) this.drum(m, t, ev.vel);
    } else {
      const patch = this.patch(ev.inst);
      const strum = patch.source === "faust" && ev.midi.length > 1 ? 0.016 : 0;
      ev.midi.forEach((m, i) => {
        const jitter = this.humanize * (Math.random() - 0.5) * 0.01;
        this.startVoice(ev.inst, m, t + i * strum + jitter, ev.vel, durSec, { pan: this.panFor(i, ev.midi.length) }, false);
      });
    }
    this.uiQueue.push({ type: "note", beat: abs, time: t, inst: ev.inst, role: ev.role, midi: ev.midi, trackId });
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const now = ctx.currentTime;
    const horizon = this.beatAt(now + LOOKAHEAD_S);

    while (this.nextBeatTick < horizon) {
      const t = this.timeOfBeat(this.nextBeatTick);
      if (this.metronome) this.click(this.nextBeatTick % BAR_BEATS === 0, t);
      this.uiQueue.push({ type: "beat", beat: this.nextBeatTick, time: t });
      this.nextBeatTick++;
    }

    for (const tr of this.tracks) {
      if (tr.done) continue;
      const evs = tr.pattern.events;
      if (evs.length === 0 && !tr.loop) {
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
          if (tr.loopStart + tr.pattern.lengthBeats >= horizon) break;
          tr.loopStart += tr.pattern.lengthBeats;
          tr.cursor = 0;
          if (evs.length === 0) break;
        }
        const ev = evs[tr.cursor];
        const abs = tr.loopStart + ev.beat;
        if (abs >= horizon) break;
        this.scheduleEvent(ev, abs, tr.id);
        tr.cursor++;
      }
    }
    this.tracks = this.tracks.filter((t) => !t.done);
    this.scheduledUntil = horizon;

    if (this.uiQueue.length > 0) {
      const due: TransportEvent[] = [];
      const rest: TransportEvent[] = [];
      for (const e of this.uiQueue) (e.time <= now ? due : rest).push(e);
      this.uiQueue = rest;
      due.sort((a, b) => a.time - b.time);
      for (const e of due) this.emit(e);
    }
  };

  // ------------------------------------------------------------------ bounce

  /**
   * Real-time bounce of the live mix (SoundFonts + WASM models + FX) into an
   * AudioBuffer, loudness-normalised to broadcast target.
   */
  async bounce(pattern: Pattern, loops = 2, onProgress?: (p: number) => void, targetLufs = -14): Promise<AudioBuffer> {
    const ctx = await this.ensure();
    if (!this.recorder) throw new Error("Recording is not supported in this browser");
    const beatSec = 60 / pattern.bpm;
    const seconds = pattern.lengthBeats * beatSec * loops + 2.2;
    const chunks: { l: Float32Array; r: Float32Array }[] = [];
    const port = this.recorder.port;
    const handler = (e: MessageEvent) => {
      if (e.data?.l) chunks.push(e.data as { l: Float32Array; r: Float32Array });
    };
    port.addEventListener("message", handler);
    port.postMessage({ type: "record", value: true });
    await this.start(pattern.bpm, 0.12);
    this.addTrack(pattern, { startBeat: 0, loop: loops > 1 });
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const id = window.setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        onProgress?.(Math.min(1, elapsed / seconds));
        if (elapsed >= seconds) {
          window.clearInterval(id);
          resolve();
        }
      }, 100);
    });
    this.stop();
    port.postMessage({ type: "record", value: false });
    port.removeEventListener("message", handler);
    const total = chunks.reduce((s, c) => s + c.l.length, 0);
    if (total === 0) throw new Error("Nothing was recorded");
    const buf = ctx.createBuffer(2, total, ctx.sampleRate);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    let o = 0;
    for (const c of chunks) {
      L.set(c.l, o);
      R.set(c.r, o);
      o += c.l.length;
    }
    await normalizeLoudness(buf, targetLufs, -1).catch(() => undefined);
    onProgress?.(1);
    return buf;
  }

  /** Gapless loop chain (used for progression previews and jam loops). */
  createChain(crossfade = 0.02): GaplessChain | null {
    if (!this.ctx || !this.daw) return null;
    return new GaplessChain(this.ctx, this.daw.channel("synth").input, crossfade);
  }

  /** Offline render with the built-in synths (fallback when recording is unavailable). */
  static async render(pattern: Pattern, loops = 1, tail = 2.5): Promise<AudioBuffer> {
    const sr = 44100;
    const beatSec = 60 / pattern.bpm;
    const total = pattern.lengthBeats * beatSec * loops + tail;
    const OfflineCtor =
      (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineCtor) throw new Error("Offline rendering is not supported in this browser");
    const off = new OfflineCtor(2, Math.ceil(sr * total), sr);
    const master = off.createGain();
    master.gain.value = 0.85;
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(off.destination);
    for (let l = 0; l < loops; l++) {
      for (const ev of pattern.events) {
        const t = (l * pattern.lengthBeats + ev.beat) * beatSec + 0.05;
        for (const m of ev.midi) {
          const built =
            ev.inst === "kick" || ev.inst === "snare" || ev.inst === "hat" || ev.inst === "clap"
              ? drumVoice(off, master, m, t, ev.vel)
              : ev.inst === "guitar" || ev.inst === "bass"
                ? ksFallback(off, master, midiToFreq(m), t, ev.vel, ev.inst === "bass")
                : synthVoice(off, master, ev.inst === "piano" ? "piano" : ev.inst === "epiano" ? "fm" : ev.inst === "strings" ? "pad" : "saw", midiToFreq(m), t, ev.vel);
          const off2 = t + ev.dur * beatSec;
          if (Number.isFinite(built.natural)) {
            const end = Math.min(off2, t + built.natural);
            built.out.gain.setTargetAtTime(0.0001, end, built.rel / 3);
            for (const s of built.sources) safeStop(s, end + built.rel * 2);
          } else {
            built.out.gain.setTargetAtTime(0.0001, off2, built.rel / 3);
            for (const s of built.sources) safeStop(s, off2 + built.rel * 2);
          }
        }
      }
    }
    return off.startRendering();
  }
}

let shared: MusicEngine | null = null;

/** App-wide engine: one context, one desk, one master mute. */
export function getEngine(): MusicEngine {
  if (!shared) {
    shared = new MusicEngine();
    if (typeof window !== "undefined") {
      (window as unknown as { __fk?: MusicEngine }).__fk = shared;
    }
  }
  return shared;
}

export { encodeWav, normalizeLoudness, measureLoudness } from "../audio/eko";
export { peekContext };
