"use client";

import type { MusicEngine } from "../music/audio";
import { encodeWav } from "./eko";

/**
 * Howler-backed loop player. Rendered bounces become Howl sprites so looping
 * is sample-accurate and gapless on iOS/Android, with fades and stereo/spatial
 * placement that the raw Web Audio graph cannot guarantee across browsers.
 */
export class HowlLoop {
  private howl: import("howler").Howl | null = null;
  private url: string | null = null;
  private id: number | null = null;
  playing = false;
  durationSec = 0;

  async load(buffer: AudioBuffer): Promise<void> {
    this.dispose();
    const { Howl } = await import("howler");
    this.url = URL.createObjectURL(encodeWav(buffer));
    this.durationSec = buffer.duration;
    await new Promise<void>((resolve, reject) => {
      const h = new Howl({
        src: [this.url!],
        format: ["wav"],
        html5: false,
        loop: true,
        volume: 0,
        preload: true,
        onload: () => resolve(),
        onloaderror: (_id, err) => reject(new Error(String(err))),
      });
      this.howl = h;
    });
  }

  play(fadeMs = 600, volume = 0.9) {
    if (!this.howl) return;
    if (this.id === null) this.id = this.howl.play();
    else this.howl.play(this.id);
    this.howl.fade(0, volume, fadeMs, this.id ?? undefined);
    this.playing = true;
  }

  pause(fadeMs = 400) {
    if (!this.howl || this.id === null) return;
    const id = this.id;
    this.howl.fade(this.howl.volume(id) as number, 0, fadeMs, id);
    window.setTimeout(() => {
      if (!this.playing) this.howl?.pause(id);
    }, fadeMs + 20);
    this.playing = false;
  }

  setVolume(v: number, fadeMs = 120) {
    if (!this.howl || this.id === null) return;
    this.howl.fade(this.howl.volume(this.id) as number, v, fadeMs, this.id);
  }

  /** -1 (left) .. 1 (right) */
  setPan(pan: number) {
    if (!this.howl || this.id === null) return;
    this.howl.stereo(Math.max(-1, Math.min(1, pan)), this.id);
  }

  setRate(rate: number) {
    if (!this.howl || this.id === null) return;
    this.howl.rate(Math.max(0.5, Math.min(2, rate)), this.id);
  }

  seek(): number {
    if (!this.howl || this.id === null) return 0;
    const s = this.howl.seek(this.id);
    return typeof s === "number" ? s : 0;
  }

  dispose() {
    this.howl?.unload();
    this.howl = null;
    this.id = null;
    this.playing = false;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

/** Bounces the current pattern and returns a ready-to-play seamless loop. */
export async function bounceToLoop(
  engine: MusicEngine,
  pattern: Parameters<MusicEngine["bounce"]>[0],
  onProgress?: (p: number) => void,
): Promise<HowlLoop> {
  const buffer = await engine.bounce(pattern, 1, onProgress);
  const loop = new HowlLoop();
  await loop.load(buffer);
  return loop;
}
