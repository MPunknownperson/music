"use client";

import { LOCAL_PROGRAMS } from "./patches";

/**
 * WebAudioFont: SoundFonts converted to JavaScript so hundreds of realistic
 * instrument timbres load straight into the Web Audio graph. A curated set is
 * vendored under /public/soundfonts; any other GM program streams from the
 * WebAudioFont CDN on demand.
 */

const CDN = "https://surikov.github.io/webaudiofontdata/sound/";
const LOCAL = "/soundfonts/";

interface WafEnvelope {
  cancel?: () => void;
  when: number;
  duration: number;
}

interface WafPlayer {
  loader: {
    decodeAfterLoading: (ctx: BaseAudioContext, name: string) => void;
    waitLoad: (cb: () => void) => void;
    startLoad: (ctx: BaseAudioContext, url: string, name: string) => void;
  };
  queueWaveTable: (
    ctx: BaseAudioContext,
    target: AudioNode,
    preset: unknown,
    when: number,
    pitch: number,
    volume: number,
    duration: number,
    slides?: unknown[],
    info?: unknown,
  ) => WafEnvelope;
  cancelQueue: (ctx: BaseAudioContext) => void;
  adjustPreset: (ctx: BaseAudioContext, preset: unknown) => void;
}

declare global {
  interface Window {
    WebAudioFontPlayer?: new () => WafPlayer;
    WebAudioFontReverberator?: new (ctx: BaseAudioContext) => { input: AudioNode; output: AudioNode };
  }
}

let manifest: { melodic: Record<string, string>; drums: Record<string, string> } | null = null;
let player: WafPlayer | null = null;
let playerPromise: Promise<WafPlayer> | null = null;
const presets = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-waf="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("load failed")));
      }
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.waf = src;
    el.onload = () => {
      el.dataset.loaded = "1";
      resolve();
    };
    el.onerror = () => {
      el.remove();
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(el);
  });
}

export async function getPlayer(): Promise<WafPlayer> {
  if (player) return player;
  if (!playerPromise) {
    playerPromise = (async () => {
      await loadScript(`${LOCAL}WebAudioFontPlayer.js`);
      if (!window.WebAudioFontPlayer) throw new Error("WebAudioFont player unavailable");
      player = new window.WebAudioFontPlayer();
      return player;
    })();
  }
  return playerPromise;
}

async function getManifest() {
  if (manifest) return manifest;
  try {
    const res = await fetch(`${LOCAL}manifest.json`);
    manifest = (await res.json()) as typeof manifest;
  } catch {
    manifest = { melodic: {}, drums: {} };
  }
  return manifest!;
}

function varName(file: string) {
  return `_tone_${file.replace(/\.js$/, "")}`;
}

async function loadTone(ctx: BaseAudioContext, key: string, file: string, local: boolean): Promise<unknown> {
  const name = varName(file);
  const w = window as unknown as Record<string, unknown>;
  const p = await getPlayer();
  if (!w[name]) {
    await loadScript(`${local ? LOCAL : CDN}${file}.js`);
  }
  const preset = w[name];
  if (!preset) throw new Error(`Preset ${file} missing`);
  p.loader.decodeAfterLoading(ctx, name);
  await new Promise<void>((resolve) => p.loader.waitLoad(() => resolve()));
  presets.set(key, preset);
  return preset;
}

/** Loads (and decodes) a GM program. Falls back to the nearest local program. */
export async function loadProgram(ctx: BaseAudioContext, program: number): Promise<unknown> {
  const key = `gm.${program}`;
  const cached = presets.get(key);
  if (cached) return cached;
  const running = pending.get(key);
  if (running) return running;
  const job = (async () => {
    const man = await getManifest();
    const localFile = man.melodic[String(program)];
    if (localFile) return loadTone(ctx, key, localFile, true);
    const padded = String(program).padStart(3, "0") + "0";
    try {
      return await loadTone(ctx, key, `${padded}_FluidR3_GM_sf2_file`, false);
    } catch {
      // Offline or CDN blocked: use the closest vendored timbre.
      const near = [...LOCAL_PROGRAMS].sort((a, b) => Math.abs(a - program) - Math.abs(b - program))[0] ?? 0;
      const file = man.melodic[String(near)];
      if (!file) throw new Error("No SoundFont available");
      const preset = await loadTone(ctx, `gm.${near}`, file, true);
      presets.set(key, preset);
      return preset;
    }
  })();
  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}

export async function loadDrum(ctx: BaseAudioContext, midi: number): Promise<unknown | null> {
  const key = `drum.${midi}`;
  const cached = presets.get(key);
  if (cached) return cached;
  const man = await getManifest();
  const file = man.drums[String(midi)];
  if (!file) return null;
  try {
    return await loadTone(ctx, key, file, true);
  } catch {
    return null;
  }
}

export interface SampleVoiceOptions {
  when: number;
  duration: number;
  velocity: number;
  detune?: number;
}

/** Starts a sampled note; the returned handle releases it. */
export async function startSample(
  ctx: BaseAudioContext,
  dest: AudioNode,
  program: number,
  midi: number,
  opts: SampleVoiceOptions,
): Promise<{ stop: (at?: number) => void } | null> {
  const preset = await loadProgram(ctx, program);
  const p = await getPlayer();
  const env = p.queueWaveTable(
    ctx,
    dest,
    preset,
    Math.max(opts.when, ctx.currentTime),
    midi,
    opts.velocity,
    opts.duration,
  );
  return {
    stop: () => {
      try {
        env.cancel?.();
      } catch {
        /* already gone */
      }
    },
  };
}

export async function startDrumSample(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midi: number,
  when: number,
  velocity: number,
): Promise<boolean> {
  const preset = await loadDrum(ctx, midi);
  if (!preset) return false;
  const p = await getPlayer();
  p.queueWaveTable(ctx, dest, preset, Math.max(when, ctx.currentTime), midi, velocity, 3);
  return true;
}

export function loadedCount(): number {
  return presets.size;
}
