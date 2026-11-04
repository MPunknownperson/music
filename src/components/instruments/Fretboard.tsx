"use client";

import { FRET_MARKERS, type Shape, type Tuning } from "@/engine/music/guitar";
import { NOTE_NAMES, INTERVALS, pitchClass } from "@/engine/music/theory";

export interface FretboardProps {
  tuning: Tuning;
  frets: number;
  capo?: number;
  shape?: Shape;
  /** Pitch classes to show as dots (scale overlay). */
  highlight?: number[];
  rootPc?: number;
  /** "stringIndex:fret" keys currently ringing. */
  ringing?: Set<string>;
  labels?: "notes" | "intervals" | "none";
  onPluck?: (stringIndex: number, fret: number) => void;
  onFretSelect?: (stringIndex: number, fret: number) => void;
}

/**
 * Fretboard drawn as a flat grid. Strings run horizontally with the high E on
 * top (tab orientation); thicker lines for lower strings, rosewood board,
 * maple inlays. Tap a position to fret and pluck it.
 */
export default function Fretboard({
  tuning,
  frets,
  capo = 0,
  shape,
  highlight,
  rootPc,
  ringing,
  labels = "notes",
  onPluck,
  onFretSelect,
}: FretboardProps) {
  const hl = new Set(highlight ?? []);
  const rows = tuning.strings.map((_, i) => i).reverse(); // high string first
  const cols = Array.from({ length: frets + 1 }, (_, f) => f);

  const label = (midi: number) => {
    if (labels === "none") return "";
    if (labels === "intervals" && rootPc !== undefined) {
      return INTERVALS[pitchClass(midi - rootPc)]?.short ?? "";
    }
    return NOTE_NAMES[pitchClass(midi)];
  };

  return (
    <div className="no-scrollbar overflow-x-auto rounded-xl">
      <div className="min-w-[860px] select-none" style={{ touchAction: "manipulation" }}>
        <div className="flex pl-10 text-[10px] font-semibold text-muted">
          {cols.map((f) => (
            <div key={f} className={`${f === 0 ? "w-10 flex-none" : "flex-1"} pb-1 text-center`}>
              {f === 0 ? "open" : f}
            </div>
          ))}
        </div>
        <div className="relative rounded-xl bg-[#3a2418]">
          {rows.map((si) => {
            const open = tuning.strings[si];
            const held = shape?.[si];
            const thickness = 1 + (5 - si) * 0.45;
            return (
              <div key={si} className="relative flex h-10 items-center">
                <div className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center font-mono text-xs font-bold text-maple">
                  {NOTE_NAMES[pitchClass(open + capo)]}
                  {held === -1 && <span className="ml-0.5 text-rose">×</span>}
                </div>
                <div
                  className="pointer-events-none absolute left-10 right-0 bg-[#d9d2c3]"
                  style={{ height: thickness, top: `calc(50% - ${thickness / 2}px)`, opacity: held === -1 ? 0.35 : 0.9 }}
                />
                <div className="ml-10 flex h-full flex-1">
                  {cols.map((f) => {
                    const midi = open + f + capo;
                    const isHeld = held === f;
                    const ring = ringing?.has(`${si}:${f}`);
                    const inScale = hl.has(pitchClass(midi));
                    const isRoot = rootPc !== undefined && pitchClass(midi) === rootPc;
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-label={`String ${6 - si}, fret ${f}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          onFretSelect?.(si, f);
                          onPluck?.(si, f);
                        }}
                        className={`relative flex h-full items-center justify-center ${
                          f === 0 ? "w-10 flex-none border-r-[6px] border-[#e9e2d0]" : "flex-1 border-r-2 border-[#a39d92]/70"
                        }`}
                      >
                        {(isHeld || inScale || ring) && (
                          <span
                            className={`z-10 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold transition-transform ${
                              ring ? "scale-110 bg-sun text-ebony" : isHeld ? "bg-ivory text-ebony" : isRoot ? "bg-maple text-ebony" : "bg-teal/85 text-ebony"
                            }`}
                          >
                            {label(midi)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* inlays */}
          <div className="pointer-events-none absolute inset-0 ml-20 flex">
            {cols.slice(1).map((f) => (
              <div key={f} className="relative flex-1">
                {FRET_MARKERS.includes(f) &&
                  (f === 12 ? (
                    <>
                      <span className="absolute left-1/2 top-[30%] h-3 w-3 -translate-x-1/2 rounded-full bg-maple/30" />
                      <span className="absolute left-1/2 top-[63%] h-3 w-3 -translate-x-1/2 rounded-full bg-maple/30" />
                    </>
                  ) : (
                    <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-maple/30" />
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
