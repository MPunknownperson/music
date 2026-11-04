"use client";

/**
 * One AudioContext for the whole app, shared with Howler.
 *
 * Howler owns the cross-platform unlock dance (iOS silent-buffer unlock, the
 * Android/Chrome autoplay gesture, the HTML5 audio pool). We hand it our
 * context so every voice — SoundFont, Faust WASM, synths and Howler loops —
 * runs through one graph and one master mute.
 */

type HowlerGlobalLike = {
  ctx: AudioContext;
  masterGain: GainNode;
  usingWebAudio: boolean;
  autoUnlock: boolean;
  autoSuspend: boolean;
  volume: (v?: number) => unknown;
  mute: (m: boolean) => unknown;
};

let ctx: AudioContext | null = null;
let howler: HowlerGlobalLike | null = null;
let unlockBound = false;
let suspendedByUs = false;

export type ContextStatus = "idle" | "starting" | "running" | "suspended" | "blocked" | "unsupported";

const listeners = new Set<(s: ContextStatus) => void>();
let status: ContextStatus = "idle";

function setStatus(s: ContextStatus) {
  if (status === s) return;
  status = s;
  listeners.forEach((l) => l(s));
}

export function onContextStatus(fn: (s: ContextStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function contextStatus(): ContextStatus {
  return status;
}

export function peekContext(): AudioContext | null {
  return ctx;
}

/** iOS reports interruptions through state changes; keep the UI honest. */
function watch(c: AudioContext) {
  c.onstatechange = () => {
    if (c.state === "running") setStatus("running");
    else if (c.state === "suspended") setStatus(suspendedByUs ? "suspended" : "blocked");
    else if (c.state === "closed") setStatus("idle");
  };
  const resume = () => {
    if (c.state !== "running") void c.resume().catch(() => undefined);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !suspendedByUs) resume();
  });
  if (!unlockBound) {
    unlockBound = true;
    // Belt and braces next to Howler's own unlock: any gesture revives audio.
    for (const ev of ["pointerdown", "touchend", "keydown"] as const) {
      window.addEventListener(ev, resume, { passive: true, capture: true });
    }
  }
}

async function bindHowler(c: AudioContext) {
  if (howler) return howler;
  const mod = (await import("howler")) as unknown as { Howler: HowlerGlobalLike };
  const H = mod.Howler;
  const previous = H.ctx;
  H.usingWebAudio = true;
  H.autoUnlock = true;
  // Long background tabs must not kill a held chord.
  H.autoSuspend = false;
  if (previous && previous !== c) {
    try {
      void previous.suspend();
    } catch {
      /* ignore */
    }
  }
  H.ctx = c;
  const master = c.createGain();
  master.gain.value = 1;
  master.connect(c.destination);
  H.masterGain = master;
  howler = H;
  return H;
}

/** Creates/resumes the shared context. Must be called from a user gesture. */
export async function ensureContext(): Promise<AudioContext> {
  if (typeof window === "undefined") throw new Error("Audio is browser-only");
  if (!ctx) {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      setStatus("unsupported");
      throw new Error("Web Audio is not supported in this browser");
    }
    setStatus("starting");
    // "playback" gives iOS a larger, glitch-free buffer; interactive elsewhere.
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    ctx = new Ctor({ latencyHint: ios ? "playback" : "interactive" });
    watch(ctx);
  }
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      setStatus("blocked");
    }
  }
  await bindHowler(ctx);
  setStatus(ctx.state === "running" ? "running" : "blocked");
  return ctx;
}

/** The node every engine output must reach so Howler's mute/volume applies. */
export function masterOutput(): AudioNode {
  return howler ? howler.masterGain : (ctx as AudioContext).destination;
}

export function howlerGlobal(): HowlerGlobalLike | null {
  return howler;
}

export function setSuspended(v: boolean) {
  suspendedByUs = v;
  if (!ctx) return;
  if (v) void ctx.suspend();
  else void ctx.resume();
}

/** A tiny silent buffer keeps iOS hardware awake between phrases. */
export function primeSilence(c: AudioContext) {
  const buf = c.createBuffer(1, 1, c.sampleRate);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start(0);
}
