"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MusicEngine } from "@/engine/music/audio";
import { composePattern, progressionPattern } from "@/engine/music/composer";
import {
  PROGRESSIONS,
  ROOT_OPTIONS,
  SCALE_LABELS,
  chordAt,
  chordName,
  getProgression,
  midiName,
  scaleSize,
} from "@/engine/music/theory";
import type { NoteEvent, Pattern, PitchedInstrument, ScaleName } from "@/engine/types";
import { clamp } from "@/engine/util";
import { useMotion } from "@/hooks/useMotion";

const SCALES: ScaleName[] = ["major", "minor", "dorian", "pentatonic", "blues"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** Chromatic keyboard from C4: computer key → semitone offset. */
const KEYS: { key: string; offset: number }[] = [
  { key: "a", offset: 0 },
  { key: "w", offset: 1 },
  { key: "s", offset: 2 },
  { key: "e", offset: 3 },
  { key: "d", offset: 4 },
  { key: "f", offset: 5 },
  { key: "t", offset: 6 },
  { key: "g", offset: 7 },
  { key: "y", offset: 8 },
  { key: "h", offset: 9 },
  { key: "u", offset: 10 },
  { key: "j", offset: 11 },
  { key: "k", offset: 12 },
];
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK_OFFSETS = [1, 3, 6, 8, 10];

interface SavedComposition {
  id: number;
  title: string;
  bpm: number;
  instrument: string;
  seed: number;
  events: NoteEvent[];
}

type Playing = "none" | "progression" | "composition";

export default function StudioClient() {
  const [audio] = useState(() => new MusicEngine());

  const [instrument, setInstrument] = useState<PitchedInstrument>("piano");
  const [root, setRoot] = useState(57);
  const [scale, setScale] = useState<ScaleName>("minor");
  const [volume, setVolume] = useState(0.8);
  const [bpm, setBpm] = useState(96);
  const [octave, setOctave] = useState(0);
  const [pressed, setPressed] = useState<number | null>(null);
  const [lastDegree, setLastDegree] = useState(0);

  const [progId, setProgId] = useState("pop");
  const [playing, setPlaying] = useState<Playing>("none");
  const [beat, setBeat] = useState(-1);

  const [bars, setBars] = useState<4 | 8>(4);
  const [density, setDensity] = useState(0.7);
  const [swing, setSwing] = useState(0.1);
  const [drums, setDrums] = useState(true);
  const [seed, setSeed] = useState(1234);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [title, setTitle] = useState("My loop");

  const [comps, setComps] = useState<SavedComposition[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [motionOn, setMotionOn] = useState(false);
  const [tiltView, setTiltView] = useState(0);
  const [accelView, setAccelView] = useState(0);

  const size = scaleSize(scale);
  const degrees = Array.from({ length: size }, (_, i) => i);
  const progression = getProgression(progId);

  const handleShake = useCallback(
    (strength: number) => {
      void audio.ensure().then(() => {
        audio.noteOn(instrument, chordAt(root, scale, lastDegree), {
          vel: 0.5 + 0.5 * strength,
          dur: 2,
          strum: 0.03,
        });
      });
    },
    [audio, instrument, root, scale, lastDegree],
  );

  const { reading, permission, request } = useMotion(motionOn, handleShake);

  const loadComps = useCallback(async () => {
    try {
      const res = await fetch("/api/compositions?limit=30", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { compositions: SavedComposition[] };
      setComps(data.compositions);
    } catch {
      setStatus("Could not load saved compositions");
    }
  }, []);

  useEffect(() => {
    void loadComps();
  }, [loadComps]);

  // Transport events: beat pulses for the UI and end-of-playback reset.
  useEffect(() => {
    return audio.on((e) => {
      if (e.type === "beat") setBeat(((e.beat % 4) + 4) % 4);
      if (e.type === "stop") {
        setBeat(-1);
        setPlaying("none");
      }
    });
  }, [audio]);

  useEffect(() => {
    return () => audio.stop();
  }, [audio]);

  useEffect(() => {
    audio.setVolume(volume);
  }, [audio, volume]);

  const playKey = useCallback(
    (offset: number) => {
      setPressed(offset);
      const midi = 60 + octave * 12 + offset;
      void audio.ensure().then(() => {
        audio.noteOn(instrument, midi, { vel: 0.9, dur: 1.5 });
      });
    },
    [audio, instrument, octave],
  );

  // Computer keyboard: a–k play notes, z/x shift octave.
  useEffect(() => {
    const isField = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat || isField(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z") return setOctave((o) => clamp(o - 1, -2, 2));
      if (k === "x") return setOctave((o) => clamp(o + 1, -2, 2));
      const match = KEYS.find((m) => m.key === k);
      if (match) {
        e.preventDefault();
        playKey(match.offset);
      }
    };
    const up = () => setPressed(null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [playKey]);

  // Motion: tilt drives the master filter, shake strums the last chord.
  useEffect(() => {
    if (!motionOn) return;
    const id = window.setInterval(() => {
      const r = reading.current;
      setTiltView(r.tilt);
      setAccelView(r.accel);
      audio.setExpression((r.tilt + 1) / 2);
    }, 90);
    return () => window.clearInterval(id);
  }, [motionOn, audio, reading]);

  const enableMotion = async () => {
    const ok = await request();
    setMotionOn(ok);
    if (!ok) audio.setExpression(1);
  };

  const disableMotion = () => {
    setMotionOn(false);
    audio.setExpression(1);
  };

  const playChord = (degree: number) => {
    setLastDegree(degree);
    void audio.ensure().then(() => {
      audio.noteOn(instrument, chordAt(root, scale, degree), { vel: 0.7, dur: 2, strum: 0.03 });
    });
  };

  const playProgression = async () => {
    await audio.ensure();
    const p = progressionPattern({
      name: `${progression.name}`,
      root,
      scale,
      degrees: progression.degrees,
      bpm,
      instrument,
      bars: 4,
    });
    await audio.playPattern(p, true);
    setPlaying("progression");
  };

  const compose = (): Pattern => {
    const s = Math.floor(Math.random() * 1_000_000_000);
    setSeed(s);
    const p = composePattern({
      name: `Loop ${s % 10000}`,
      seed: s,
      bpm,
      root,
      scale,
      bars,
      instrument,
      progression: progression.degrees,
      density,
      swing,
      drums,
    });
    setPattern(p);
    setStatus(null);
    return p;
  };

  const playComposed = async () => {
    const p = pattern ?? compose();
    await audio.ensure();
    await audio.playPattern(p, true);
    setPlaying("composition");
  };

  const playSaved = async (c: SavedComposition) => {
    const end = Math.max(...c.events.map((e) => e.beat + e.dur));
    const p: Pattern = {
      name: c.title,
      bpm: c.bpm,
      lengthBeats: Math.max(4, Math.ceil(end / 4) * 4),
      events: c.events,
    };
    await audio.ensure();
    await audio.playPattern(p, true);
    setPlaying("composition");
  };

  const save = async () => {
    if (!pattern) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/compositions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          bpm: pattern.bpm,
          instrument,
          seed,
          events: pattern.events,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("Saved to the library");
      await loadComps();
    } catch {
      setStatus("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const stop = () => {
    audio.stop();
    setPlaying("none");
  };

  const melodyPreview = pattern
    ? pattern.events
        .filter((e) => e.role === "melody")
        .slice(0, 16)
        .map((e) => midiName(e.midi[0]))
        .join("  ")
    : "";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-fuchsia-300">Music engine</p>
          <h1 className="mt-1 text-3xl font-semibold text-white">Melody Studio</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-400">
            Play piano and guitar, loop progressions, generate compositions, and save them. Saved loops can be
            charted in the Rhythm Arena.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/arena" className="rounded-full bg-white/10 px-4 py-2 text-slate-200 hover:bg-white/20">
            Arena
          </Link>
          <Link href="/" className="rounded-full bg-white/10 px-4 py-2 text-slate-200 hover:bg-white/20">
            Home
          </Link>
        </nav>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {/* Sound & key */}
          <section className="grid gap-4 rounded-3xl bg-slate-900/70 p-5 ring-1 ring-white/10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-400">Instrument</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["piano", "guitar"] as const).map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setInstrument(i)}
                    className={`rounded-xl px-3 py-2 text-sm capitalize ring-1 ring-white/10 ${
                      instrument === i ? "bg-fuchsia-500 text-white" : "bg-white/5 text-slate-300"
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
            <label className="text-sm">
              <span className="text-xs uppercase tracking-wider text-slate-400">Key</span>
              <select
                value={root}
                onChange={(e) => setRoot(Number(e.target.value))}
                className="mt-2 w-full rounded-xl bg-slate-800 px-3 py-2 text-slate-100 ring-1 ring-white/10"
              >
                {ROOT_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {midiName(m).replace(/\d+$/, "")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs uppercase tracking-wider text-slate-400">Scale</span>
              <select
                value={scale}
                onChange={(e) => setScale(e.target.value as ScaleName)}
                className="mt-2 w-full rounded-xl bg-slate-800 px-3 py-2 text-slate-100 ring-1 ring-white/10"
              >
                {SCALES.map((s) => (
                  <option key={s} value={s}>
                    {SCALE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3">
              <label className="text-sm">
                <span className="flex justify-between text-xs uppercase tracking-wider text-slate-400">
                  Volume <span className="font-mono text-slate-200">{Math.round(volume * 100)}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="mt-2 w-full accent-fuchsia-400"
                />
              </label>
              <label className="text-sm">
                <span className="flex justify-between text-xs uppercase tracking-wider text-slate-400">
                  Tempo <span className="font-mono text-slate-200">{bpm} BPM</span>
                </span>
                <input
                  type="range"
                  min={60}
                  max={180}
                  step={1}
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                  className="mt-2 w-full accent-fuchsia-400"
                />
              </label>
            </div>
          </section>

          {/* Keyboard */}
          <section className="space-y-4 rounded-3xl bg-slate-900/70 p-5 ring-1 ring-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">Keyboard</h2>
              <p className="text-xs text-slate-400">
                Keys A–K play · Z / X shift octave ({octave >= 0 ? `+${octave}` : octave})
              </p>
            </div>
            <div className="relative h-44 select-none">
              <div className="flex h-full gap-1">
                {WHITE_OFFSETS.map((offset) => (
                  <button
                    key={offset}
                    type="button"
                    onPointerDown={() => playKey(offset)}
                    onPointerUp={() => setPressed(null)}
                    onPointerLeave={() => setPressed(null)}
                    className={`flex flex-1 flex-col items-center justify-end rounded-b-xl pb-2 text-xs font-mono ${
                      pressed === offset ? "bg-fuchsia-200 text-slate-900" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <span>{midiName(60 + octave * 12 + offset).replace(/\d+$/, "")}</span>
                    <span className="mt-1 text-[10px] uppercase opacity-60">
                      {KEYS.find((k) => k.offset === offset)?.key}
                    </span>
                  </button>
                ))}
              </div>
              {BLACK_OFFSETS.map((offset) => {
                const idx = WHITE_OFFSETS.indexOf(offset - 1);
                const left = ((idx + 0.66) / WHITE_OFFSETS.length) * 100;
                return (
                  <button
                    key={offset}
                    type="button"
                    onPointerDown={() => playKey(offset)}
                    onPointerUp={() => setPressed(null)}
                    onPointerLeave={() => setPressed(null)}
                    style={{ left: `${left}%`, width: `${(0.6 / WHITE_OFFSETS.length) * 100}%` }}
                    className={`absolute top-0 z-10 h-[60%] -translate-x-1/2 rounded-b-lg text-[10px] font-mono ${
                      pressed === offset ? "bg-fuchsia-400 text-white" : "bg-slate-900 text-slate-300"
                    } ring-1 ring-black/60`}
                  >
                    <span className="block pt-1">{KEYS.find((k) => k.offset === offset)?.key.toUpperCase()}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Chords & progression */}
          <section className="space-y-4 rounded-3xl bg-slate-900/70 p-5 ring-1 ring-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">Chord pads</h2>
              <div className="flex items-center gap-2">
                <select
                  value={progId}
                  onChange={(e) => setProgId(e.target.value)}
                  className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10"
                >
                  {PROGRESSIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {playing === "progression" ? (
                  <button type="button" onClick={stop} className="rounded-xl bg-rose-500 px-4 py-2 text-sm text-white">
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={playProgression}
                    className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:brightness-110"
                  >
                    Loop progression
                  </button>
                )}
              </div>
            </div>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.min(size, 7)}, minmax(0,1fr))` }}
            >
              {degrees.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => playChord(d)}
                  className={`rounded-2xl px-2 py-4 text-center ring-1 ring-white/10 transition active:scale-95 ${
                    lastDegree === d ? "bg-fuchsia-500/30" : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <span className="block text-[11px] uppercase tracking-wider text-slate-400">
                    {ROMAN[d] ?? d + 1}
                  </span>
                  <span className="mt-1 block text-lg font-semibold text-white">{chordName(root, scale, d)}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Composer */}
          <section className="space-y-4 rounded-3xl bg-slate-900/70 p-5 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">Composer</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-sm">
                <span className="text-xs uppercase tracking-wider text-slate-400">Length</span>
                <select
                  value={bars}
                  onChange={(e) => setBars(Number(e.target.value) === 8 ? 8 : 4)}
                  className="mt-2 w-full rounded-xl bg-slate-800 px-3 py-2 text-slate-100 ring-1 ring-white/10"
                >
                  <option value={4}>4 bars</option>
                  <option value={8}>8 bars</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="flex justify-between text-xs uppercase tracking-wider text-slate-400">
                  Density <span className="font-mono text-slate-200">{Math.round(density * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={density}
                  onChange={(e) => setDensity(Number(e.target.value))}
                  className="mt-2 w-full accent-fuchsia-400"
                />
              </label>
              <label className="text-sm">
                <span className="flex justify-between text-xs uppercase tracking-wider text-slate-400">
                  Swing <span className="font-mono text-slate-200">{Math.round(swing * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.33}
                  step={0.01}
                  value={swing}
                  onChange={(e) => setSwing(Number(e.target.value))}
                  className="mt-2 w-full accent-fuchsia-400"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={drums}
                  onChange={(e) => setDrums(e.target.checked)}
                  className="accent-fuchsia-400"
                />
                Drums
              </label>
              <button
                type="button"
                onClick={() => compose()}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm text-slate-100 hover:bg-white/20"
              >
                Generate
              </button>
              {playing === "composition" ? (
                <button type="button" onClick={stop} className="rounded-xl bg-rose-500 px-4 py-2 text-sm text-white">
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={playComposed}
                  className="rounded-xl bg-linear-to-r from-fuchsia-500 to-indigo-500 px-4 py-2 text-sm font-medium text-white hover:brightness-110"
                >
                  {pattern ? "Play loop" : "Generate & play"}
                </button>
              )}
              <div className="ml-auto flex gap-1.5" aria-label="Beat indicator">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-3 w-3 rounded-full transition ${
                      beat === i ? "scale-125 bg-fuchsia-300 shadow-[0_0_12px_#f0abfc]" : "bg-white/15"
                    }`}
                  />
                ))}
              </div>
            </div>

            {pattern && (
              <div className="space-y-3 rounded-2xl bg-black/30 p-4">
                <p className="font-mono text-xs leading-relaxed text-emerald-200">
                  {pattern.events.length} events · {pattern.lengthBeats / 4} bars · seed {seed}
                </p>
                <p className="font-mono text-xs leading-relaxed text-slate-300 break-words">{melodyPreview}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={80}
                    className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10"
                    placeholder="Title"
                  />
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
            {status && <p className="text-xs text-slate-400">{status}</p>}
          </section>
        </div>

        <aside className="space-y-6">
          {/* Motion */}
          <section className="space-y-4 rounded-3xl bg-slate-900/70 p-5 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">Motion</h2>
            {permission === "unsupported" ? (
              <p className="text-sm text-slate-400">No motion sensors on this device. Use the keyboard.</p>
            ) : !motionOn ? (
              <button
                type="button"
                onClick={enableMotion}
                className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm text-slate-100 hover:bg-white/20"
              >
                Enable motion
              </button>
            ) : (
              <button
                type="button"
                onClick={disableMotion}
                className="w-full rounded-xl bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
              >
                Disable motion
              </button>
            )}
            <div className="space-y-3 text-sm text-slate-300">
              <div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Tilt → filter</span>
                  <span className="font-mono">{tiltView.toFixed(2)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-fuchsia-400 transition-[width] duration-100"
                    style={{ width: `${((tiltView + 1) / 2) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Shake → strum chord</span>
                  <span className="font-mono">{accelView.toFixed(1)} m/s²</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-indigo-400 transition-[width] duration-100"
                    style={{ width: `${clamp(accelView / 30, 0, 1) * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Strums use the last chord you selected. Motion is optional; every control also works with the mouse
              or keyboard.
            </p>
          </section>

          {/* Library */}
          <section className="space-y-3 rounded-3xl bg-slate-900/70 p-5 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">Library</h2>
            {comps.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing saved yet. Generate a loop and save it.</p>
            ) : (
              <ul className="space-y-2">
                {comps.map((c) => (
                  <li key={c.id} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{c.title}</p>
                        <p className="text-xs text-slate-400">
                          {c.bpm} BPM · {c.instrument} · {c.events.length} events
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => playSaved(c)}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/20"
                      >
                        Play
                      </button>
                    </div>
                    <Link
                      href={`/arena?comp=${c.id}`}
                      className="mt-2 inline-block text-xs text-indigo-300 hover:text-indigo-200"
                    >
                      Chart in Arena →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
