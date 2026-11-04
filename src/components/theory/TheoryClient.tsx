"use client";

import { useMemo, useState } from "react";
import Fretboard from "@/components/instruments/Fretboard";
import PianoKeyboard from "@/components/instruments/PianoKeyboard";
import { getEngine } from "@/engine/music/audio";
import { TUNINGS } from "@/engine/music/guitar";
import {
  CHORD_QUALITIES,
  CIRCLE_OF_FIFTHS,
  INTERVALS,
  NOTE_NAMES,
  SCALE_INTERVALS,
  SCALE_LABELS,
  SCALE_MOODS,
  SCALE_NAMES,
  buildChord,
  chordAt,
  getQuality,
  keySignature,
  midiName,
  noteName,
  pitchClass,
  relativeMinorPc,
  romanAt,
  scaleMidi,
  scalePitchClasses,
  scaleSize,
  seventhAt,
} from "@/engine/music/theory";
import type { MelodicInstrument, ScaleName } from "@/engine/types";
import { detectChord } from "@/lib/chords";

const STEP_NAMES: Record<number, string> = { 1: "H", 2: "W", 3: "W+H", 4: "2W" };

export default function TheoryClient() {
  const engine = useMemo(() => getEngine(), []);
  const [rootPc, setRootPc] = useState(0);
  const [scale, setScale] = useState<ScaleName>("major");
  const [inst, setInst] = useState<MelodicInstrument>("piano");
  const [lit, setLit] = useState<Set<number>>(new Set());
  const [chordQ, setChordQ] = useState("maj7");
  const [quiz, setQuiz] = useState<{ a: number; semis: number; answer: number | null; score: number; total: number }>({
    a: 60,
    semis: 7,
    answer: null,
    score: 0,
    total: 0,
  });

  const root = 60 + rootPc;
  const pcs = scalePitchClasses(rootPc, scale);
  const ivs = SCALE_INTERVALS[scale];
  const n = scaleSize(scale);

  const play = (notes: number[], arpeggio = 0) => {
    void engine.ensure().then(() => {
      notes.forEach((m, i) => engine.noteOn(inst, m, { when: engine.now() + i * arpeggio, vel: 0.75, dur: arpeggio ? arpeggio * 1.6 : 1.6 }));
    });
    setLit(new Set(notes));
    window.setTimeout(() => setLit(new Set()), Math.max(600, notes.length * arpeggio * 1000 + 400));
  };

  const playScale = () => {
    const up = scaleMidi(root, scale, 1);
    play([...up, root + 12], 0.22);
  };

  const builtChord = buildChord(root, chordQ);

  const newQuestion = () => {
    const semis = Math.floor(Math.random() * 13);
    const a = 55 + Math.floor(Math.random() * 12);
    setQuiz((q) => ({ ...q, a, semis, answer: null }));
    play([a, a + semis], 0.55);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">Research &amp; learning</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Music theory lab</h1>
        </div>
        <div className="flex gap-2">
          {(["piano", "guitar", "epiano"] as MelodicInstrument[]).map((i) => (
            <button key={i} className={`btn ${inst === i ? "btn-sun" : ""}`} onClick={() => setInst(i)}>
              {i === "epiano" ? "E-piano" : i[0].toUpperCase() + i.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Scale explorer */}
      <section className="panel space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="label mr-2">Scale explorer</p>
          <select className="field" value={rootPc} onChange={(e) => setRootPc(+e.target.value)}>
            {NOTE_NAMES.map((nn, i) => (
              <option key={nn} value={i}>{nn}</option>
            ))}
          </select>
          <select className="field" value={scale} onChange={(e) => setScale(e.target.value as ScaleName)}>
            {SCALE_NAMES.map((s) => (
              <option key={s} value={s}>{SCALE_LABELS[s]}</option>
            ))}
          </select>
          <button className="btn btn-sun" onClick={playScale}>▶ Play scale</button>
        </div>
        <p className="text-sm text-muted">{SCALE_MOODS[scale]}</p>
        <div className="flex flex-wrap gap-2">
          {ivs.map((iv, i) => {
            const next = (ivs[i + 1] ?? 12) - iv;
            return (
              <div key={i} className="flex items-center gap-2">
                <button className="rounded-lg bg-panel2 px-3 py-2 text-center" onClick={() => play([root + iv])}>
                  <span className="block font-mono text-lg font-bold text-sun">{noteName(rootPc + iv)}</span>
                  <span className="block text-[10px] text-muted">{INTERVALS[iv].short}</span>
                </button>
                <span className="text-[10px] font-semibold text-muted">{STEP_NAMES[next] ?? next}</span>
              </div>
            );
          })}
        </div>
        <PianoKeyboard
          from={60}
          to={84}
          active={lit}
          highlight={pcs}
          rootPc={rootPc}
          onDown={(m) => play([m])}
          height={150}
        />
        <Fretboard tuning={TUNINGS[0]} frets={12} highlight={pcs} rootPc={rootPc} labels="intervals" onPluck={(si, f) => play([TUNINGS[0].strings[si] + f])} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Diatonic chords */}
        <section className="panel space-y-3 p-4">
          <p className="label">Chords of the key (harmonised scale)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1">Degree</th>
                  <th>Triad</th>
                  <th>7th chord</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(7, n) }, (_, d) => {
                  const tri = chordAt(root, scale, d);
                  const sev = seventhAt(root, scale, d);
                  return (
                    <tr key={d} className="border-t border-line">
                      <td className="py-2 font-mono font-bold text-maple">{romanAt(root, scale, d)}</td>
                      <td className="font-semibold">{detectChord(tri)}</td>
                      <td className="text-muted">{detectChord(sev)}</td>
                      <td className="space-x-1 text-right">
                        <button className="btn px-2 py-1 text-xs" onClick={() => play(tri)}>Triad</button>
                        <button className="btn px-2 py-1 text-xs" onClick={() => play(sev)}>7th</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Circle of fifths */}
        <section className="panel space-y-3 p-4">
          <p className="label">Circle of fifths</p>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <svg viewBox="-110 -110 220 220" className="w-full max-w-[280px]">
              {CIRCLE_OF_FIFTHS.map((pc, i) => {
                const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
                const x = Math.cos(a) * 85;
                const y = Math.sin(a) * 85;
                const xi = Math.cos(a) * 52;
                const yi = Math.sin(a) * 52;
                const on = pc === rootPc;
                return (
                  <g key={pc} className="cursor-pointer" onClick={() => { setRootPc(pc); setScale("major"); play(buildChord(60 + pc, "maj")); }}>
                    <circle cx={x} cy={y} r={17} fill={on ? "#ff7a29" : "#26252e"} stroke="#34323d" />
                    <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={on ? "#131217" : "#f5efe0"}>
                      {NOTE_NAMES[pc]}
                    </text>
                    <circle cx={xi} cy={yi} r={12} fill={on ? "#f2c46d" : "#1c1b22"} stroke="#34323d" />
                    <text x={xi} y={yi + 3} textAnchor="middle" fontSize="8" fontWeight="600" fill={on ? "#131217" : "#9b98a6"}>
                      {NOTE_NAMES[relativeMinorPc(pc)]}m
                    </text>
                  </g>
                );
              })}
              <circle r={30} fill="#131217" />
              <text y={4} textAnchor="middle" fontSize="11" fill="#f5efe0" fontWeight="700">
                {NOTE_NAMES[rootPc]}
              </text>
            </svg>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted">Key signature: </span>
                <b>
                  {keySignature(rootPc) === 0 ? "none" : keySignature(rootPc) > 0 ? `${keySignature(rootPc)} ♯` : `${-keySignature(rootPc)} ♭`}
                </b>
              </p>
              <p><span className="text-muted">Relative minor: </span><b>{NOTE_NAMES[relativeMinorPc(rootPc)]}m</b></p>
              <p><span className="text-muted">Dominant (V): </span><b>{NOTE_NAMES[pitchClass(rootPc + 7)]}</b></p>
              <p><span className="text-muted">Subdominant (IV): </span><b>{NOTE_NAMES[pitchClass(rootPc + 5)]}</b></p>
              <p className="text-xs text-muted">Neighbouring keys share six of seven notes, so modulating clockwise or anticlockwise sounds smooth.</p>
            </div>
          </div>
        </section>

        {/* Chord builder */}
        <section className="panel space-y-3 p-4">
          <p className="label">Chord builder · {NOTE_NAMES[rootPc]}{getQuality(chordQ).symbol}</p>
          <div className="flex flex-wrap gap-1.5">
            {CHORD_QUALITIES.map((q) => (
              <button key={q.id} className={`btn px-2.5 py-1.5 text-xs ${chordQ === q.id ? "btn-on" : ""}`} onClick={() => { setChordQ(q.id); play(buildChord(root, q.id)); }}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {builtChord.map((m, i) => (
              <span key={i} className="rounded-lg bg-panel2 px-3 py-1.5 font-mono text-sm">
                {midiName(m)} <span className="text-xs text-muted">{INTERVALS[(m - root) % 12]?.short}</span>
              </span>
            ))}
            <button className="btn btn-sun" onClick={() => play(builtChord)}>▶ Block</button>
            <button className="btn" onClick={() => play(builtChord, 0.18)}>▶ Arp</button>
          </div>
        </section>

        {/* Intervals & ear training */}
        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="label">Intervals &amp; ear training</p>
            <span className="font-mono text-sm text-teal">{quiz.score}/{quiz.total}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {INTERVALS.map((iv) => {
              const state =
                quiz.answer === null ? "" : iv.semis === quiz.semis ? "btn-teal" : iv.semis === quiz.answer ? "btn-rose" : "";
              return (
                <button
                  key={iv.semis}
                  title={iv.feel}
                  className={`btn flex-col px-1 py-1.5 ${state}`}
                  onClick={() => {
                    if (quiz.total > 0 && quiz.answer === null) {
                      setQuiz((q) => ({ ...q, answer: iv.semis, score: q.score + (iv.semis === q.semis ? 1 : 0) }));
                    } else {
                      play([60, 60 + iv.semis], 0.45);
                    }
                  }}
                >
                  <span className="font-mono text-sm">{iv.short}</span>
                  <span className="text-[9px] font-normal opacity-70">{iv.name}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sun" onClick={() => { setQuiz((q) => ({ ...q, total: q.total + 1 })); newQuestion(); }}>
              New question
            </button>
            <button className="btn" onClick={() => play([quiz.a, quiz.a + quiz.semis], 0.55)} disabled={quiz.total === 0}>
              Replay
            </button>
            <span className="self-center text-xs text-muted">
              {quiz.total === 0 ? "Tap an interval to hear it, or start a quiz." : quiz.answer === null ? "Which interval was that?" : INTERVALS[quiz.semis].feel}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
