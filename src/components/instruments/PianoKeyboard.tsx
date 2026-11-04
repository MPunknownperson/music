"use client";

import { useMemo, useRef } from "react";
import { isBlackKey, midiName, pitchClass } from "@/engine/music/theory";

export interface PianoKeyboardProps {
  from: number;
  to: number;
  active: Set<number>;
  /** Pitch classes to tint (scale/chord). */
  highlight?: number[];
  rootPc?: number;
  onDown?: (midi: number, vel: number) => void;
  onUp?: (midi: number) => void;
  keyLabel?: (midi: number) => string | null;
  showNames?: boolean;
  height?: number;
  className?: string;
}

/**
 * Flat-design piano keyboard. Pointer events support multi-touch chords,
 * sliding glissandi and velocity from where the key is struck (closer to
 * the front edge = louder, like a real key's leverage).
 */
export default function PianoKeyboard({
  from,
  to,
  active,
  highlight,
  rootPc,
  onDown,
  onUp,
  keyLabel,
  showNames = true,
  height = 200,
  className = "",
}: PianoKeyboardProps) {
  const pointers = useRef(new Map<number, number>());

  const { whites, blacks } = useMemo(() => {
    const w: number[] = [];
    const b: { midi: number; whiteIndex: number }[] = [];
    for (let m = from; m <= to; m++) {
      if (isBlackKey(m)) b.push({ midi: m, whiteIndex: w.length });
      else w.push(m);
    }
    return { whites: w, blacks: b };
  }, [from, to]);

  const ww = 100 / whites.length;
  const hl = new Set(highlight ?? []);

  const keyAt = (x: number, y: number): { midi: number; vel: number } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest<HTMLElement>("[data-midi]");
    if (!k) return null;
    const r = k.getBoundingClientRect();
    const depth = Math.min(1, Math.max(0, (y - r.top) / r.height));
    return { midi: Number(k.dataset.midi), vel: 0.45 + depth * 0.55 };
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const k = keyAt(e.clientX, e.clientY);
    if (!k) return;
    pointers.current.set(e.pointerId, k.midi);
    onDown?.(k.midi, k.vel);
  };
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const k = keyAt(e.clientX, e.clientY);
    const prev = pointers.current.get(e.pointerId);
    if (!k || k.midi === prev) return;
    if (prev !== undefined) onUp?.(prev);
    pointers.current.set(e.pointerId, k.midi);
    onDown?.(k.midi, k.vel * 0.85);
  };
  const up = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (prev !== undefined) onUp?.(prev);
  };

  return (
    <div
      className={`relative select-none overflow-hidden rounded-xl bg-ebony p-1.5 pt-3 ${className}`}
      style={{ height, touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* felt strip */}
      <div className="absolute inset-x-0 top-0 h-1.5 bg-rose/80" />
      <div className="relative flex h-full gap-[2px]">
        {whites.map((m) => {
          const on = active.has(m);
          const inHl = hl.has(pitchClass(m));
          const isRoot = rootPc !== undefined && pitchClass(m) === rootPc;
          const lbl = keyLabel?.(m);
          return (
            <div
              key={m}
              data-midi={m}
              className={`relative flex flex-1 flex-col items-center justify-end rounded-b-md pb-1.5 transition-colors ${
                on ? "bg-sun" : inHl ? (isRoot ? "bg-maple" : "bg-[#efe3c4]") : "bg-ivory"
              }`}
            >
              {lbl && <span className="mb-1 rounded bg-ebony/10 px-1 font-mono text-[10px] text-ebony/70">{lbl}</span>}
              {showNames && (
                <span className={`text-[10px] font-semibold ${on ? "text-ebony" : "text-ebony/50"}`}>
                  {pitchClass(m) === 0 ? midiName(m) : midiName(m).replace(/-?\d+$/, "")}
                </span>
              )}
            </div>
          );
        })}
        {blacks.map(({ midi, whiteIndex }) => {
          const on = active.has(midi);
          const inHl = hl.has(pitchClass(midi));
          const isRoot = rootPc !== undefined && pitchClass(midi) === rootPc;
          const lbl = keyLabel?.(midi);
          return (
            <div
              key={midi}
              data-midi={midi}
              className={`absolute top-0 z-10 flex h-[60%] flex-col items-center justify-end rounded-b-md pb-1 transition-colors ${
                on ? "bg-sun" : inHl ? (isRoot ? "bg-maple" : "bg-[#5b4a2a]") : "bg-[#24222b]"
              }`}
              style={{ left: `calc(${whiteIndex * ww}% - ${ww * 0.31}%)`, width: `${ww * 0.62}%` }}
            >
              {lbl && <span className="font-mono text-[9px] text-ivory/70">{lbl}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
