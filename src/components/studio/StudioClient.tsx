"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PianoKeyboard from "@/components/instruments/PianoKeyboard";
import EngineRack, { PatchPicker } from "@/components/audio/EngineRack";
import InputStatus from "@/components/ui/InputStatus";
import Visualizer from "@/components/ui/Visualizer";
import { INSTRUMENT_LABELS, MusicEngine, getEngine, type Voice } from "@/engine/music/audio";
import {
  NOTE_NAMES,
  PROGRESSIONS,
  SCALE_LABELS,
  SCALE_NAMES,
  getProgression,
  inScale,
  isBlackKey,
  midiName,
  pitchClass,
  scalePitchClasses,
} from "@/engine/music/theory";
import type { MelodicInstrument, ScaleName } from "@/engine/types";
import { PAD, useGamepad } from "@/hooks/useGamepad";
import { isTypingTarget, useNoteKeyboard } from "@/hooks/useNoteKeyboard";
import { audioBufferToWav, download, slug, songToMidi } from "@/lib/export";
import {
  DRUM_ROWS,
  STEPS_PER_BAR,
  TRACK_COLORS,
  drumInst,
  generateIntoSong,
  isDrumTrack,
  newSong,
  newTrack,
  progressionNotes,
  songToPattern,
  type Song,
  type SongTrack,
  type StudioNote,
} from "@/lib/song";
import { deleteSong, getSong, listSongs, saveSong } from "@/lib/store";
import { bounceToLoop, HowlLoop } from "@/engine/audio/looper";

const MELODIC: MelodicInstrument[] = ["piano", "epiano", "guitar", "bass", "synth", "strings"];
const LENGTHS = [
  { steps: 1, label: "1/16" },
  { steps: 2, label: "1/8" },
  { steps: 4, label: "1/4" },
  { steps: 8, label: "1/2" },
  { steps: 16, label: "1" },
];
const ROW_H = 22;
const LABEL_W = 56;

function defaultLow(t: SongTrack | undefined): number {
  if (!t) return 48;
  if (t.inst === "bass" || t.role === "bass") return 28;
  if (t.role === "chord") return 45;
  return 55;
}

export default function StudioClient() {
  const engine = useMemo(() => getEngine(), []);
  const [song, setSong] = useState<Song>(() => newSong());
  const [selId, setSelId] = useState<string>(song.tracks[0].id);
  const [lenSteps, setLenSteps] = useState(2);
  const [scaleLock, setScaleLock] = useState(true);
  const [low, setLow] = useState(55);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [metro, setMetro] = useState(false);
  const [cursor, setCursor] = useState({ step: 0, row: 6 });
  const [kbBase, setKbBase] = useState(60);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [status, setStatus] = useState<string>("");
  const [progId, setProgId] = useState("pop");
  const [progStyle, setProgStyle] = useState<"block" | "strum" | "arp">("strum");
  const [density, setDensity] = useState(0.6);
  const [stepW, setStepW] = useState(26);
  const [held, setHeld] = useState<Set<number>>(new Set());
  const [transposeWithKey, setTransposeWithKey] = useState(true);
  const velDrag = useRef(false);
  const velRef = useRef<HTMLDivElement>(null);
  const [bounce, setBounce] = useState<number | null>(null);
  const [loopState, setLoopState] = useState<"off" | "rendering" | "playing">("off");
  const [loopPan, setLoopPan] = useState(0);
  const loopRef = useRef<HowlLoop | null>(null);

  const history = useRef<Song[]>([]);
  const future = useRef<Song[]>([]);
  const trackId = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ midi: number; step: number } | null>(null);
  const voices = useRef(new Map<string, Voice>());
  const liveRec = useRef(new Map<string, { midi: number; startAbs: number }>());
  const stepHeld = useRef(0);
  const songRef = useRef(song);
  songRef.current = song;

  const track = song.tracks.find((t) => t.id === selId) ?? song.tracks[0];
  const drum = isDrumTrack(track);
  const totalSteps = song.bars * STEPS_PER_BAR;

  const rows = useMemo<number[]>(() => {
    if (drum) return DRUM_ROWS.map((r) => r.midi);
    const out: number[] = [];
    for (let m = low + 24; m >= low; m--) {
      if (!scaleLock || inScale(m, song.root, song.scale)) out.push(m);
    }
    return out;
  }, [drum, low, scaleLock, song.root, song.scale]);

  // ----------------------------------------------------------- mutations
  const update = useCallback((fn: (s: Song) => Song, record = true) => {
    setSong((prev) => {
      if (record) {
        history.current.push(prev);
        if (history.current.length > 80) history.current.shift();
        future.current = [];
      }
      return { ...fn(prev), updatedAt: Date.now() };
    });
  }, []);

  const updateTrack = useCallback(
    (id: string, fn: (t: SongTrack) => SongTrack, record = true) =>
      update((s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === id ? fn(t) : t)) }), record),
    [update],
  );

  const addNotes = useCallback(
    (id: string, notes: StudioNote[]) => updateTrack(id, (t) => ({ ...t, notes: [...t.notes, ...notes] })),
    [updateTrack],
  );

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(songRef.current);
    setSong(prev);
  }, []);
  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    history.current.push(songRef.current);
    setSong(nxt);
  }, []);

  const flashStatus = (s: string) => {
    setStatus(s);
    window.setTimeout(() => setStatus((c) => (c === s ? "" : c)), 2200);
  };

  // ------------------------------------------------------------ load/save
  useEffect(() => {
    setSongs(listSongs());
    const id = new URLSearchParams(window.location.search).get("song");
    const found = id ? getSong(id) : listSongs()[0];
    if (found) {
      setSong(found);
      setSelId(found.tracks[0]?.id ?? "");
      setLow(defaultLow(found.tracks[0]));
    }
    const f = () => setStepW(window.innerWidth < 640 ? 30 : 26);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveSong(song);
      setSongs(listSongs());
    }, 700);
    return () => window.clearTimeout(t);
  }, [song]);

  // ------------------------------------------------------------- transport
  const withAudio = useCallback(
    (fn: () => void) => {
      if (engine.context) fn();
      else void engine.ensure().then(fn);
    },
    [engine],
  );

  const play = useCallback(async () => {
    await engine.start(songRef.current.bpm);
    trackId.current = engine.addTrack(songToPattern(songRef.current), { startBeat: 0, loop: true });
    setPlaying(true);
  }, [engine]);

  const stop = useCallback(() => {
    engine.stop();
    trackId.current = null;
    setPlaying(false);
    setRecording(false);
    if (playheadRef.current) playheadRef.current.style.transform = "translateX(0px)";
  }, [engine]);

  const togglePlay = useCallback(() => {
    if (playing) stop();
    else void play();
  }, [playing, play, stop]);

  const toggleRecord = useCallback(() => {
    if (recording) {
      setRecording(false);
      return;
    }
    setRecording(true);
    if (!playing) void play();
  }, [recording, playing, play]);

  useEffect(() => {
    if (playing && trackId.current !== null) engine.replaceTrack(trackId.current, songToPattern(song));
  }, [song, playing, engine]);

  useEffect(() => {
    if (playing) void play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.bpm]);

  useEffect(() => engine.setMetronome(metro), [engine, metro]);
  useEffect(() => () => engine.stop(), [engine]);

  // playhead
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const L = songRef.current.bars * 4;
      const b = engine.beatNow();
      const pos = b < 0 ? 0 : b % L;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${pos * 4 * stepW}px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, engine, stepW]);

  // ------------------------------------------------------------ note input
  const instFor = (t: SongTrack, midi: number) => (isDrumTrack(t) ? drumInst(midi) : t.inst);

  const preview = (t: SongTrack, midi: number, vel = 0.8) =>
    withAudio(() => engine.noteOn(instFor(t, midi), midi, { vel, dur: isDrumTrack(t) ? 0.2 : 0.35 }));

  const mapKeyToTrack = (midi: number): number => {
    if (!drum) return midi;
    const off = ((midi - kbBase) % DRUM_ROWS.length + DRUM_ROWS.length) % DRUM_ROWS.length;
    return DRUM_ROWS[DRUM_ROWS.length - 1 - off].midi;
  };

  const inputOn = (key: string, rawMidi: number, vel = 0.8) => {
    const midi = mapKeyToTrack(rawMidi);
    const t = track;
    withAudio(() => {
      voices.current.get(key)?.release();
      voices.current.set(key, engine.press(instFor(t, midi), midi, vel));
    });
    setHeld((h) => new Set(h).add(midi));
    if (recording && playing) {
      liveRec.current.set(key, { midi, startAbs: engine.beatNow() });
    } else if (!playing) {
      stepHeld.current++;
      addNotes(t.id, [{ step: cursor.step, midi, len: drum ? 1 : lenSteps, vel }]);
    }
  };

  const inputOff = (key: string) => {
    voices.current.get(key)?.release();
    voices.current.delete(key);
    setHeld(new Set());
    const rec = liveRec.current.get(key);
    if (rec) {
      liveRec.current.delete(key);
      const L = song.bars * 4;
      const startPos = ((rec.startAbs % L) + L) % L;
      const step = Math.round(startPos * 4) % totalSteps;
      const len = drum ? 1 : Math.max(1, Math.round((engine.beatNow() - rec.startAbs) * 4));
      addNotes(track.id, [{ step, midi: rec.midi, len, vel: 0.8 }]);
    } else if (!playing && stepHeld.current > 0) {
      stepHeld.current--;
      if (stepHeld.current === 0) setCursor((c) => ({ ...c, step: (c.step + (drum ? 1 : lenSteps)) % totalSteps }));
    }
  };

  const toggleAt = (step: number, midi: number) => {
    const hit = track.notes.findIndex((n) => n.midi === midi && step >= n.step && step < n.step + n.len);
    if (hit >= 0) {
      updateTrack(track.id, (t) => ({ ...t, notes: t.notes.filter((_, i) => i !== hit) }));
      return false;
    }
    addNotes(track.id, [{ step, midi, len: drum ? 1 : lenSteps, vel: 0.8 }]);
    preview(track, midi);
    return true;
  };

  // --------------------------------------------------------- musical tools
  const changeKey = (pc: number) => {
    const delta = pc - pitchClass(song.root);
    update((s) => ({
      ...s,
      root: 48 + pc,
      tracks: s.tracks.map((t) =>
        transposeWithKey && !isDrumTrack(t) && delta !== 0
          ? { ...t, notes: t.notes.map((n) => ({ ...n, midi: Math.max(0, Math.min(127, n.midi + delta)) })) }
          : t,
      ),
    }));
    if (delta !== 0 && transposeWithKey) flashStatus(`Transposed ${delta > 0 ? "+" : ""}${delta} semitones`);
  };

  const quantizeTrack = () => {
    const grid = Math.max(1, lenSteps);
    updateTrack(track.id, (t) => ({
      ...t,
      notes: t.notes.map((n) => ({
        ...n,
        step: Math.min(totalSteps - 1, Math.round(n.step / grid) * grid),
        len: Math.max(1, Math.round(n.len / grid) * grid),
      })),
    }));
    flashStatus(`Quantised to ${grid}/16`);
  };

  /** Musical humanising: accents on the beat, gentle pushes on the off-beats. */
  const humanizeTrack = () => {
    updateTrack(track.id, (t) => ({
      ...t,
      notes: t.notes.map((n) => {
        const onBeat = n.step % 4 === 0;
        const barStart = n.step % 16 === 0;
        const jitter = (Math.random() - 0.5) * (onBeat ? 0.5 : 1.4);
        const accent = barStart ? 0.12 : onBeat ? 0.06 : -0.04;
        return {
          ...n,
          step: Math.max(0, Math.min(totalSteps - 1, Math.round(n.step + jitter))),
          vel: Math.max(0.12, Math.min(1, n.vel + accent + (Math.random() - 0.5) * 0.09)),
        };
      }),
    }));
    flashStatus("Humanised timing and accents");
  };

  const snapToScale = () => {
    const pcs = scalePitchClasses(song.root, song.scale);
    let moved = 0;
    updateTrack(track.id, (t) => ({
      ...t,
      notes: t.notes.map((n) => {
        if (isDrumTrack(t) || pcs.includes(pitchClass(n.midi))) return n;
        for (let d = 1; d <= 6; d++) {
          if (pcs.includes(pitchClass(n.midi - d))) { moved++; return { ...n, midi: n.midi - d }; }
          if (pcs.includes(pitchClass(n.midi + d))) { moved++; return { ...n, midi: n.midi + d }; }
        }
        return n;
      }),
    }));
    flashStatus(moved ? `${moved} notes pulled into the key` : "Already in the key");
  };

  const velAt = (e: React.PointerEvent) => {
    const el = velRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const step = Math.max(0, Math.min(totalSteps - 1, Math.floor((e.clientX - r.left) / stepW)));
    const v = Math.max(0.08, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    updateTrack(
      track.id,
      (t) => {
        let idx = -1;
        for (let i = t.notes.length - 1; i >= 0; i--) {
          const n = t.notes[i];
          if (step >= n.step && step < n.step + Math.max(1, n.len)) { idx = i; break; }
        }
        if (idx < 0) return t;
        const notes = [...t.notes];
        notes[idx] = { ...notes[idx], vel: v };
        return { ...t, notes };
      },
      false,
    );
  };

  // ------------------------------------------------------------ grid pointer
  const cellAt = (e: React.PointerEvent) => {
    const r = gridRef.current!.getBoundingClientRect();
    const step = Math.max(0, Math.min(totalSteps - 1, Math.floor((e.clientX - r.left) / stepW)));
    const row = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - r.top) / ROW_H)));
    return { step, row, midi: rows[row] };
  };
  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const c = cellAt(e);
    setCursor({ step: c.step, row: c.row });
    const added = toggleAt(c.step, c.midi);
    if (added && !drum) {
      drag.current = { midi: c.midi, step: c.step };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onGridMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const c = cellAt(e);
    const len = Math.max(1, c.step - d.step + 1);
    updateTrack(
      track.id,
      (t) => ({ ...t, notes: t.notes.map((n) => (n.midi === d.midi && n.step === d.step ? { ...n, len } : n)) }),
      false,
    );
  };
  const onGridUp = () => {
    drag.current = null;
  };

  // --------------------------------------------------------------- keyboard
  const selIndex = song.tracks.findIndex((t) => t.id === track.id);
  const selectTrack = (i: number) => {
    const t = song.tracks[(i + song.tracks.length) % song.tracks.length];
    if (!t) return;
    setSelId(t.id);
    setLow(defaultLow(t));
  };

  useNoteKeyboard({
    base: kbBase,
    onNoteOn: (m, code) => inputOn(`k:${code}`, m),
    onNoteOff: (_m, code) => inputOff(`k:${code}`),
    onOtherKey: (e, down) => {
      if (!down) return e.code === "Space";
      switch (e.code) {
        case "Space":
          if (!e.repeat) togglePlay();
          return true;
        case "ArrowLeft":
          setCursor((c) => ({ ...c, step: (c.step - (e.shiftKey ? 4 : 1) + totalSteps) % totalSteps }));
          return true;
        case "ArrowRight":
          setCursor((c) => ({ ...c, step: (c.step + (e.shiftKey ? 4 : 1)) % totalSteps }));
          return true;
        case "ArrowUp":
          setCursor((c) => ({ ...c, row: Math.max(0, c.row - 1) }));
          return true;
        case "ArrowDown":
          setCursor((c) => ({ ...c, row: Math.min(rows.length - 1, c.row + 1) }));
          return true;
        case "PageUp":
          setKbBase((b) => Math.min(96, b + 12));
          return true;
        case "PageDown":
          setKbBase((b) => Math.max(24, b - 12));
          return true;
        case "Enter":
          toggleAt(cursor.step, rows[cursor.row]);
          return true;
        case "Backspace":
        case "Delete":
          updateTrack(track.id, (t) => ({ ...t, notes: t.notes.filter((n) => !(cursor.step >= n.step && cursor.step < n.step + n.len)) }));
          return true;
        case "Tab":
          selectTrack(selIndex + (e.shiftKey ? -1 : 1));
          return true;
        case "Backquote":
          toggleRecord();
          return true;
        case "Digit1":
        case "Digit4":
        case "Digit8": {
          const map: Record<string, number> = { Digit1: 1, Digit4: 4, Digit8: 8 };
          setLenSteps(map[e.code]);
          return true;
        }
        default:
          return false;
      }
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "s") {
        e.preventDefault();
        saveSong(songRef.current);
        setSongs(listSongs());
        flashStatus("Saved");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---------------------------------------------------------------- gamepad
  const { connected } = useGamepad({
    onButton: (i, pressed) => {
      if (!pressed) return;
      switch (i) {
        case PAD.LEFT:
          setCursor((c) => ({ ...c, step: (c.step - 1 + totalSteps) % totalSteps }));
          break;
        case PAD.RIGHT:
          setCursor((c) => ({ ...c, step: (c.step + 1) % totalSteps }));
          break;
        case PAD.UP:
          setCursor((c) => ({ ...c, row: Math.max(0, c.row - 1) }));
          break;
        case PAD.DOWN:
          setCursor((c) => ({ ...c, row: Math.min(rows.length - 1, c.row + 1) }));
          break;
        case PAD.A:
          toggleAt(cursor.step, rows[cursor.row]);
          setCursor((c) => ({ ...c, step: (c.step + (drum ? 1 : lenSteps)) % totalSteps }));
          break;
        case PAD.B:
          updateTrack(track.id, (t) => ({ ...t, notes: t.notes.filter((n) => !(cursor.step >= n.step && cursor.step < n.step + n.len)) }));
          break;
        case PAD.X:
          togglePlay();
          break;
        case PAD.Y:
          toggleRecord();
          break;
        case PAD.LB:
          selectTrack(selIndex - 1);
          break;
        case PAD.RB:
          selectTrack(selIndex + 1);
          break;
        case PAD.LT:
        case PAD.RT: {
          const idx = LENGTHS.findIndex((l) => l.steps === lenSteps);
          const next = LENGTHS[Math.max(0, Math.min(LENGTHS.length - 1, idx + (i === PAD.RT ? 1 : -1)))];
          setLenSteps(next.steps);
          break;
        }
        case PAD.BACK:
          undo();
          break;
        case PAD.START:
          saveSong(songRef.current);
          flashStatus("Saved");
          break;
        default:
          break;
      }
    },
  });

  // ---------------------------------------------------------------- actions
  const generate = () => {
    update((s) =>
      generateIntoSong(s, {
        seed: Math.floor(Math.random() * 1e9),
        progression: getProgression(progId).degrees,
        density,
      }),
    );
    flashStatus("Composed a new idea");
  };

  const insertProgression = () => {
    const target = song.tracks.find((t) => t.role === "chord") ?? track;
    updateTrack(target.id, (t) => ({ ...t, notes: progressionNotes(song, getProgression(progId).degrees, progStyle) }));
    setSelId(target.id);
    setLow(defaultLow(target));
  };

  const exportWav = async () => {
    setBounce(0);
    flashStatus("Bouncing the live mix…");
    try {
      const buf = await engine.bounce(songToPattern(song), 2, (p) => setBounce(Math.round(p * 100)));
      download(audioBufferToWav(buf), `${slug(song.title)}.wav`, "audio/wav");
      flashStatus("WAV exported · normalised to −14 LUFS");
    } catch {
      try {
        const buf = await MusicEngine.render(songToPattern(song), 2);
        download(audioBufferToWav(buf), `${slug(song.title)}.wav`, "audio/wav");
        flashStatus("WAV exported (offline synths)");
      } catch {
        flashStatus("Export is not supported in this browser");
      }
    } finally {
      setBounce(null);
    }
  };

  const toggleLoop = async () => {
    if (loopState === "playing") {
      loopRef.current?.pause(500);
      setLoopState("off");
      return;
    }
    setLoopState("rendering");
    setBounce(0);
    try {
      const loop = await bounceToLoop(engine, songToPattern(song), (p) => setBounce(Math.round(p * 100)));
      loopRef.current?.dispose();
      loopRef.current = loop;
      loop.setPan(loopPan);
      loop.play(700, 0.9);
      setLoopState("playing");
      flashStatus("Seamless loop running (Howler)");
    } catch {
      setLoopState("off");
      flashStatus("Loop render failed");
    } finally {
      setBounce(null);
    }
  };

  useEffect(() => () => loopRef.current?.dispose(), []);

  const importJson = (file: File) => {
    void file.text().then((txt) => {
      try {
        const s = JSON.parse(txt) as Song;
        if (!Array.isArray(s.tracks)) throw new Error("bad");
        const fresh = { ...s, id: Math.random().toString(36).slice(2) };
        update(() => fresh);
        setSelId(fresh.tracks[0]?.id ?? "");
        flashStatus("Imported");
      } catch {
        flashStatus("Not a valid song file");
      }
    });
  };

  const loadSong = (s: Song) => {
    stop();
    history.current = [];
    setSong(s);
    setSelId(s.tracks[0]?.id ?? "");
    setLow(defaultLow(s.tracks[0]));
    setLibraryOpen(false);
  };

  // ------------------------------------------------------------------ view
  const bg = useMemo(
    () => ({
      backgroundImage: [
        `repeating-linear-gradient(to right, rgba(255,255,255,0.16) 0 1px, transparent 1px ${stepW * 16}px)`,
        `repeating-linear-gradient(to right, rgba(255,255,255,0.08) 0 1px, transparent 1px ${stepW * 4}px)`,
        `repeating-linear-gradient(to right, rgba(255,255,255,0.03) 0 1px, transparent 1px ${stepW}px)`,
      ].join(","),
    }),
    [stepW],
  );

  return (
    <div className="space-y-3">
      {/* Transport */}
      <div className="panel sticky top-14 z-30 flex flex-wrap items-center gap-2 p-2.5">
        <button className={`btn w-24 ${playing ? "btn-teal" : "btn-sun"}`} onClick={togglePlay}>
          {playing ? "■ Stop" : "▶ Play"}
        </button>
        <button className={`btn ${recording ? "btn-rose" : ""}`} onClick={toggleRecord} title="Record (`)">
          <span className={`h-2.5 w-2.5 rounded-full ${recording ? "animate-pulse bg-ebony" : "bg-rose"}`} /> Rec
        </button>
        <button className={`btn ${metro ? "btn-on" : ""}`} onClick={() => setMetro(!metro)}>
          ♩ Click
        </button>
        <label className="flex items-center gap-1 text-sm text-muted">
          <input
            className="field w-16"
            type="number"
            min={40}
            max={240}
            value={song.bpm}
            onChange={(e) => update((s) => ({ ...s, bpm: Math.max(40, Math.min(240, +e.target.value || 100)) }), false)}
          />
          BPM
        </label>
        <select className="field" value={song.bars} onChange={(e) => update((s) => ({ ...s, bars: +e.target.value }))}>
          {[1, 2, 4, 8, 12, 16].map((b) => (
            <option key={b} value={b}>
              {b} bar{b > 1 ? "s" : ""}
            </option>
          ))}
        </select>
        <select className="field" value={pitchClass(song.root)} onChange={(e) => changeKey(+e.target.value)}>
          {NOTE_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select className="field max-w-[150px]" value={song.scale} onChange={(e) => update((s) => ({ ...s, scale: e.target.value as ScaleName }))}>
          {SCALE_NAMES.map((s) => (
            <option key={s} value={s}>
              {SCALE_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="hidden items-center gap-1 text-xs text-muted sm:flex">
          Swing
          <input type="range" min={0} max={0.6} step={0.05} value={song.swing} onChange={(e) => update((s) => ({ ...s, swing: +e.target.value }), false)} />
        </label>
        <button
          className={`btn ${loopState === "playing" ? "btn-teal" : ""}`}
          onClick={() => void toggleLoop()}
          disabled={loopState === "rendering"}
          title="Bounce and loop seamlessly with fades"
        >
          {loopState === "rendering" ? `Loop ${bounce ?? 0}%` : loopState === "playing" ? "◼ Loop" : "↻ Loop"}
        </button>
        {loopState === "playing" && (
          <label className="flex items-center gap-1 text-xs text-muted">
            Pan
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={loopPan}
              onChange={(e) => {
                const v = +e.target.value;
                setLoopPan(v);
                loopRef.current?.setPan(v);
              }}
            />
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          {bounce !== null && <span className="text-xs text-maple">bounce {bounce}%</span>}
          <span className="hidden text-xs text-teal sm:inline">{status}</span>
          <button className="btn" onClick={undo} title="Undo (Ctrl+Z)">↶</button>
          <button className="btn" onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
          <button className="btn" onClick={() => setLibraryOpen(!libraryOpen)}>Songs</button>
        </div>
      </div>

      {libraryOpen && (
        <div className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="label mr-auto">Song library (saved on this device)</p>
            <button className="btn btn-sun" onClick={() => loadSong(newSong())}>+ New song</button>
            <button className="btn" onClick={() => download(songToMidi(song), `${slug(song.title)}.mid`, "audio/midi")}>Export MIDI</button>
            <button className="btn" onClick={() => void exportWav()}>Export WAV</button>
            <button className="btn" onClick={() => download(JSON.stringify(song, null, 2), `${slug(song.title)}.json`, "application/json")}>Export JSON</button>
            <label className="btn cursor-pointer">
              Import JSON
              <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {songs.length === 0 && <p className="text-sm text-muted">No saved songs yet. Your work autosaves as you go.</p>}
            {songs.map((s) => (
              <div key={s.id} className={`flex items-center gap-2 rounded-xl border p-2.5 ${s.id === song.id ? "border-sun" : "border-line"}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => loadSong(s)}>
                  <p className="truncate text-sm font-semibold">{s.title}</p>
                  <p className="text-xs text-muted">
                    {s.bpm} BPM · {NOTE_NAMES[pitchClass(s.root)]} {s.scale} · {s.bars} bars
                  </p>
                </button>
                <Link className="btn px-2 text-xs" href={`/arena?song=${s.id}`}>Arena</Link>
                <button
                  className="btn px-2 text-xs"
                  onClick={() => {
                    deleteSong(s.id);
                    setSongs(listSongs());
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
        {/* Tracks */}
        <aside className="min-w-0 space-y-2">
          <input
            className="field w-full text-base font-semibold"
            value={song.title}
            onChange={(e) => update((s) => ({ ...s, title: e.target.value }), false)}
            aria-label="Song title"
          />
          <div className="no-scrollbar flex gap-2 overflow-x-auto lg:flex-col">
            {song.tracks.map((t, i) => {
              const sel = t.id === track.id;
              return (
                <div
                  key={t.id}
                  onClick={() => selectTrack(i)}
                  className={`min-w-[200px] cursor-pointer rounded-xl border p-2.5 transition ${sel ? "border-sun bg-panel2" : "border-line bg-panel"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-1.5 rounded-full" style={{ background: t.color }} />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                      value={t.name}
                      onChange={(e) => updateTrack(t.id, (x) => ({ ...x, name: e.target.value }), false)}
                    />
                    <button
                      className={`rounded px-1.5 text-xs font-bold ${t.muted ? "bg-rose text-ebony" : "bg-line text-muted"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateTrack(t.id, (x) => ({ ...x, muted: !x.muted }));
                      }}
                    >
                      M
                    </button>
                    <button
                      className={`rounded px-1.5 text-xs font-bold ${t.solo ? "bg-maple text-ebony" : "bg-line text-muted"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateTrack(t.id, (x) => ({ ...x, solo: !x.solo }));
                      }}
                    >
                      S
                    </button>
                  </div>
                  {sel && (
                    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                      {!isDrumTrack(t) ? (
                        <>
                          <select
                            className="field w-full"
                            value={t.inst}
                            onChange={(e) => updateTrack(t.id, (x) => ({ ...x, inst: e.target.value as MelodicInstrument }))}
                          >
                            {MELODIC.map((m) => (
                              <option key={m} value={m}>
                                {INSTRUMENT_LABELS[m]} · voice slot
                              </option>
                            ))}
                          </select>
                          <PatchPicker engine={engine} inst={t.inst} label="Patch" />
                        </>
                      ) : (
                        <p className="text-xs text-muted">Drum kit · sampled cymbals + modelled shells</p>
                      )}
                      <label className="flex items-center gap-2 text-xs text-muted">
                        Vol
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={t.volume}
                          className="flex-1"
                          onChange={(e) => updateTrack(t.id, (x) => ({ ...x, volume: +e.target.value }), false)}
                        />
                      </label>
                      <div className="flex gap-1.5">
                        <button className="btn flex-1 px-2 text-xs" onClick={() => updateTrack(t.id, (x) => ({ ...x, notes: [] }))}>
                          Clear
                        </button>
                        {!isDrumTrack(t) && (
                          <>
                            <button className="btn px-2 text-xs" onClick={() => updateTrack(t.id, (x) => ({ ...x, notes: x.notes.map((n) => ({ ...n, midi: n.midi - 12 })) }))}>
                              −8va
                            </button>
                            <button className="btn px-2 text-xs" onClick={() => updateTrack(t.id, (x) => ({ ...x, notes: x.notes.map((n) => ({ ...n, midi: n.midi + 12 })) }))}>
                              +8va
                            </button>
                          </>
                        )}
                        {song.tracks.length > 1 && (
                          <button
                            className="btn px-2 text-xs"
                            onClick={() => {
                              update((s) => ({ ...s, tracks: s.tracks.filter((x) => x.id !== t.id) }));
                              selectTrack(0);
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex min-w-[200px] gap-2">
              <button
                className="btn flex-1 text-xs"
                onClick={() => update((s) => ({ ...s, tracks: [...s.tracks, newTrack({ name: "Synth", inst: "synth", role: "melody", color: TRACK_COLORS[s.tracks.length % TRACK_COLORS.length] })] }))}
              >
                + Instrument
              </button>
              <button
                className="btn flex-1 text-xs"
                onClick={() => update((s) => ({ ...s, tracks: [...s.tracks, newTrack({ name: "Drums 2", inst: "kick", role: "drum", color: TRACK_COLORS[s.tracks.length % TRACK_COLORS.length] })] }))}
              >
                + Drums
              </button>
            </div>
          </div>

          <section className="panel hidden space-y-2 p-3 lg:block">
            <p className="label">Composer</p>
            <select className="field w-full" value={progId} onChange={(e) => setProgId(e.target.value)}>
              {PROGRESSIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted">
              Density
              <input type="range" min={0.2} max={1} step={0.05} value={density} className="flex-1" onChange={(e) => setDensity(+e.target.value)} />
            </label>
            <button className="btn btn-sun w-full" onClick={generate}>✦ Compose idea</button>
            <div className="flex gap-1.5">
              <select className="field flex-1" value={progStyle} onChange={(e) => setProgStyle(e.target.value as "block" | "strum" | "arp")}>
                <option value="block">Block chords</option>
                <option value="strum">Strum rhythm</option>
                <option value="arp">Arpeggio</option>
              </select>
              <button className="btn" onClick={insertProgression}>Insert</button>
            </div>
          </section>
        </aside>

        {/* Piano roll */}
        <section className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-line">
              {LENGTHS.map((l) => (
                <button
                  key={l.steps}
                  className={`px-2.5 py-1.5 text-xs font-semibold ${lenSteps === l.steps ? "bg-sun text-ebony" : "bg-panel2 text-muted hover:text-ivory"}`}
                  onClick={() => setLenSteps(l.steps)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {!drum && (
              <>
                <button className={`btn px-2.5 py-1.5 text-xs ${scaleLock ? "btn-on" : ""}`} onClick={() => setScaleLock(!scaleLock)}>
                  Scale lock
                </button>
                <button className="btn px-2.5 py-1.5 text-xs" onClick={() => setLow((l) => Math.max(12, l - 12))}>▼ Oct</button>
                <button className="btn px-2.5 py-1.5 text-xs" onClick={() => setLow((l) => Math.min(96, l + 12))}>▲ Oct</button>
              </>
            )}
            <button className="btn btn-sun px-2.5 py-1.5 text-xs lg:hidden" onClick={generate}>✦ Compose</button>
            <button className="btn px-2.5 py-1.5 text-xs lg:hidden" onClick={insertProgression}>Chords</button>
            <span className="ml-auto text-xs text-muted">
              {track.name} · {track.notes.length} notes · cursor {Math.floor(cursor.step / 16) + 1}.{Math.floor((cursor.step % 16) / 4) + 1}.{(cursor.step % 4) + 1}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-2 py-1.5">
            <span className="label mr-1">Feel</span>
            <button className="btn px-2.5 py-1 text-xs" onClick={quantizeTrack}>Quantise</button>
            <button className="btn px-2.5 py-1 text-xs" onClick={humanizeTrack}>Humanise</button>
            <button className="btn px-2.5 py-1 text-xs" onClick={snapToScale} disabled={drum}>Snap to key</button>
            <button
              className={`btn px-2.5 py-1 text-xs ${transposeWithKey ? "btn-on" : ""}`}
              onClick={() => setTransposeWithKey(!transposeWithKey)}
              title="Move existing notes when the key changes"
            >
              Key transposes notes
            </button>
            <span className="ml-auto text-[11px] text-muted">drag the velocity lane to shape dynamics</span>
          </div>

          <div className="panel overflow-auto" style={{ maxHeight: "min(62vh, 640px)" }}>
            <div className="relative" style={{ width: LABEL_W + totalSteps * stepW }}>
              <div className="sticky top-0 z-20 flex bg-panel">
                <div className="sticky left-0 z-30 bg-panel" style={{ width: LABEL_W, minWidth: LABEL_W }} />
                <div className="relative h-6 border-b border-line" style={{ width: totalSteps * stepW }}>
                  {Array.from({ length: song.bars * 4 }, (_, b) => (
                    <button
                      key={b}
                      className={`absolute top-0 h-6 pl-1 text-left text-[10px] font-semibold ${b % 4 === 0 ? "text-ivory" : "text-muted/60"}`}
                      style={{ left: b * 4 * stepW, width: 4 * stepW }}
                      onClick={() => setCursor((c) => ({ ...c, step: b * 4 }))}
                    >
                      {b % 4 === 0 ? b / 4 + 1 : `·${(b % 4) + 1}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex">
                <div className="sticky left-0 z-10 bg-panel" style={{ width: LABEL_W, minWidth: LABEL_W }}>
                  {rows.map((m, r) => {
                    const label = drum ? DRUM_ROWS.find((d) => d.midi === m)?.label ?? "" : midiName(m);
                    const black = !drum && isBlackKey(m);
                    return (
                      <button
                        key={m}
                        onPointerDown={() => preview(track, m)}
                        className={`flex w-full items-center justify-end border-b border-ink/60 pr-1.5 text-[10px] font-semibold ${
                          held.has(m) ? "bg-sun text-ebony" : black ? "bg-[#24222b] text-muted" : "bg-[#e9e2d0] text-ebony/70"
                        } ${r === cursor.row ? "outline outline-1 -outline-offset-1 outline-sun" : ""}`}
                        style={{ height: ROW_H }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div
                  ref={gridRef}
                  className="relative cursor-crosshair"
                  style={{ width: totalSteps * stepW, height: rows.length * ROW_H, touchAction: "none" }}
                  onPointerDown={onGridDown}
                  onPointerMove={onGridMove}
                  onPointerUp={onGridUp}
                  onPointerCancel={onGridUp}
                >
                  {rows.map((m, r) => (
                    <div
                      key={m}
                      className={`absolute inset-x-0 border-b border-ink/70 ${
                        !drum && pitchClass(m) === pitchClass(song.root) ? "bg-sun/[0.07]" : !drum && isBlackKey(m) ? "bg-black/25" : ""
                      }`}
                      style={{ top: r * ROW_H, height: ROW_H }}
                    />
                  ))}
                  <div className="pointer-events-none absolute inset-0" style={bg} />
                  <div
                    className="pointer-events-none absolute top-0 bg-maple/10"
                    style={{ left: cursor.step * stepW, width: stepW, height: rows.length * ROW_H }}
                  />
                  <div
                    className="pointer-events-none absolute rounded-sm ring-2 ring-maple"
                    style={{ left: cursor.step * stepW, top: cursor.row * ROW_H, width: stepW, height: ROW_H }}
                  />
                  {track.notes.map((n, i) => {
                    const r = rows.indexOf(n.midi);
                    if (r < 0 || n.step >= totalSteps) return null;
                    return (
                      <div
                        key={`${i}-${n.step}-${n.midi}`}
                        className="pointer-events-none absolute rounded-[4px] border border-black/30"
                        style={{
                          left: n.step * stepW + 1,
                          top: r * ROW_H + 2,
                          width: Math.min(n.len, totalSteps - n.step) * stepW - 2,
                          height: ROW_H - 4,
                          background: track.color,
                          opacity: 0.55 + n.vel * 0.45,
                        }}
                      />
                    );
                  })}
                  <div ref={playheadRef} className="pointer-events-none absolute left-0 top-0 z-10 w-0.5 bg-ivory" style={{ height: rows.length * ROW_H }} />
                </div>
              </div>
              <div className="flex border-t border-line bg-ink/60">
                <div
                  className="sticky left-0 z-10 flex items-end justify-end bg-panel pb-1 pr-1.5 text-[9px] font-bold uppercase tracking-wider text-muted"
                  style={{ width: LABEL_W, minWidth: LABEL_W, height: 56 }}
                >
                  Vel
                </div>
                <div
                  ref={velRef}
                  className="relative cursor-ns-resize"
                  style={{ width: totalSteps * stepW, height: 56, touchAction: "none" }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    velDrag.current = true;
                    history.current.push(songRef.current);
                    velAt(e);
                  }}
                  onPointerMove={(e) => velDrag.current && velAt(e)}
                  onPointerUp={() => (velDrag.current = false)}
                  onPointerCancel={() => (velDrag.current = false)}
                >
                  <div className="pointer-events-none absolute inset-0" style={bg} />
                  {track.notes.map((n, i) => (
                    <div
                      key={`v${i}`}
                      className="pointer-events-none absolute bottom-0 rounded-t-[2px]"
                      style={{
                        left: n.step * stepW + 1,
                        width: Math.max(2, stepW - 2),
                        height: `${n.vel * 100}%`,
                        background: track.color,
                        opacity: 0.5 + n.vel * 0.5,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Overview */}
          <div className="panel space-y-1 p-2">
            {song.tracks.map((t) => (
              <div key={t.id} className="relative h-3 overflow-hidden rounded bg-panel2" onClick={() => setSelId(t.id)}>
                {t.notes.map((n, i) => (
                  <span
                    key={i}
                    className="absolute top-0 h-3"
                    style={{
                      left: `${(n.step / totalSteps) * 100}%`,
                      width: `${Math.max(0.4, (n.len / totalSteps) * 100)}%`,
                      background: t.color,
                      opacity: t.muted ? 0.25 : 0.9,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Input keyboard */}
          <div className="grid gap-2 xl:grid-cols-[1fr_300px]">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted">
                <button className="btn px-2 py-1 text-xs" onClick={() => setKbBase((b) => Math.max(24, b - 12))}>◀</button>
                <span>Input {midiName(kbBase)} · {recording ? "live recording" : playing ? "preview" : "step entry at cursor"}</span>
                <button className="btn px-2 py-1 text-xs" onClick={() => setKbBase((b) => Math.min(96, b + 12))}>▶</button>
              </div>
              <PianoKeyboard
                from={kbBase}
                to={kbBase + 24}
                active={held}
                highlight={drum ? undefined : NOTE_NAMES.map((_, i) => i).filter((pc) => inScale(pc, song.root, song.scale))}
                rootPc={pitchClass(song.root)}
                onDown={(m, v) => inputOn(`p:${m}`, m, v)}
                onUp={(m) => inputOff(`p:${m}`)}
                height={130}
                showNames={false}
              />
              <Visualizer engine={engine} />
            </div>
            <div className="panel space-y-2 p-3 text-xs text-muted">
              <InputStatus gamepad={connected} />
              <ul className="space-y-1.5 pt-1">
                <li><span className="kbd">Z</span>…<span className="kbd">]</span> play / enter notes · <span className="kbd">PgUp</span><span className="kbd">PgDn</span> octave</li>
                <li><span className="kbd">Space</span> play · <span className="kbd">`</span> record · <span className="kbd">Tab</span> next track</li>
                <li><span className="kbd">←→↑↓</span> cursor · <span className="kbd">Enter</span> toggle · <span className="kbd">⌫</span> delete</li>
                <li><span className="kbd">1</span><span className="kbd">4</span><span className="kbd">8</span> length · <span className="kbd">Ctrl Z</span> undo · <span className="kbd">Ctrl S</span> save</li>
                <li>🎮 D-pad cursor · <span className="kbd">A</span> add · <span className="kbd">B</span> delete · <span className="kbd">X</span> play · <span className="kbd">Y</span> rec · <span className="kbd">LB</span><span className="kbd">RB</span> track · <span className="kbd">LT</span><span className="kbd">RT</span> length · <span className="kbd">Back</span> undo</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      <EngineRack engine={engine} title="Mix rack" />
    </div>
  );
}
