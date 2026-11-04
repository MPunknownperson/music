"use client";

import { useEffect, useRef } from "react";
import type { MusicEngine } from "@/engine/music/audio";

/** Flat spectrum bars driven by the engine's analyser. */
export default function Visualizer({ engine, className = "", color = "#ff7a29" }: { engine: MusicEngine; className?: string; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const draw = () => {
      const c = ref.current;
      const an = engine.analyserNode;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth * dpr;
        const h = c.clientHeight * dpr;
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const g = c.getContext("2d");
        if (g) {
          g.clearRect(0, 0, w, h);
          const bars = 48;
          const bw = w / bars;
          if (an) {
            if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
            an.getByteFrequencyData(data);
          }
          for (let i = 0; i < bars; i++) {
            // Log-spaced bins so bass and treble get equal room.
            const idx = data ? Math.floor(Math.pow(i / bars, 2) * data.length * 0.5) : 0;
            const v = data ? data[idx] / 255 : 0;
            const bh = Math.max(2 * dpr, v * h);
            g.fillStyle = i % 2 ? color : `${color}cc`;
            g.fillRect(i * bw + 1, h - bh, bw - 2, bh);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, color]);

  return <canvas ref={ref} className={`block h-12 w-full ${className}`} />;
}
