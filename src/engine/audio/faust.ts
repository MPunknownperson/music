"use client";

/**
 * Faust physical models compiled to WebAssembly (src/dsp/*.dsp → public/faust).
 * The string model is a dispersive digital waveguide with a modal soundboard;
 * the body model is a lossy feedback-delay resonator used as a shared space.
 */

interface FaustMeta {
  name: string;
  inputs: number;
  outputs: number;
  size: number;
  compile_options: string;
  ui: unknown;
}

export interface StringParams {
  brightness: number;
  damping: number;
  stiffness: number;
  bodyMix: number;
  pluckPos: number;
}

export interface PianoParams {
  hammer: number;
  detune: number;
  inharmonicity: number;
  decay: number;
  coupling: number;
  board: number;
  lid: number;
  damper: number;
  tuneComp: number;
  releaseNoise: number;
}

export class FaustEngine {
  private ctx: AudioContext | null = null;
  private moduleLoaded = false;
  strings: AudioWorkletNode | null = null;
  piano: AudioWorkletNode | null = null;
  body: AudioWorkletNode | null = null;
  ready = false;
  error: string | null = null;
  private endedHandlers = new Set<(id: number) => void>();

  static get supported(): boolean {
    return typeof window !== "undefined" && "AudioWorkletNode" in window && "WebAssembly" in window;
  }

  onEnded(fn: (id: number) => void): () => void {
    this.endedHandlers.add(fn);
    return () => this.endedHandlers.delete(fn);
  }

  async init(ctx: AudioContext): Promise<boolean> {
    if (this.ready && this.ctx === ctx) return true;
    if (!FaustEngine.supported) {
      this.error = "AudioWorklet unavailable";
      return false;
    }
    this.ctx = ctx;
    try {
      if (!this.moduleLoaded) {
        await ctx.audioWorklet.addModule("/worklets/faust-processor.js");
        this.moduleLoaded = true;
      }
      const [strWasm, strMeta, bodyWasm, bodyMeta, pnoWasm, pnoMeta] = await Promise.all([
        fetch("/faust/string.wasm").then((r) => r.arrayBuffer()),
        fetch("/faust/string.json").then((r) => r.json() as Promise<FaustMeta>),
        fetch("/faust/body.wasm").then((r) => r.arrayBuffer()),
        fetch("/faust/body.json").then((r) => r.json() as Promise<FaustMeta>),
        fetch("/faust/piano.wasm").then((r) => r.arrayBuffer()),
        fetch("/faust/piano.json").then((r) => r.json() as Promise<FaustMeta>),
      ]);
      this.strings = new AudioWorkletNode(ctx, "faust-string", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          wasm: strWasm,
          meta: strMeta,
          voices: 16,
          defaults: { brightness: 0.5, damping: 0.35, stiffness: 0.25, bodyMix: 0.55, pluckPos: 0.18 },
        },
      });
      this.piano = new AudioWorkletNode(ctx, "faust-voice", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { wasm: pnoWasm, meta: pnoMeta, voices: 32, defaults: {} },
      });
      this.strings.port.onmessage = (e) => {
        if (e.data?.type === "ended") this.endedHandlers.forEach((h) => h(e.data.id as number));
      };
      this.body = new AudioWorkletNode(ctx, "faust-body", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { wasm: bodyWasm, meta: bodyMeta },
      });
      this.ready = true;
      this.error = null;
      return true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Faust failed to load";
      this.ready = false;
      return false;
    }
  }

  pluck(id: number, freq: number, opts: { gain?: number; pan?: number; params?: Partial<StringParams> } = {}) {
    this.strings?.port.postMessage({
      type: "on",
      id,
      freq,
      gain: opts.gain ?? 0.8,
      pan: opts.pan ?? 0.5,
      params: opts.params,
    });
  }

  release(id: number) {
    this.strings?.port.postMessage({ type: "off", id });
  }

  choke(id?: number) {
    this.strings?.port.postMessage({ type: "choke", id });
  }

  allOff() {
    this.strings?.port.postMessage({ type: "allOff" });
  }

  setStringParams(values: Partial<StringParams>) {
    this.strings?.port.postMessage({ type: "params", values });
  }

  strikePiano(id: number, freq: number, opts: { gain: number; pan: number; params: PianoParams }) {
    this.piano?.port.postMessage({ type: "on", id, freq, gain: opts.gain, pan: opts.pan, params: opts.params });
  }

  dampPiano(id: number) {
    this.piano?.port.postMessage({ type: "off", id });
  }

  setPianoVoice(id: number, values: Partial<PianoParams>) {
    this.piano?.port.postMessage({ type: "set", id, values });
  }

  setPianoParams(values: Partial<PianoParams>) {
    this.piano?.port.postMessage({ type: "params", values });
  }

  pianoAllOff() {
    this.piano?.port.postMessage({ type: "allOff" });
  }

  setBodyParams(values: Partial<{ size: number; decay: number; mix: number; tone: number; width: number }>) {
    this.body?.port.postMessage({ type: "params", values });
  }
}
