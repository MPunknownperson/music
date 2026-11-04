"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import PianoKeyboard from "@/components/instruments/PianoKeyboard";
import { getEngine, type Voice } from "@/engine/music/audio";
import { PIANO_PRESETS } from "@/engine/audio/piano";
import { detectChord } from "@/lib/chords";

/** The home page is playable: a real modelled piano, not a picture of one. */
export default function HeroInstrument() {
  const engine = useMemo(() => getEngine(), []);
  const [active, setActive] = useState<Set<number>>(new Set());
  const [preset, setPreset] = useState(0);
  const [touched, setTouched] = useState(false);
  const voices = useRef(new Map<number, Voice>());
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const loop = () => {
      const an = engine.analyserNode;
      const host = barsRef.current;
      if (an && host) {
        if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
        an.getByteFrequencyData(data);
        const kids = host.children;
        for (let i = 0; i < kids.length; i++) {
          const idx = Math.floor(Math.pow(i / kids.length, 1.8) * data.length * 0.45);
          const v = data[idx] / 255;
          (kids[i] as HTMLElement).style.height = `${8 + v * 88}%`;
          (kids[i] as HTMLElement).style.opacity = `${0.35 + v * 0.65}`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  useEffect(() => () => {
    voices.current.forEach((v) => v.release());
    voices.current.clear();
  }, []);

  const down = (midi: number, vel: number) => {
    setTouched(true);
    const fire = () => {
      voices.current.get(midi)?.release();
      voices.current.set(midi, engine.strikeKey(midi, Math.max(0.15, vel)));
      setActive((s) => new Set(s).add(midi));
    };
    if (engine.context) fire();
    else void engine.ensure().then(fire);
  };
  const up = (midi: number) => {
    voices.current.get(midi)?.release();
    voices.current.delete(midi);
    setActive((s) => {
      const n = new Set(s);
      n.delete(midi);
      return n;
    });
  };

  const cyclePreset = () => {
    const next = (preset + 1) % PIANO_PRESETS.length;
    setPreset(next);
    engine.loadPianoPreset(PIANO_PRESETS[next].id);
    void engine.ensure();
  };

  return (
    <div className="rise-in relative overflow-hidden rounded-3xl border border-line bg-panel p-4 sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, #ff7a29 0%, transparent 70%)" }}
      />
      <div className="relative mb-4 space-y-[9px] rounded-2xl bg-[#3a2418] p-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="relative">
            <div className={active.size > 0 ? "string-live bg-[#e3dccb]" : "bg-[#e3dccb]"} style={{ height: 1 + i * 0.6 }} />
            {i === 1 && <span className="absolute -top-2.5 left-[30%] h-5 w-5 rounded-full bg-sun" />}
            {i === 3 && <span className="absolute -top-2.5 left-[46%] h-5 w-5 rounded-full bg-maple" />}
            {i === 4 && <span className="absolute -top-2.5 left-[46%] h-5 w-5 rounded-full bg-teal" />}
          </div>
        ))}
      </div>

      <div className="relative">
        <PianoKeyboard
          from={60}
          to={79}
          active={active}
          onDown={down}
          onUp={up}
          height={132}
          showNames={false}
        />
        {!touched && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="animate-pulse rounded-full bg-ebony/80 px-3 py-1 text-[11px] font-semibold text-ivory">
              Play me — every note is a live string simulation
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button className="btn px-3 py-1.5 text-xs" onClick={cyclePreset}>
          {PIANO_PRESETS[preset].name} ↻
        </button>
        <span className="font-mono text-sm text-sun">{detectChord([...active]) ?? "—"}</span>
        <div ref={barsRef} className="ml-auto flex h-8 w-32 items-end gap-[2px] sm:w-44">
          {Array.from({ length: 22 }, (_, i) => (
            <span
              key={i}
              className={`flex-1 rounded-sm ${i % 3 === 0 ? "bg-teal" : i % 3 === 1 ? "bg-sun" : "bg-maple"}`}
              style={{ height: "8%" }}
            />
          ))}
        </div>
      </div>
      <Link href="/piano" className="mt-3 inline-block text-xs font-bold text-teal hover:underline">
        Open the piano workbench — 18 live controls →
      </Link>
    </div>
  );
}
