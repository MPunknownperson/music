"use client";

import { useEffect, useRef } from "react";
import { midiName, pitchClass } from "@/engine/music/theory";

export interface StrikeEvent {
  id: number;
  midi: number;
  vel: number;
  at: number;
  releasedAt: number | null;
  sustained: boolean;
}

const NOTE_HUES = [12, 32, 44, 96, 150, 172, 196, 220, 262, 292, 320, 344];

/**
 * Cross-section of the action: hammers swing up, strings vibrate with an
 * amplitude that follows the real decay, dampers fall when a key is released
 * (unless the pedal holds them off).
 */
export default function PianoAction({
  events,
  pedal,
  lid,
  className = "",
}: {
  events: React.RefObject<StrikeEvent[]>;
  pedal: number;
  lid: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pedalRef = useRef(pedal);
  const lidRef = useRef(lid);
  pedalRef.current = pedal;
  lidRef.current = lid;

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current;
      if (!c) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) {
        c.width = Math.floor(w * dpr);
        c.height = Math.floor(h * dpr);
      }
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now() / 1000;

      // soundboard backdrop
      const bg = g.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#241a12");
      bg.addColorStop(0.55, "#1b1520");
      bg.addColorStop(1, "#121118");
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(242,196,109,0.05)";
      g.lineWidth = 1;
      for (let x = -h; x < w; x += 14) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + h, h);
        g.stroke();
      }

      const list = (events.current ?? []).slice(-7).reverse();
      const rowH = Math.min(34, (h - 26) / Math.max(list.length, 1));
      const left = 54;
      const right = w - 16;

      if (list.length === 0) {
        g.fillStyle = "rgba(245,239,224,0.34)";
        g.font = "500 12px ui-sans-serif, system-ui, sans-serif";
        g.fillText("Play a key — the hammer, string and damper are live.", 16, h / 2);
      }

      list.forEach((e, i) => {
        const y = 16 + i * rowH + rowH / 2;
        const age = now - e.at;
        const released = e.releasedAt !== null;
        const relAge = released ? now - (e.releasedAt as number) : 0;
        const held = e.sustained && pedalRef.current > 0.03;
        const dampTime = held ? 6 : 0.35;
        const decay = Math.exp(-age * (0.55 + (e.midi / 127) * 1.4));
        const dampEnv = released && !held ? Math.exp(-relAge / dampTime) : released ? Math.exp(-relAge / dampTime) : 1;
        const amp = Math.max(0, e.vel * decay * dampEnv);
        const hue = NOTE_HUES[pitchClass(e.midi)];
        const fade = Math.max(0, 1 - i / 8);

        // note label
        g.fillStyle = `hsla(${hue}, 70%, 72%, ${0.35 + fade * 0.6})`;
        g.font = "600 11px ui-monospace, monospace";
        g.fillText(midiName(e.midi), 10, y + 4);

        // string: amplitude follows the envelope, frequency drops with pitch
        const cycles = 3 + (127 - e.midi) / 14;
        const swing = amp * (rowH * 0.34);
        g.beginPath();
        for (let x = left; x <= right; x += 2) {
          const u = (x - left) / (right - left);
          const env = Math.sin(Math.PI * u);
          const yy = y + Math.sin(u * Math.PI * cycles + now * (14 + e.midi * 0.16)) * swing * env;
          if (x === left) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.strokeStyle = `hsla(${hue}, ${45 + amp * 45}%, ${58 + amp * 22}%, ${0.3 + fade * 0.65})`;
        g.lineWidth = 1 + (1 - e.midi / 127) * 1.8;
        g.stroke();

        // bridge posts
        g.fillStyle = "rgba(242,196,109,0.5)";
        g.fillRect(left - 3, y - 5, 3, 10);
        g.fillRect(right, y - 5, 3, 10);

        // hammer: swings up in the first 70 ms then falls back
        const hx = left + (right - left) * 0.16;
        const swingUp = age < 0.07 ? age / 0.07 : Math.max(0, 1 - (age - 0.07) / 0.18);
        const hy = y + 16 - swingUp * 16;
        g.fillStyle = `rgba(255,122,41,${0.25 + fade * 0.7})`;
        g.beginPath();
        g.ellipse(hx, hy, 5, 3.4, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = `rgba(245,239,224,${0.1 + fade * 0.2})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(hx, hy + 3);
        g.lineTo(hx, y + 18);
        g.stroke();

        // damper: rests on the string once the key is up and the pedal is off
        const dx = left + (right - left) * 0.72;
        const down = released && !held ? Math.min(1, relAge / 0.05) : 0;
        const dy = y - 12 + down * 10;
        g.fillStyle = down > 0.5 ? `rgba(255,77,109,${0.35 + fade * 0.5})` : `rgba(155,152,166,${0.2 + fade * 0.3})`;
        g.fillRect(dx - 6, dy, 12, 4);
      });

      // pedal + lid strip
      const py = h - 9;
      g.fillStyle = "rgba(255,255,255,0.07)";
      g.fillRect(10, py, w - 20, 4);
      g.fillStyle = "#f2c46d";
      g.fillRect(10, py, (w - 20) * pedalRef.current, 4);
      g.fillStyle = "rgba(53,201,176,0.75)";
      g.fillRect(10, py - 6, (w - 20) * lidRef.current, 2);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [events]);

  return <canvas ref={ref} className={`block w-full ${className}`} />;
}
