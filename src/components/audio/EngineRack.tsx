"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getEngine, INSTRUMENT_LABELS, type EngineStatus, type MusicEngine } from "@/engine/music/audio";
import { DEFAULT_MASTER, type MasterSettings } from "@/engine/audio/daw";
import { GM_FAMILIES, GM_NAMES, LOCAL_PROGRAMS, PHYSICAL_PATCHES, SYNTH_PATCHES } from "@/engine/audio/patches";
import type { Instrument } from "@/engine/types";

export function useEngineStatus(engine: MusicEngine): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>(() => engine.status());
  useEffect(() => engine.onStatus(setStatus), [engine]);
  return status;
}

function Fader({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = "",
  scale = 100,
  onChange,
  tone = "sun",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  scale?: number;
  onChange: (v: number) => void;
  tone?: "sun" | "teal" | "maple" | "violet";
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const color = { sun: "#ff7a29", teal: "#35c9b0", maple: "#f2c46d", violet: "#8b7bff" }[tone];
  return (
    <label className="block select-none">
      <span className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-[11px] text-ivory/80">
          {Math.round(value * scale)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        className="rack-slider mt-1 w-full"
        style={{ ["--fill" as string]: `${pct}%`, ["--tone" as string]: color }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}

export function MasterMeter({ engine }: { engine: MusicEngine }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let smooth = -60;
    const loop = () => {
      const db = engine.peakDb();
      smooth = db > smooth ? db : smooth * 0.86 + db * 0.14;
      const pct = Math.max(0, Math.min(100, ((smooth + 60) / 60) * 100));
      if (ref.current) {
        ref.current.style.width = `${pct}%`;
        ref.current.style.background = smooth > -1 ? "#ff4d6d" : smooth > -8 ? "#f2c46d" : "#35c9b0";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel2">
      <div ref={ref} className="h-full w-0 rounded-full transition-[background] duration-150" />
    </div>
  );
}

export function PatchPicker({ engine, inst, label }: { engine: MusicEngine; inst: Instrument; label?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [id, setId] = useState(() => engine.patchId(inst));
  useEffect(() => setId(engine.patchId(inst)), [engine, inst]);
  const patch = engine.patch(inst);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (n: string) => !q || n.toLowerCase().includes(q);
    const gm = GM_FAMILIES.map((f) => ({
      name: f.name,
      items: GM_NAMES.map((n, program) => ({ id: `gm.${program}`, name: n, program }))
        .filter((p) => p.program >= f.from && p.program <= f.to && match(p.name))
        .map((p) => ({ id: p.id, name: p.name, local: LOCAL_PROGRAMS.has(p.program) })),
    })).filter((g) => g.items.length > 0);
    return [
      { name: "Physical models (WASM)", items: PHYSICAL_PATCHES.filter((p) => match(p.name)).map((p) => ({ id: p.id, name: p.name, local: true })) },
      { name: "Synths", items: SYNTH_PATCHES.filter((p) => match(p.name)).map((p) => ({ id: p.id, name: p.name, local: true })) },
      ...gm,
    ].filter((g) => g.items.length > 0);
  }, [query]);

  const choose = (next: string) => {
    engine.setPatch(inst, next);
    setId(next);
    setOpen(false);
    void engine.ensure();
  };

  return (
    <div className="relative">
      <button className="btn w-full justify-between" onClick={() => setOpen(!open)}>
        <span className="truncate">
          <span className="mr-1.5 text-[10px] uppercase tracking-wider text-muted">{label ?? INSTRUMENT_LABELS[inst]}</span>
          {patch.name}
        </span>
        <span className={`ml-2 h-2 w-2 flex-none rounded-full ${patch.source === "faust" ? "bg-violet" : patch.source === "sample" ? "bg-teal" : "bg-maple"}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
            <input
              autoFocus
              className="w-full border-b border-line bg-panel2 px-3 py-2 text-sm outline-none"
              placeholder="Search 130+ instruments…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="rack-scroll max-h-64 overflow-y-auto p-1">
              {groups.map((g) => (
                <div key={g.name}>
                  <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted">{g.name}</p>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => choose(it.id)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel2 ${
                        id === it.id ? "text-sun" : "text-ivory/90"
                      }`}
                    >
                      {it.name}
                      {!it.local && <span className="text-[9px] text-muted">stream</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function EngineRack({
  engine = getEngine(),
  slots = [],
  title = "Master rack",
}: {
  engine?: MusicEngine;
  slots?: Instrument[];
  title?: string;
}) {
  const [m, setM] = useState<MasterSettings>(() => engine.master);
  const status = useEngineStatus(engine);
  const [muted, setMuted] = useState(false);

  const set = (patch: Partial<MasterSettings>) => setM(engine.setMaster(patch));

  const randomize = () => {
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    set({
      reverb: r(0.08, 0.5),
      roomSize: r(0.2, 0.9),
      body: r(0.1, 0.6),
      chorus: r(0, 0.4),
      delay: Math.random() < 0.5 ? 0 : r(0.05, 0.3),
      drive: r(0, 0.4),
      bass: r(-3, 5),
      treble: r(-3, 5),
      width: r(0.3, 1),
      glue: r(0.1, 0.7),
    });
  };

  return (
    <section className="panel p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="label mr-auto">{title}</p>
        <span className="flex items-center gap-1.5 rounded-full bg-panel2 px-2 py-1 text-[10px] font-semibold text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${status.faust === "ready" ? "bg-violet" : status.faust === "loading" ? "bg-maple" : "bg-line"}`} />
          Faust WASM {status.faust === "ready" ? "live" : status.faust === "loading" ? "loading" : "off"}
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-panel2 px-2 py-1 text-[10px] font-semibold text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${status.samples > 0 ? "bg-teal" : "bg-line"}`} />
          SoundFonts {status.loading.length > 0 ? "loading…" : status.samples}
        </span>
        <button
          className={`btn px-3 py-1.5 text-xs ${muted ? "btn-rose" : "btn-teal"}`}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            engine.setMuted(next);
            void engine.ensure();
          }}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
      </div>

      {slots.length > 0 && (
        <div className={`mb-3 grid gap-2 ${slots.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {slots.map((s) => (
            <PatchPicker key={s} engine={engine} inst={s} />
          ))}
        </div>
      )}

      <div className="mb-3">
        <MasterMeter engine={engine} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        <Fader label="Volume" value={m.volume} min={0} max={1} onChange={(v) => set({ volume: v })} />
        <Fader label="Room" value={m.reverb} min={0} max={0.8} tone="teal" onChange={(v) => set({ reverb: v })} />
        <Fader label="Room size" value={m.roomSize} min={0} max={1} tone="teal" onChange={(v) => set({ roomSize: v })} />
        <Fader label="Body resonance" value={m.body} min={0} max={1} tone="violet" onChange={(v) => set({ body: v })} />
        <Fader label="Delay" value={m.delay} min={0} max={0.6} tone="maple" onChange={(v) => set({ delay: v })} />
        <Fader label="Chorus" value={m.chorus} min={0} max={0.6} tone="maple" onChange={(v) => set({ chorus: v })} />
        <Fader label="Drive" value={m.drive} min={0} max={0.8} onChange={(v) => set({ drive: v })} />
        <Fader label="Width" value={m.width} min={0} max={1} tone="violet" onChange={(v) => set({ width: v })} />
        <Fader label="Bass" value={m.bass} min={-12} max={12} step={0.5} scale={1} unit=" dB" tone="teal" onChange={(v) => set({ bass: v })} />
        <Fader label="Air" value={m.treble} min={-12} max={12} step={0.5} scale={1} unit=" dB" tone="teal" onChange={(v) => set({ treble: v })} />
        <Fader label="Glue comp" value={m.glue} min={0} max={1} onChange={(v) => set({ glue: v })} />
        <div className="flex items-end gap-2 pb-1">
          <button className={`btn flex-1 px-2 py-1.5 text-xs ${m.limiter ? "btn-on" : ""}`} onClick={() => set({ limiter: !m.limiter })}>
            Limiter
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn px-3 py-1.5 text-xs" onClick={() => setM(engine.resetMaster())}>
          Reset rack
        </button>
        <button className="btn px-3 py-1.5 text-xs" onClick={randomize}>
          Randomise tone
        </button>
        <button
          className="btn px-3 py-1.5 text-xs"
          onClick={() => set({ ...DEFAULT_MASTER, volume: m.volume })}
        >
          Neutral mix
        </button>
        <span className="self-center text-[11px] text-muted">{status.message}</span>
      </div>
    </section>
  );
}
