"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EngineRack, { PatchPicker } from "@/components/audio/EngineRack";
import InputStatus from "@/components/ui/InputStatus";
import { getEngine } from "@/engine/music/audio";
import { TUNINGS, chordShape, getTuning, type Shape } from "@/engine/music/guitar";
import {
  NOTE_NAMES,
  SCALE_LABELS,
  SCALE_NAMES,
  chordAt,
  getQuality,
  pitchClass,
  qualityOf,
  romanAt,
  scalePitchClasses,
} from "@/engine/music/theory";
import type { NoteEvent, Pattern, ScaleName } from "@/engine/types";
import type { StringParams } from "@/engine/audio/faust";
import { PAD, useGamepad } from "@/hooks/useGamepad";
import { isTypingTarget } from "@/hooks/useNoteKeyboard";
import { detectChord } from "@/lib/chords";

const STRINGS = [5, 4, 3, 2, 1, 0]; // display order: high E on top
const WINDOW = 6; // frets visible in the neck window
const QUALITIES = ["maj", "min", "7", "maj7", "m7", "sus2", "sus4", "dim", "add9"];

interface GuitarTone extends StringParams {
  amp: number;
}

const DEFAULT_TONE: GuitarTone = {
  brightness: 0.62,
  damping: 0.3,
  stiffness: 0.3,
  bodyMix: 0.6,
  pluckPos: 0.16,
  amp: 0,
};

export default function GuitarClient() {
  const engine = useMemo(() => getEngine(), []);
  const [tuningId, setTuningId] = useState("standard");
  const tuning = getTuning(tuningId);
  const [capo, setCapo] = useState(0);
  const [position, setPosition] = useState(0);
  const [frets, setFrets] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [ringing, setRinging] = useState<boolean[]>([false, false, false, false, false, false]);
  const [pulse, setPulse] = useState<{ id: number; string: number }[]>([]);
  const [tone, setTone] = useState<GuitarTone>(DEFAULT_TONE);
  const [rootPc, setRootPc] = useState(0);
  const [scale, setScale] = useState<ScaleName>("major");
  const [overlay, setOverlay] = useState(false);
  const [hammer, setHammer] = useState(true);
  const [palm, setPalm] = useState(false);
  const [chordRoot, setChordRoot] = useState(0);
  const [quality, setQuality] = useState("maj");
  const [auto, setAuto] = useState(false);
  const [bpm, setBpm] = useState(92);
  const [lastVelocity, setLastVelocity] = useState(0);

  const fretsRef = useRef(frets);
  fretsRef.current = frets;
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const palmRef = useRef(palm);
  palmRef.current = palm;
  const ringingRef = useRef(ringing);
  ringingRef.current = ringing;
  const voiceIds = useRef<(number | null)[]>([null, null, null, null, null, null]);
  const nextId = useRef(1000);
  const trackId = useRef<number | null>(null);
  const stick = useRef(0);
  const neckRef = useRef<HTMLDivElement>(null);
  const strumRef = useRef<HTMLDivElement>(null);
  const neckPointers = useRef(new Map<number, number>());
  const strumPointers = useRef(new Map<number, { lane: number; t: number; y: number }>());

  const notes = frets.map((f, i) => (f < 0 ? -1 : tuning.strings[i] + f + capo));
  const chordLabel = detectChord(notes.filter((n) => n >= 0));
  const diatonic = Array.from({ length: 7 }, (_, d) => {
    const c = chordAt(48 + rootPc, scale, d);
    return { d, rootPc: pitchClass(c[0]), quality: qualityOf(c), roman: romanAt(48 + rootPc, scale, d) };
  });

  const ready = useCallback(() => {
    if (!engine.context) void engine.ensure();
  }, [engine]);

  useEffect(() => {
    engine.setPatch("guitar", engine.patchId("guitar"));
  }, [engine]);

  useEffect(() => {
    const { amp, ...params } = tone;
    engine.faust.setStringParams(params);
    if (engine.context) engine.setAmp("guitar", amp, 0.65);
  }, [tone, engine]);

  const markRinging = (i: number, on: boolean) =>
    setRinging((r) => {
      if (r[i] === on) return r;
      const next = [...r];
      next[i] = on;
      return next;
    });

  /** One voice per string, exactly like a real instrument. */
  const pluckString = useCallback(
    (i: number, velocity: number, opts: { muted?: boolean; soft?: boolean } = {}) => {
      const f = fretsRef.current[i];
      if (f < 0) return;
      ready();
      const t = toneRef.current;
      const muted = opts.muted ?? palmRef.current;
      const prev = voiceIds.current[i];
      if (prev !== null) engine.dampString(prev);
      const id = nextId.current++;
      voiceIds.current[i] = id;
      const midi = tuning.strings[i] + f + capo;
      const params: Partial<StringParams> = {
        brightness: muted ? t.brightness * 0.45 : t.brightness,
        damping: muted ? 0.86 : t.damping,
        stiffness: t.stiffness,
        bodyMix: t.bodyMix,
        pluckPos: t.pluckPos,
      };
      const vel = Math.max(0.08, Math.min(1, velocity * (opts.soft ? 0.5 : 1)));
      engine.pluckString(id, midi, vel, 0.32 + (i / 5) * 0.36, params);
      markRinging(i, true);
      setLastVelocity(vel);
      setPulse((p) => [...p.slice(-8), { id, string: i }]);
      window.setTimeout(() => setPulse((p) => p.filter((x) => x.id !== id)), 460);
      window.setTimeout(() => {
        if (voiceIds.current[i] === id) markRinging(i, false);
      }, muted ? 500 : 2600);
    },
    [engine, tuning, capo, ready],
  );

  const dampString = useCallback(
    (i: number) => {
      const id = voiceIds.current[i];
      if (id !== null) engine.dampString(id);
      voiceIds.current[i] = null;
      markRinging(i, false);
    },
    [engine],
  );

  const strum = useCallback(
    (dir: "down" | "up", velocity = 0.85) => {
      const order = dir === "down" ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0];
      order.forEach((i, k) => {
        window.setTimeout(() => pluckString(i, velocity * (1 - k * 0.03)), k * 14);
      });
    },
    [pluckString],
  );

  const applyShape = useCallback(
    (shape: Shape, root: number, q: string) => {
      setChordRoot(root);
      setQuality(q);
      setFrets([...shape]);
      const fretted = shape.filter((f) => f > 0);
      if (fretted.length) {
        const lo = Math.min(...fretted);
        setPosition(Math.max(0, Math.min(9, lo - 1)));
      } else setPosition(0);
    },
    [],
  );

  const pickChord = useCallback(
    (root: number, q: string) => applyShape(chordShape(tuning, root, q), root, q),
    [applyShape, tuning],
  );

  useEffect(() => {
    pickChord(0, "maj");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tuningId]);

  // ---------------------------------------------------------------- neck hand
  const neckCell = (e: React.PointerEvent) => {
    const el = neckRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const row = Math.max(0, Math.min(5, Math.floor(((e.clientY - r.top) / r.height) * 6)));
    const col = Math.max(0, Math.min(WINDOW - 1, Math.floor(((e.clientX - r.left) / r.width) * WINDOW)));
    return { string: STRINGS[row], fret: position + col + 1 };
  };

  const setFret = (i: number, fret: number) => {
    const prev = fretsRef.current[i];
    if (prev === fret) return;
    setFrets((f) => {
      const next = [...f];
      next[i] = fret;
      return next;
    });
    if (hammer && ringingRef.current[i] && prev >= 0 && fret >= 0) {
      window.setTimeout(() => pluckString(i, 0.42, { soft: true }), 0);
    }
  };

  const onNeckDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const c = neckCell(e);
    if (!c) return;
    neckPointers.current.set(e.pointerId, c.string);
    ready();
    setFret(c.string, c.fret);
  };
  const onNeckMove = (e: React.PointerEvent) => {
    if (!neckPointers.current.has(e.pointerId)) return;
    const c = neckCell(e);
    if (!c) return;
    const prevString = neckPointers.current.get(e.pointerId);
    if (prevString !== c.string) neckPointers.current.set(e.pointerId, c.string);
    setFret(c.string, c.fret);
  };
  const onNeckUp = (e: React.PointerEvent) => {
    neckPointers.current.delete(e.pointerId);
  };

  // -------------------------------------------------------------- picking hand
  const laneAt = (clientY: number) => {
    const el = strumRef.current;
    if (!el) return -1;
    const r = el.getBoundingClientRect();
    const rel = (clientY - r.top) / r.height;
    if (rel < 0 || rel > 1) return -1;
    return Math.max(0, Math.min(5, Math.floor(rel * 6)));
  };

  const onStrumDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const lane = laneAt(e.clientY);
    if (lane < 0) return;
    strumPointers.current.set(e.pointerId, { lane, t: performance.now(), y: e.clientY });
    pluckString(STRINGS[lane], 0.8);
  };
  const onStrumMove = (e: React.PointerEvent) => {
    const prev = strumPointers.current.get(e.pointerId);
    if (!prev) return;
    const lane = laneAt(e.clientY);
    if (lane < 0 || lane === prev.lane) return;
    const now = performance.now();
    const speed = Math.abs(e.clientY - prev.y) / Math.max(1, now - prev.t);
    const vel = Math.max(0.35, Math.min(1, 0.4 + speed * 0.55));
    const step = lane > prev.lane ? 1 : -1;
    for (let k = prev.lane + step; k !== lane + step; k += step) pluckString(STRINGS[k], vel);
    strumPointers.current.set(e.pointerId, { lane, t: now, y: e.clientY });
  };
  const onStrumUp = (e: React.PointerEvent) => {
    strumPointers.current.delete(e.pointerId);
  };

  // ------------------------------------------------------------------ keyboard
  useEffect(() => {
    const PLUCK = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN"];
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.code === "KeyM") {
        setPalm(e.type === "keydown");
        e.preventDefault();
        return;
      }
      if (e.type !== "keydown" || e.repeat) return;
      const num = /^Digit([1-7])$/.exec(e.code);
      if (num) {
        const d = diatonic[Number(num[1]) - 1];
        if (d) pickChord(d.rootPc, d.quality);
        e.preventDefault();
        return;
      }
      const pi = PLUCK.indexOf(e.code);
      if (pi >= 0) {
        pluckString(pi, 0.8);
        e.preventDefault();
        return;
      }
      if (e.code === "Space" || e.code === "KeyJ") strum(e.shiftKey ? "up" : "down");
      else if (e.code === "KeyK") strum("up");
      else if (e.code === "ArrowUp") setCapo((c) => Math.min(9, c + 1));
      else if (e.code === "ArrowDown") setCapo((c) => Math.max(0, c - 1));
      else if (e.code === "ArrowRight") setPosition((p) => Math.min(9, p + 1));
      else if (e.code === "ArrowLeft") setPosition((p) => Math.max(0, p - 1));
      else if (e.code === "KeyA") setAuto((a) => !a);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [diatonic, pickChord, pluckString, strum]);

  // ------------------------------------------------------------------- gamepad
  const PAD_CHORDS: Record<number, number> = { [PAD.A]: 0, [PAD.B]: 4, [PAD.X]: 3, [PAD.Y]: 5, [PAD.LB]: 1, [PAD.RB]: 2 };
  const { connected } = useGamepad({
    onButton: (i, pressed, value) => {
      if (i === PAD.LS) return setPalm(pressed);
      if (!pressed) return;
      if (i in PAD_CHORDS) {
        const d = diatonic[PAD_CHORDS[i]];
        if (d) pickChord(d.rootPc, d.quality);
      } else if (i === PAD.RT) strum("down", 0.4 + value * 0.6);
      else if (i === PAD.LT) strum("up", 0.4 + value * 0.5);
      else if (i === PAD.UP) setCapo((c) => Math.min(9, c + 1));
      else if (i === PAD.DOWN) setCapo((c) => Math.max(0, c - 1));
      else if (i === PAD.LEFT || i === PAD.RIGHT) {
        const idx = QUALITIES.indexOf(quality);
        pickChord(chordRoot, QUALITIES[(idx + (i === PAD.RIGHT ? 1 : QUALITIES.length - 1)) % QUALITIES.length]);
      } else if (i === PAD.START) setAuto((a) => !a);
    },
    onAxes: (axes) => {
      const ry = axes[3] ?? 0;
      const zone = ry > 0.55 ? 1 : ry < -0.55 ? -1 : 0;
      if (zone !== stick.current && zone !== 0) strum(zone === 1 ? "down" : "up", 0.5 + Math.min(1, Math.abs(ry)) * 0.4);
      stick.current = zone;
      const lx = axes[0] ?? 0;
      if (Math.abs(lx) > 0.6) {
        const target = 0.05 + ((lx + 1) / 2) * 0.4;
        if (Math.abs(target - toneRef.current.pluckPos) > 0.04) setTone((t) => ({ ...t, pluckPos: target }));
      }
    },
  });

  // ---------------------------------------------------------------- auto strum
  const pattern = useCallback((): Pattern => {
    const ns = frets.map((f, i) => (f < 0 ? -1 : tuning.strings[i] + f + capo)).filter((n) => n >= 0);
    const steps: ("D" | "U" | "-")[] = ["D", "-", "D", "U", "-", "U", "D", "U"];
    const events: NoteEvent[] = [];
    steps.forEach((s, i) => {
      if (s === "-" || ns.length === 0) return;
      events.push({
        beat: i * 0.5,
        midi: s === "D" ? ns : [...ns].reverse(),
        dur: 0.5,
        vel: s === "D" ? (i % 4 === 0 ? 0.85 : 0.7) : 0.55,
        inst: "guitar",
        role: "chord",
      });
      events.push({ beat: i * 0.5, midi: [42], dur: 0.1, vel: 0.12, inst: "hat", role: "drum" });
    });
    events.push({ beat: 0, midi: [36], dur: 0.2, vel: 0.45, inst: "kick", role: "drum" });
    events.push({ beat: 2, midi: [38], dur: 0.2, vel: 0.3, inst: "snare", role: "drum" });
    return { name: "Strum", bpm, lengthBeats: 4, events };
  }, [frets, tuning, capo, bpm]);

  useEffect(() => {
    if (!auto) {
      if (trackId.current !== null) engine.stop();
      trackId.current = null;
      return;
    }
    if (trackId.current === null) {
      void engine.start(bpm).then(() => {
        trackId.current = engine.addTrack(pattern(), { startBeat: 0, loop: true });
      });
    } else engine.replaceTrack(trackId.current, pattern());
  }, [auto, pattern, engine, bpm]);

  useEffect(() => () => engine.stop(), [engine]);

  const scalePcs = scalePitchClasses(rootPc, scale);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label text-sun">Physical model · Faust WASM</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Guitar</h1>
        </div>
        <InputStatus gamepad={connected} />
      </div>

      {/* chord readout */}
      <div className="panel flex flex-wrap items-center gap-4 px-4 py-3">
        <div className="min-w-[104px]">
          <p className="label">Sounding</p>
          <p className="font-mono text-2xl font-bold text-sun">{chordLabel ?? "—"}</p>
        </div>
        <div className="hidden sm:block">
          <p className="label">Shape</p>
          <p className="font-mono text-lg tracking-[0.2em]">{frets.map((f) => (f < 0 ? "x" : f)).join("")}</p>
        </div>
        <div className="hidden md:block">
          <p className="label">Pick velocity</p>
          <div className="mt-1 h-2 w-28 overflow-hidden rounded-full bg-panel2">
            <div className="h-full rounded-full bg-teal transition-[width] duration-150" style={{ width: `${lastVelocity * 100}%` }} />
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button className={`btn ${palm ? "btn-on" : ""}`} onPointerDown={() => setPalm(true)} onPointerUp={() => setPalm(false)} onPointerLeave={() => setPalm(false)}>
            Palm mute
          </button>
          <button className="btn" onClick={() => [0, 1, 2, 3, 4, 5].forEach(dampString)}>
            Damp all
          </button>
        </div>
      </div>

      {/* two-handed surface */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="label">Left hand · fret</p>
            <div className="flex items-center gap-1">
              <button className="btn px-2 py-1 text-xs" onClick={() => setPosition((p) => Math.max(0, p - 1))}>◀</button>
              <span className="w-20 text-center font-mono text-xs text-muted">frets {position + 1}–{position + WINDOW}</span>
              <button className="btn px-2 py-1 text-xs" onClick={() => setPosition((p) => Math.min(9, p + 1))}>▶</button>
            </div>
          </div>
          <div
            ref={neckRef}
            className="relative h-56 bg-[#3a2418] sm:h-64"
            style={{ touchAction: "none" }}
            onPointerDown={onNeckDown}
            onPointerMove={onNeckMove}
            onPointerUp={onNeckUp}
            onPointerCancel={onNeckUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            {STRINGS.map((si, row) => (
              <div key={si} className="absolute inset-x-0 flex" style={{ top: `${(row / 6) * 100}%`, height: `${100 / 6}%` }}>
                <div
                  className={`pointer-events-none absolute inset-x-0 top-1/2 ${ringing[si] ? "string-live bg-sun" : "bg-[#ded6c4]"}`}
                  style={{ height: 1 + (5 - si) * 0.5, opacity: frets[si] < 0 ? 0.25 : 0.95 }}
                />
                {Array.from({ length: WINDOW }, (_, col) => {
                  const fret = position + col + 1;
                  const held = frets[si] === fret;
                  const midi = tuning.strings[si] + fret + capo;
                  const inScale = overlay && scalePcs.includes(pitchClass(midi));
                  return (
                    <div key={col} className="relative flex-1 border-r-2 border-[#a39d92]/60">
                      {(held || inScale) && (
                        <span
                          className={`pointer-events-none absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-bold ${
                            held ? "bg-ivory text-ebony" : pitchClass(midi) === rootPc ? "bg-maple/80 text-ebony" : "bg-teal/60 text-ebony"
                          }`}
                        >
                          {NOTE_NAMES[pitchClass(midi)]}
                        </span>
                      )}
                      {[3, 5, 7, 9, 12, 15].includes(fret) && row === 2 && (
                        <span className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-maple/25" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-2 pb-1 text-[9px] text-ivory/40">
              {Array.from({ length: WINDOW }, (_, c) => (
                <span key={c}>{position + c + 1}</span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <button className="btn px-2 py-1 text-xs" onClick={() => setFrets((f) => f.map(() => 0))}>Open strings</button>
            <button className="btn px-2 py-1 text-xs" onClick={() => setFrets((f) => f.map(() => -1))}>Mute all</button>
            <button className={`btn px-2 py-1 text-xs ${hammer ? "btn-on" : ""}`} onClick={() => setHammer(!hammer)}>Hammer-on</button>
            <button className={`btn px-2 py-1 text-xs ${overlay ? "btn-on" : ""}`} onClick={() => setOverlay(!overlay)}>Scale</button>
            <span className="ml-auto text-[11px] text-muted">Hold several fingers for barre chords</span>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="label">Right hand · pick &amp; strum</p>
            <span className="text-[11px] text-muted">swipe across the strings</span>
          </div>
          <div
            ref={strumRef}
            className="relative h-56 cursor-pointer bg-[#c98a4b] sm:h-64"
            style={{ touchAction: "none" }}
            onPointerDown={onStrumDown}
            onPointerMove={onStrumMove}
            onPointerUp={onStrumUp}
            onPointerCancel={onStrumUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2a1a10]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#8a5a2b]" />
            {STRINGS.map((si, row) => (
              <div key={si} className="absolute inset-x-0 flex items-center" style={{ top: `${((row + 0.5) / 6) * 100}%` }}>
                <div
                  className={`w-full ${ringing[si] ? "string-live bg-sun" : "bg-[#efe8d8]"}`}
                  style={{ height: 1 + (5 - si) * 0.55, opacity: frets[si] < 0 ? 0.3 : 1 }}
                />
                <span className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-[#4a2c14]">
                  {frets[si] < 0 ? "×" : NOTE_NAMES[pitchClass(tuning.strings[si] + frets[si] + capo)]}
                </span>
              </div>
            ))}
            {pulse.map((p) => {
              const row = STRINGS.indexOf(p.string);
              return (
                <span
                  key={p.id}
                  className="pluck-ring pointer-events-none absolute left-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ivory"
                  style={{ top: `${((row + 0.5) / 6) * 100}%` }}
                />
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-line px-3 py-2">
            <button className="btn btn-sun" onPointerDown={() => strum("down")}>Strum ↓</button>
            <button className="btn" onPointerDown={() => strum("up")}>Strum ↑</button>
            <button className={`btn ${auto ? "btn-teal" : ""}`} onClick={() => setAuto(!auto)}>{auto ? "■ Stop" : "▶ Auto"}</button>
          </div>
        </section>
      </div>

      {/* chords */}
      <section className="panel space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="label mr-auto">Chords · {NOTE_NAMES[rootPc]} {SCALE_LABELS[scale].toLowerCase()}</p>
          <select className="field py-1 text-xs" value={rootPc} onChange={(e) => setRootPc(+e.target.value)}>
            {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select className="field py-1 text-xs" value={scale} onChange={(e) => setScale(e.target.value as ScaleName)}>
            {SCALE_NAMES.map((s) => <option key={s} value={s}>{SCALE_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {diatonic.map((d) => {
            const on = d.rootPc === chordRoot && d.quality === quality;
            return (
              <button key={d.d} className={`btn flex-col py-2 ${on ? "btn-sun" : ""}`} onClick={() => pickChord(d.rootPc, d.quality)}>
                <span className="text-[10px] opacity-70">{d.roman}</span>
                <span className="text-base">{NOTE_NAMES[d.rootPc]}{getQuality(d.quality).symbol}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {NOTE_NAMES.map((n, i) => (
              <button key={n} className={`btn min-w-[40px] px-2 py-1 text-xs ${chordRoot === i ? "btn-on" : ""}`} onClick={() => pickChord(i, quality)}>{n}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {QUALITIES.map((q) => (
              <button key={q} className={`btn px-2 py-1 text-xs ${quality === q ? "btn-on" : ""}`} onClick={() => pickChord(chordRoot, q)}>
                {getQuality(q).symbol || "maj"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* always-visible performance controls */}
      <section className="panel p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="label mr-auto">Instrument setup</p>
          <PatchPicker engine={engine} inst="guitar" label="Model" />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          <label className="block">
            <span className="label">Tuning</span>
            <select className="field mt-1 w-full py-1 text-xs" value={tuningId} onChange={(e) => setTuningId(e.target.value)}>
              {TUNINGS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div>
            <span className="label">Capo</span>
            <div className="mt-1 flex items-center gap-1">
              <button className="btn px-2 py-1 text-xs" onClick={() => setCapo((c) => Math.max(0, c - 1))}>−</button>
              <span className="flex-1 text-center font-mono text-sm">{capo || "off"}</span>
              <button className="btn px-2 py-1 text-xs" onClick={() => setCapo((c) => Math.min(9, c + 1))}>+</button>
            </div>
          </div>
          {([
            ["Pick position", "pluckPos", 0.02, 0.5],
            ["Brightness", "brightness", 0, 1],
            ["String damping", "damping", 0, 1],
            ["Stiffness", "stiffness", 0, 1],
            ["Body resonance", "bodyMix", 0, 1],
            ["Amp drive", "amp", 0, 1],
          ] as [string, keyof GuitarTone, number, number][]).map(([label, key, min, max]) => (
            <label key={key} className="block">
              <span className="flex items-baseline justify-between">
                <span className="label">{label}</span>
                <span className="font-mono text-[11px] text-ivory/80">{Math.round(tone[key] * 100)}</span>
              </span>
              <input
                type="range"
                className="rack-slider mt-1 w-full"
                style={{
                  ["--fill" as string]: `${((tone[key] - min) / (max - min)) * 100}%`,
                  ["--tone" as string]: key === "amp" ? "#ff4d6d" : "#f2c46d",
                }}
                min={min}
                max={max}
                step={0.01}
                value={tone[key]}
                onChange={(e) => setTone((t) => ({ ...t, [key]: +e.target.value }))}
              />
            </label>
          ))}
          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className="label">Tempo</span>
              <span className="font-mono text-[11px] text-ivory/80">{bpm}</span>
            </span>
            <input
              type="range"
              className="rack-slider mt-1 w-full"
              style={{ ["--fill" as string]: `${((bpm - 60) / 120) * 100}%`, ["--tone" as string]: "#35c9b0" }}
              min={60}
              max={180}
              value={bpm}
              onChange={(e) => setBpm(+e.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn px-3 py-1.5 text-xs" onClick={() => setTone(DEFAULT_TONE)}>Reset instrument</button>
          <button
            className="btn px-3 py-1.5 text-xs"
            onClick={() =>
              setTone({
                brightness: 0.2 + Math.random() * 0.7,
                damping: Math.random() * 0.6,
                stiffness: Math.random() * 0.7,
                bodyMix: 0.2 + Math.random() * 0.7,
                pluckPos: 0.04 + Math.random() * 0.4,
                amp: Math.random() < 0.5 ? 0 : Math.random() * 0.8,
              })
            }
          >
            Randomise build
          </button>
          <span className="self-center text-[11px] text-muted">
            Two hands, two zones: fret with one hand while the other strums — every string is its own WASM voice.
          </span>
        </div>
      </section>

      <EngineRack engine={engine} title="Master rack" />

      <section className="panel p-3 text-xs text-muted">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          <li><b className="text-ivory">Left hand</b> — tap or slide the neck; hold several strings for a barre. <span className="kbd">1</span>–<span className="kbd">7</span> chords, <span className="kbd">←</span><span className="kbd">→</span> position, <span className="kbd">↑</span><span className="kbd">↓</span> capo.</li>
          <li><b className="text-ivory">Right hand</b> — swipe the strings to strum (speed = dynamics) or tap one to fingerpick. <span className="kbd">Space</span> strum ↓, <span className="kbd">K</span> ↑, <span className="kbd">Z</span>…<span className="kbd">N</span> individual strings, hold <span className="kbd">M</span> to palm-mute.</li>
          <li>🎮 Face buttons chords · <span className="kbd">RT</span>/<span className="kbd">LT</span> strum with pressure · right-stick flick strums · left stick moves the pick · stick click palm-mutes.</li>
          <li>Hammer-ons re-excite a ringing string when you change its fret, and re-plucking damps the previous vibration — like a real string.</li>
        </ul>
      </section>
    </div>
  );
}
