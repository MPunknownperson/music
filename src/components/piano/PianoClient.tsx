"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PianoKeyboard from "@/components/instruments/PianoKeyboard";
import PianoAction, { type StrikeEvent } from "@/components/piano/PianoAction";
import EngineRack, { useEngineStatus } from "@/components/audio/EngineRack";
import InputStatus from "@/components/ui/InputStatus";
import Visualizer from "@/components/ui/Visualizer";
import { getEngine, type Voice } from "@/engine/music/audio";
import {
  DEFAULT_PIANO,
  PIANO_PRESETS,
  mapVelocity,
  pianoPreset,
  stretchCents,
  velocityLabel,
  type PianoSettings,
} from "@/engine/audio/piano";
import {
  CHORD_QUALITIES,
  NOTE_NAMES,
  SCALE_LABELS,
  SCALE_NAMES,
  buildChord,
  chordAt,
  midiName,
  pitchClass,
  scaleMidi,
  scalePitchClasses,
} from "@/engine/music/theory";
import type { Pattern, ScaleName } from "@/engine/types";
import { PAD, useGamepad } from "@/hooks/useGamepad";
import { keyLabelFor, useNoteKeyboard } from "@/hooks/useNoteKeyboard";
import { detectChord } from "@/lib/chords";
import { newSong, STEPS_PER_BEAT, type StudioNote } from "@/lib/song";
import { saveSong } from "@/lib/store";
import { audioBufferToWav, download, slug } from "@/lib/export";

interface TakeNote {
  midi: number;
  start: number;
  dur: number;
  vel: number;
}

function useSpan(): number {
  const [span, setSpan] = useState(2);
  useEffect(() => {
    const f = () => setSpan(window.innerWidth < 640 ? 1 : window.innerWidth < 1100 ? 2 : 3);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return span;
}

function Dial({
  label,
  hint,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  tone = "#ff7a29",
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  tone?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block select-none" title={hint}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="label truncate">{label}</span>
        <span className="font-mono text-[11px] text-ivory/85">{format ? format(value) : Math.round(value * 100)}</span>
      </span>
      <input
        type="range"
        className="rack-slider mt-1 w-full"
        style={{ ["--fill" as string]: `${pct}%`, ["--tone" as string]: tone }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel2/50 p-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sun">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
    </div>
  );
}

export default function PianoClient() {
  const engine = useMemo(() => getEngine(), []);
  const router = useRouter();
  const span = useSpan();
  const status = useEngineStatus(engine);

  const [settings, setSettings] = useState<PianoSettings>(() => engine.piano);
  const [presetId, setPresetId] = useState(() => engine.pianoPreset);
  const [mode, setMode] = useState<"model" | "sample">(() => engine.engineMode);
  const [base, setBase] = useState(48);
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [pedal, setPedal] = useState(0);
  const [pedalLatch, setPedalLatch] = useState(false);
  const [vel, setVel] = useState(0.75);
  const [rootPc, setRootPc] = useState(0);
  const [scale, setScale] = useState<ScaleName>("major");
  const [showScale, setShowScale] = useState(false);
  const [chordMode, setChordMode] = useState("note");
  const [showKeys, setShowKeys] = useState(true);
  const [bpm, setBpm] = useState(92);
  const [metro, setMetro] = useState(false);
  const [recording, setRecording] = useState(false);
  const [take, setTake] = useState<TakeNote[]>([]);
  const [last, setLast] = useState<{ midi: number; vel: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const voices = useRef(new Map<string, { v: Voice[]; notes: number[]; ids: number[] }>());
  const events = useRef<StrikeEvent[]>([]);
  const nextEvent = useRef(1);
  const recStart = useRef(0);
  const recOpen = useRef(new Map<string, TakeNote[]>());
  const takeRef = useRef<TakeNote[]>([]);
  const pedalRef = useRef(0);
  pedalRef.current = pedal;

  const top = base + span * 12;
  const active = useMemo(() => new Set([...counts.entries()].filter(([, c]) => c > 0).map(([m]) => m)), [counts]);
  const chordLabel = detectChord([...active]);
  const scalePcs = scalePitchClasses(rootPc, scale);

  useEffect(() => {
    // Load the models on the first gesture so the very first note is instant,
    // without creating a blocked AudioContext on page load.
    const go = () => void engine.ensure();
    window.addEventListener("pointerdown", go, { once: true });
    window.addEventListener("keydown", go, { once: true });
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, [engine]);

  useEffect(() => {
    engine.setMetronome(metro);
  }, [engine, metro]);

  useEffect(() => {
    return () => {
      voices.current.forEach((v) => v.v.forEach((x) => x.release()));
      engine.allNotesOff();
      engine.stop();
    };
  }, [engine]);

  const bump = (notes: number[], d: number) =>
    setCounts((prev) => {
      const next = new Map(prev);
      for (const n of notes) next.set(n, Math.max(0, (next.get(n) ?? 0) + d));
      return next;
    });

  const setP = useCallback(
    (patch: Partial<PianoSettings>, preset = "custom") => {
      const next = engine.setPiano(patch, preset);
      setSettings(next);
      setPresetId(preset);
    },
    [engine],
  );

  const applyPreset = (id: string) => {
    const next = engine.loadPianoPreset(id);
    setSettings(next);
    setPresetId(id);
    void engine.ensure();
  };

  const expand = useCallback(
    (midi: number): number[] => {
      if (chordMode === "note") return [midi];
      if (chordMode === "diatonic") {
        const deg = scalePcs.indexOf(pitchClass(midi));
        if (deg < 0) return [midi];
        const c = chordAt(48 + rootPc, scale, deg);
        return c.map((n) => n - c[0] + midi);
      }
      if (chordMode === "octaves") return [midi - 12, midi, midi + 12];
      return buildChord(midi, chordMode);
    },
    [chordMode, scalePcs, rootPc, scale],
  );

  const strike = useCallback(
    (key: string, midi: number, velocity: number) => {
      const notes = expand(midi);
      const fire = () => {
        const old = voices.current.get(key);
        if (old) old.v.forEach((x) => x.release());
        const vs: Voice[] = [];
        const ids: number[] = [];
        notes.forEach((n, i) => {
          vs.push(engine.strikeKey(n, velocity, { pan: undefined, dur: 24, strum: i * 0.004 }));
          const id = nextEvent.current++;
          ids.push(id);
          events.current.push({ id, midi: n, vel: velocity, at: performance.now() / 1000, releasedAt: null, sustained: false });
        });
        if (events.current.length > 40) events.current.splice(0, events.current.length - 40);
        voices.current.set(key, { v: vs, notes, ids });
        bump(notes, 1);
        setLast({ midi, vel: velocity });
        if (recording) {
          const now = engine.now() - recStart.current;
          const tn = notes.map((n) => ({ midi: n, start: now, dur: 0.25, vel: velocity }));
          recOpen.current.set(key, tn);
          takeRef.current.push(...tn);
        }
      };
      if (engine.context) fire();
      else void engine.ensure().then(fire);
    },
    [engine, expand, recording],
  );

  const release = useCallback(
    (key: string) => {
      const entry = voices.current.get(key);
      if (!entry) return;
      entry.v.forEach((x) => x.release());
      const now = performance.now() / 1000;
      for (const id of entry.ids) {
        const e = events.current.find((x) => x.id === id);
        if (e) {
          e.releasedAt = now;
          e.sustained = pedalRef.current > 0.03;
        }
      }
      voices.current.delete(key);
      bump(entry.notes, -1);
      const open = recOpen.current.get(key);
      if (open) {
        const t = engine.now() - recStart.current;
        for (const n of open) n.dur = Math.max(0.05, t - n.start);
        recOpen.current.delete(key);
        setTake([...takeRef.current]);
      }
    },
    [engine],
  );

  const applyPedal = useCallback(
    (v: number) => {
      setPedal(v);
      engine.setPedal(v);
    },
    [engine],
  );

  const shift = (d: number) => setBase((b) => Math.max(21, Math.min(96 - span * 12, b + d * 12)));

  useNoteKeyboard({
    base,
    onNoteOn: (m, code) => strike(`k:${code}`, m, vel),
    onNoteOff: (_m, code) => release(`k:${code}`),
    onOtherKey: (e, down) => {
      if (e.code === "Space") {
        if (!e.repeat && !pedalLatch) applyPedal(down ? 1 : 0);
        return true;
      }
      if (!down) return false;
      if (e.code === "ArrowLeft") return shift(-1), true;
      if (e.code === "ArrowRight") return shift(1), true;
      if (e.code === "ArrowUp") return setVel((v) => Math.min(1, +(v + 0.08).toFixed(2))), true;
      if (e.code === "ArrowDown") return setVel((v) => Math.max(0.08, +(v - 0.08).toFixed(2))), true;
      if (e.code === "Enter") {
        setPedalLatch((l) => {
          applyPedal(l ? 0 : 1);
          return !l;
        });
        return true;
      }
      return false;
    },
  });

  const padScale = scaleMidi(base + 12 + rootPc - (rootPc > 6 ? 12 : 0), scale, 2);
  const PAD_NOTES = [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.LB, PAD.RB, PAD.LT, PAD.RT];
  const { connected } = useGamepad({
    onButton: (i, pressed, value) => {
      const idx = PAD_NOTES.indexOf(i as (typeof PAD_NOTES)[number]);
      if (idx >= 0) {
        if (pressed) strike(`g:${i}`, padScale[idx], i >= 6 ? 0.25 + value * 0.75 : vel);
        else release(`g:${i}`);
        return;
      }
      if (i === PAD.LS || i === PAD.RS) return applyPedal(pressed ? 1 : 0);
      if (!pressed) return;
      if (i === PAD.UP) shift(1);
      else if (i === PAD.DOWN) shift(-1);
      else if (i === PAD.START) toggleRecord();
      else if (i === PAD.BACK) playTake();
    },
  });

  function toggleRecord() {
    if (recording) {
      setRecording(false);
      setTake([...takeRef.current]);
      engine.stop();
      return;
    }
    void engine.ensure().then(async () => {
      takeRef.current = [];
      setTake([]);
      setRecording(true);
      if (metro) await engine.start(bpm);
      recStart.current = engine.now() + (metro ? 0.15 : 0);
    });
  }

  const takePattern = useCallback((): Pattern => {
    const spb = 60 / bpm;
    const evs = takeRef.current.map((n) => ({
      beat: n.start / spb,
      midi: [n.midi],
      dur: n.dur / spb,
      vel: n.vel,
      inst: "piano" as const,
      role: "melody" as const,
    }));
    const end = evs.reduce((m, e) => Math.max(m, e.beat + e.dur), 0);
    return { name: "Piano take", bpm, lengthBeats: Math.max(4, Math.ceil(end / 4) * 4), events: evs };
  }, [bpm]);

  function playTake() {
    if (takeRef.current.length === 0) return;
    const was = metro;
    engine.setMetronome(false);
    void engine.playPattern(takePattern()).then(() => engine.setMetronome(was));
  }

  function sendToStudio() {
    const p = takePattern();
    const song = newSong("Piano take");
    song.bpm = bpm;
    song.root = 48 + rootPc;
    song.scale = scale;
    song.bars = Math.min(16, Math.max(1, Math.ceil(p.lengthBeats / 4)));
    const notes: StudioNote[] = p.events.map((e) => ({
      step: Math.round(e.beat * STEPS_PER_BEAT),
      midi: e.midi[0],
      len: Math.max(1, Math.round(e.dur * STEPS_PER_BEAT)),
      vel: e.vel,
    }));
    song.tracks[0] = { ...song.tracks[0], inst: "piano", notes };
    saveSong(song);
    router.push(`/studio?song=${song.id}`);
  }

  /** A short musical phrase that shows the instrument off, rendered to WAV. */
  async function renderDemo() {
    setBusy("Rendering");
    try {
      const degrees = [0, 3, 4, 0];
      const evs: Pattern["events"] = [];
      degrees.forEach((d, bar) => {
        const chord = chordAt(48 + rootPc, scale, d);
        chord.forEach((m) => evs.push({ beat: bar * 4, midi: [m], dur: 3.6, vel: 0.5, inst: "piano", role: "chord" }));
        const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24];
        for (let i = 0; i < 8; i++) {
          evs.push({ beat: bar * 4 + i * 0.5, midi: [arp[i % 4]], dur: 0.5, vel: i % 4 === 0 ? 0.85 : 0.55, inst: "piano", role: "melody" });
        }
      });
      const pattern: Pattern = { name: "Piano demo", bpm: 84, lengthBeats: 16, events: evs };
      const buf = await engine.bounce(pattern, 1, (p) => setBusy(`Rendering ${Math.round(p * 100)}%`));
      download(audioBufferToWav(buf), `${slug(pianoPreset(presetId).name)}-demo.wav`, "audio/wav");
    } catch {
      setBusy("Render unavailable");
      window.setTimeout(() => setBusy(null), 1800);
      return;
    }
    setBusy(null);
  }

  const randomise = () => {
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    setP({
      hammer: r(0.15, 0.9),
      unison: r(0.2, 2.2),
      inharmonicity: r(0.15, 0.7),
      sustain: r(0.3, 0.8),
      coupling: r(0.15, 0.7),
      soundboard: r(0.2, 0.75),
      lid: r(0.4, 1),
      damper: r(0.45, 0.9),
      resonance: r(0.1, 0.6),
      distance: r(0.1, 0.7),
      width: r(0.3, 0.9),
    });
  };

  const mapped = mapVelocity(last?.vel ?? vel, settings);
  const cents = last ? stretchCents(last.midi, settings.stretch) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label text-sun">Physical model · 3 strings per note · Faust WASM</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Piano workbench</h1>
        </div>
        <InputStatus gamepad={connected} />
      </div>

      {/* readout */}
      <div className="panel grid gap-3 p-3 sm:grid-cols-[auto_auto_auto_1fr]">
        <div className="min-w-[92px]">
          <p className="label">Harmony</p>
          <p className="font-mono text-2xl font-bold text-sun">{chordLabel ?? "—"}</p>
        </div>
        <div className="min-w-[76px]">
          <p className="label">Touch</p>
          <p className="font-mono text-2xl font-bold text-teal">{velocityLabel(mapped)}</p>
        </div>
        <div className="min-w-[96px]">
          <p className="label">Last note</p>
          <p className="font-mono text-sm">
            {last ? midiName(last.midi) : "—"}
            <span className="ml-1 text-[11px] text-muted">{cents >= 0 ? "+" : ""}{cents.toFixed(1)}¢</span>
          </p>
          <p className="text-[11px] text-muted">{status.pianoVoices} strings · pedal {Math.round(pedal * 100)}%</p>
        </div>
        <div className="flex items-end">
          <Visualizer engine={engine} className="h-12" color="#f2c46d" />
        </div>
      </div>

      <div className="panel overflow-hidden">
        <PianoAction events={events} pedal={pedal} lid={settings.lid} className="h-40 sm:h-48" />
      </div>

      {/* keyboard */}
      <PianoKeyboard
        from={base}
        to={top}
        active={active}
        highlight={showScale ? scalePcs : undefined}
        rootPc={showScale ? rootPc : undefined}
        onDown={(m, v) => strike(`p:${m}`, m, Math.max(0.08, Math.min(1, v * (vel / 0.75))))}
        onUp={(m) => release(`p:${m}`)}
        keyLabel={showKeys ? (m) => keyLabelFor(m, base) : undefined}
        height={span === 1 ? 210 : 236}
      />

      {/* 88-key map */}
      <div className="flex items-center gap-2">
        <button className="btn px-2 py-1 text-xs" onClick={() => shift(-1)} aria-label="Octave down">◀</button>
        <div className="relative flex h-6 flex-1 gap-[1px] overflow-hidden rounded-md bg-ebony p-[2px]">
          {Array.from({ length: 88 }, (_, i) => {
            const m = i + 21;
            const inView = m >= base && m <= top;
            const on = active.has(m);
            return (
              <button
                key={m}
                onClick={() => setBase(Math.max(21, Math.min(96 - span * 12, m - Math.floor((span * 12) / 2))))}
                className={`flex-1 rounded-[1px] transition-colors ${
                  on ? "bg-sun" : inView ? "bg-ivory/80" : [1, 3, 6, 8, 10].includes(pitchClass(m)) ? "bg-panel2" : "bg-ivory/25"
                }`}
                aria-label={`Jump to ${midiName(m)}`}
              />
            );
          })}
        </div>
        <button className="btn px-2 py-1 text-xs" onClick={() => shift(1)} aria-label="Octave up">▶</button>
        <span className="hidden w-28 text-right font-mono text-[11px] text-muted sm:block">{midiName(base)}–{midiName(top)}</span>
      </div>

      {/* performance bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button
          className={`btn ${pedal > 0.03 ? "btn-on" : ""}`}
          onPointerDown={() => { setPedalLatch(false); applyPedal(1); }}
          onPointerUp={() => applyPedal(0)}
          onPointerLeave={() => { if (!pedalLatch && pedal > 0) applyPedal(0); }}
        >
          Damper pedal
        </button>
        <label className="flex items-center gap-2 text-xs text-muted">
          half
          <input
            type="range"
            className="rack-slider w-24"
            style={{ ["--fill" as string]: `${pedal * 100}%`, ["--tone" as string]: "#f2c46d" }}
            min={0}
            max={1}
            step={0.05}
            value={pedal}
            onChange={(e) => { setPedalLatch(+e.target.value > 0); applyPedal(+e.target.value); }}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          key velocity
          <input
            type="range"
            className="rack-slider w-24"
            style={{ ["--fill" as string]: `${vel * 100}%`, ["--tone" as string]: "#35c9b0" }}
            min={0.08}
            max={1}
            step={0.01}
            value={vel}
            onChange={(e) => setVel(+e.target.value)}
          />
          <span className="w-8 font-mono text-ivory">{Math.round(vel * 127)}</span>
        </label>
        <button className={`btn ${recording ? "btn-rose" : ""}`} onClick={toggleRecord}>
          <span className={`h-2.5 w-2.5 rounded-full ${recording ? "animate-pulse bg-ebony" : "bg-rose"}`} />
          {recording ? "Stop" : "Record"}
        </button>
        <button className="btn" onClick={playTake} disabled={!take.length || recording}>▶ Take ({take.length})</button>
        <button className="btn btn-teal" onClick={sendToStudio} disabled={!take.length || recording}>To studio</button>
        <button className={`btn ${metro ? "btn-on" : ""}`} onClick={() => setMetro(!metro)}>Click</button>
        <input className="field w-16 py-1" type="number" min={40} max={220} value={bpm} onChange={(e) => setBpm(Math.max(40, Math.min(220, +e.target.value || 92)))} />
      </div>

      {/* ---------------------------------------------------------- workbench */}
      <section className="panel p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="label mr-auto">Instrument workbench</p>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(["model", "sample"] as const).map((m) => (
              <button
                key={m}
                className={`px-3 py-1.5 text-xs font-semibold ${mode === m ? "bg-sun text-ebony" : "bg-panel2 text-muted"}`}
                onClick={() => { setMode(m); engine.setPianoMode(m); void engine.ensure(); }}
              >
                {m === "model" ? "Physical model" : "SoundFont"}
              </button>
            ))}
          </div>
          <span className="rounded-full bg-panel2 px-2 py-1 text-[10px] font-semibold text-muted">
            {status.faust === "ready" ? "WASM live" : status.faust === "loading" ? "loading WASM…" : "synth fallback"}
          </span>
        </div>

        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
          {PIANO_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              title={p.note}
              className={`min-w-[132px] flex-none rounded-xl border p-2.5 text-left transition ${
                presetId === p.id ? "border-sun bg-sun/10" : "border-line bg-panel2 hover:border-maple/60"
              }`}
            >
              <p className={`text-sm font-bold ${presetId === p.id ? "text-sun" : "text-ivory"}`}>{p.name}</p>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted">{p.note}</p>
            </button>
          ))}
        </div>

        {mode === "sample" && (
          <p className="mb-3 rounded-lg border border-maple/40 bg-maple/10 px-3 py-2 text-xs text-maple">
            SoundFont mode plays the recorded grand piano. The string and body controls below shape the physical model —
            switch back to <b>Physical model</b> to hear them.
          </p>
        )}

        <div className={`grid gap-3 lg:grid-cols-4 ${mode === "sample" ? "opacity-60" : ""}`}>
          <Group title="Action">
            <Dial label="Hammer felt" hint="Soft felt darkens the tone; hard felt brightens it" value={settings.hammer} min={0} max={1} onChange={(v) => setP({ hammer: v })} />
            <Dial label="Velocity curve" value={settings.velocityCurve} min={-1} max={1} format={(v) => (v > 0 ? `soft ${Math.round(v * 100)}` : v < 0 ? `hard ${Math.round(-v * 100)}` : "linear")} tone="#35c9b0" onChange={(v) => setP({ velocityCurve: v })} />
            <Dial label="Dynamic range" value={settings.dynamics} min={0.2} max={1} tone="#35c9b0" onChange={(v) => setP({ dynamics: v })} />
            <Dial label="Sampled attack" hint="Blend of a recorded hammer transient" value={settings.sampleLayer} min={0} max={1} tone="#8b7bff" onChange={(v) => setP({ sampleLayer: v })} />
          </Group>

          <Group title="Strings">
            <Dial label="Unison detune" hint="Cents between the three strings of a note" value={settings.unison} min={0} max={4} step={0.05} format={(v) => `${v.toFixed(2)}¢`} tone="#f2c46d" onChange={(v) => setP({ unison: v })} />
            <Dial label="Inharmonicity" hint="String stiffness — stretches the partials sharp" value={settings.inharmonicity} min={0} max={1} tone="#f2c46d" onChange={(v) => setP({ inharmonicity: v })} />
            <Dial label="Sustain" hint="How long an undamped string rings" value={settings.sustain} min={0.05} max={1} tone="#f2c46d" onChange={(v) => setP({ sustain: v })} />
            <Dial label="Bridge coupling" hint="Energy sharing between unison strings — the two-stage decay" value={settings.coupling} min={0} max={0.9} tone="#f2c46d" onChange={(v) => setP({ coupling: v })} />
            <Dial label="Damper felt" value={settings.damper} min={0.1} max={1} tone="#ff4d6d" onChange={(v) => setP({ damper: v })} />
            <Dial label="Key-off noise" value={settings.releaseNoise} min={0} max={1} tone="#ff4d6d" onChange={(v) => setP({ releaseNoise: v })} />
          </Group>

          <Group title="Body & mics">
            <Dial label="Soundboard" value={settings.soundboard} min={0} max={1} tone="#35c9b0" onChange={(v) => setP({ soundboard: v })} />
            <Dial label="Lid position" hint="Closed lid is dark, open lid is bright" value={settings.lid} min={0} max={1} tone="#35c9b0" onChange={(v) => setP({ lid: v })} />
            <Dial label="Sympathetic" hint="Undamped strings ringing along with the pedal" value={settings.resonance} min={0} max={1} tone="#8b7bff" onChange={(v) => setP({ resonance: v })} />
            <Dial label="Mic distance" value={settings.distance} min={0} max={1} tone="#8b7bff" onChange={(v) => setP({ distance: v })} />
            <Dial label="Stereo spread" value={settings.width} min={0} max={1} tone="#8b7bff" onChange={(v) => setP({ width: v })} />
            <div>
              <span className="label">Polyphony</span>
              <div className="mt-1 flex items-center gap-1">
                <button className="btn px-2 py-1 text-xs" onClick={() => setP({ polyphony: Math.max(4, settings.polyphony - 8) })}>−</button>
                <span className="flex-1 text-center font-mono text-sm">{settings.polyphony}</span>
                <button className="btn px-2 py-1 text-xs" onClick={() => setP({ polyphony: Math.min(64, settings.polyphony + 8) })}>+</button>
              </div>
            </div>
          </Group>

          <Group title="Tuning">
            <Dial label="Concert pitch" value={settings.tuning} min={415} max={466} step={0.5} format={(v) => `${v.toFixed(1)} Hz`} tone="#4fb3ff" onChange={(v) => setP({ tuning: v })} />
            <Dial label="Stretch" hint="Railsback curve: flat bass, sharp treble" value={settings.stretch} min={0} max={1.5} format={(v) => `${Math.round(v * 100)}%`} tone="#4fb3ff" onChange={(v) => setP({ stretch: v })} />
            <div className="col-span-2 rounded-lg bg-ink/60 p-2">
              <p className="text-[10px] text-muted">Deviation from equal temperament</p>
              <div className="mt-1 flex h-8 items-end gap-[2px]">
                {[21, 33, 45, 57, 60, 69, 81, 93, 105, 108].map((m) => {
                  const c = stretchCents(m, settings.stretch);
                  return (
                    <div key={m} className="flex flex-1 flex-col items-center justify-end" title={`${midiName(m)} ${c.toFixed(1)}¢`}>
                      <span className="w-full rounded-sm bg-sky" style={{ height: `${Math.min(100, Math.abs(c) * 2.4)}%`, opacity: c < 0 ? 0.55 : 1 }} />
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 flex justify-between font-mono text-[9px] text-muted"><span>A0</span><span>A4</span><span>C8</span></p>
            </div>
          </Group>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn px-3 py-1.5 text-xs" onClick={() => applyPreset("concert")}>Reset</button>
          <button className="btn px-3 py-1.5 text-xs" onClick={randomise}>Randomise voicing</button>
          <button className="btn px-3 py-1.5 text-xs" onClick={() => download(JSON.stringify({ preset: presetId, settings }, null, 2), `${slug(pianoPreset(presetId).name)}-piano.json`, "application/json")}>
            Export preset
          </button>
          <button className="btn btn-sun px-3 py-1.5 text-xs" onClick={() => void renderDemo()} disabled={busy !== null}>
            {busy ?? "Render demo WAV"}
          </button>
          <button className="btn px-3 py-1.5 text-xs" onClick={() => { setSettings(engine.setPiano(DEFAULT_PIANO, "concert")); setPresetId("concert"); }}>
            Factory default
          </button>
        </div>
      </section>

      {/* harmony helpers */}
      <section className="panel grid gap-3 p-3 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="label mr-2">Play mode</p>
          <button className={`btn px-2.5 py-1 text-xs ${chordMode === "note" ? "btn-sun" : ""}`} onClick={() => setChordMode("note")}>Single</button>
          <button className={`btn px-2.5 py-1 text-xs ${chordMode === "diatonic" ? "btn-sun" : ""}`} onClick={() => setChordMode("diatonic")}>Diatonic</button>
          <button className={`btn px-2.5 py-1 text-xs ${chordMode === "octaves" ? "btn-sun" : ""}`} onClick={() => setChordMode("octaves")}>Octaves</button>
          {CHORD_QUALITIES.slice(0, 8).map((q) => (
            <button key={q.id} className={`btn px-2.5 py-1 text-xs ${chordMode === q.id ? "btn-sun" : ""}`} onClick={() => setChordMode(q.id)}>
              {q.symbol || "maj"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="field py-1 text-xs" value={rootPc} onChange={(e) => setRootPc(+e.target.value)}>
            {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select className="field py-1 text-xs" value={scale} onChange={(e) => setScale(e.target.value as ScaleName)}>
            {SCALE_NAMES.map((s) => <option key={s} value={s}>{SCALE_LABELS[s]}</option>)}
          </select>
          <button className={`btn px-2.5 py-1 text-xs ${showScale ? "btn-on" : ""}`} onClick={() => setShowScale(!showScale)}>Guide</button>
          <button className={`btn px-2.5 py-1 text-xs ${showKeys ? "btn-on" : ""}`} onClick={() => setShowKeys(!showKeys)}>Key hints</button>
        </div>
      </section>

      <EngineRack engine={engine} title="Room & mix" />

      <section className="panel p-3 text-xs text-muted">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          <li><span className="kbd">Z</span>–<span className="kbd">/</span> lower octave · <span className="kbd">Q</span>–<span className="kbd">]</span> upper octave · strike a key lower down for more weight.</li>
          <li>Hold <span className="kbd">Space</span> for the damper pedal, <span className="kbd">Enter</span> latches it, the half-pedal slider gives partial damping.</li>
          <li><span className="kbd">←</span><span className="kbd">→</span> octave · <span className="kbd">↑</span><span className="kbd">↓</span> key velocity.</li>
          <li>🎮 <span className="kbd">A B X Y LB RB</span> scale degrees, triggers are velocity-sensitive, stick click pedals, <span className="kbd">Start</span> records.</li>
        </ul>
      </section>
    </div>
  );
}
