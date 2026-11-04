"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArenaGame, type ArenaEvent } from "@/engine/game/arena";
import { buildProfile, generateRules } from "@/engine/game/adaptive";
import { bridgeArenaToMusic } from "@/engine/integration";
import { getEngine } from "@/engine/music/audio";
import { composePattern } from "@/engine/music/composer";
import { SCALE_LABELS, midiName } from "@/engine/music/theory";
import type {
  BehaviorProfile,
  GameRules,
  InputMode,
  NoteEvent,
  Pattern,
  RunSummary,
  SessionSummary,
} from "@/engine/types";
import { useMotion } from "@/hooks/useMotion";
import { songToArenaPattern } from "@/lib/song";
import { addSession, listSessions, listSongs } from "@/lib/store";

const W = 420;
const H = 640;
const AHEAD_BEATS = 4;

const LANE_KEYS: Record<number, string[]> = {
  3: ["f", " ", "j"],
  4: ["d", "f", "j", "k"],
  5: ["d", "f", " ", "j", "k"],
};

const JUDGE_STYLE = {
  perfect: { text: "PERFECT", color: "#f2c46d" },
  great: { text: "GREAT", color: "#35c9b0" },
  good: { text: "GOOD", color: "#4fb3ff" },
  miss: { text: "MISS", color: "#ff4d6d" },
} as const;

interface SessionRow extends SessionSummary {
  id: number;
  mode: string;
  score: number;
  createdAt: string;
}

interface SavedComposition {
  id: string;
  title: string;
  bpm: number;
  instrument: string;
  events: NoteEvent[];
}

interface Hud {
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  misses: number;
  accuracy: number;
}

const EMPTY_HUD: Hud = { score: 0, combo: 0, maxCombo: 0, hits: 0, misses: 0, accuracy: 0 };

type Flash = { text: string; color: string; t: number } | null;

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

function drawArena(canvas: HTMLCanvasElement, g: ArenaGame, flash: Flash, now: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  if (canvas.width !== Math.round(W * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const L = g.laneCount;
  const laneW = W / L;
  const hitY = H - 110;
  const pxPerBeat = (hitY - 30) / AHEAD_BEATS;
  const beat = g.currentBeat();

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#131217");
  bg.addColorStop(1, "#131217");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < L; i++) {
    ctx.fillStyle =
      i === g.playerLane ? "rgba(255,122,41,0.18)" : i % 2 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.07)";
    ctx.fillRect(i * laneW, 0, laneW, H);
  }

  for (let b = Math.floor(beat) - 1; b <= beat + AHEAD_BEATS; b++) {
    const y = hitY - (b - beat) * pxPerBeat;
    if (y < 0 || y > H) continue;
    ctx.fillStyle = b % 4 === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.07)";
    ctx.fillRect(0, y, W, b % 4 === 0 ? 2 : 1);
  }

  for (const n of g.visibleNotes(beat, AHEAD_BEATS, 0.8)) {
    const dt = n.hitBeat - beat;
    const y = hitY - dt * pxPerBeat;
    const x = n.lane * laneW + laneW * 0.1;
    const w = laneW * 0.8;
    const h = 18;
    ctx.save();
    if (n.state === "pending") {
      ctx.fillStyle = `hsl(${200 + n.lane * 35} 95% 62%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 14;
    } else if (n.state === "hit") {
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - Math.max(0, -dt) * 4));
      ctx.fillStyle = "#f2c46d";
      ctx.shadowColor = "#f2c46d";
      ctx.shadowBlur = 20;
    } else {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#ff4d6d";
    }
    roundRect(ctx, x, y - h / 2, w, h, 8);
    ctx.restore();
  }

  ctx.fillStyle = "#f5efe0";
  ctx.fillRect(0, hitY - 2, W, 4);

  const px = g.playerLane * laneW;
  ctx.fillStyle = "rgba(53,201,176,0.6)";
  ctx.fillRect(px + 6, hitY + 14, laneW - 12, 8);

  if (flash && now - flash.t < 450) {
    ctx.save();
    ctx.globalAlpha = 1 - (now - flash.t) / 450;
    ctx.fillStyle = flash.color;
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(flash.text, W / 2, hitY - 130);
    ctx.restore();
  }

  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = "#ff7a29";
  ctx.fillRect(0, H - 6, W * g.progress(), 6);
}

function Meter({ label, value, display }: { label: string; value: number; display: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono text-ivory">{display}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-lg bg-panel2">
        <div
          className="h-full rounded-lg bg-sun transition-[width] duration-300"
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function ArenaClient({ initialCompId }: { initialCompId: string | null }) {
  const [audio] = useState(() => getEngine());
  const gameRef = useRef<ArenaGame | null>(null);
  const disposeBridgeRef = useRef<(() => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flashRef = useRef<Flash>(null);

  const [mode, setMode] = useState<InputMode>("keyboard");
  const [source, setSource] = useState<string>(initialCompId ?? "adaptive");
  const [runs, setRuns] = useState<SessionRow[]>([]);
  const [profile, setProfile] = useState<BehaviorProfile>(() => buildProfile([]));
  const [rules, setRules] = useState<GameRules>(() => generateRules(buildProfile([])));
  const [comps, setComps] = useState<SavedComposition[]>([]);
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motionOn, setMotionOn] = useState(false);
  const [tiltView, setTiltView] = useState(0);

  const handleShake = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.finished) return;
    g.hit(g.playerLane, "shake");
  }, []);

  const motion = useMotion(motionOn && mode === "tilt", handleShake);
  const { reading, permission, request } = motion;

  const refreshAdaptive = useCallback(async () => {
    try {
      const data = { sessions: listSessions(20) as SessionRow[] };
      const summaries: SessionSummary[] = data.sessions.map((s) => ({
        accuracy: s.accuracy,
        meanOffsetMs: s.meanOffsetMs,
        motionRatio: s.motionRatio,
        maxCombo: s.maxCombo,
        bpm: s.bpm,
        laneCount: s.laneCount,
        hits: s.hits,
        misses: s.misses,
      }));
      const p = buildProfile(summaries);
      setRuns(data.sessions);
      setProfile(p);
      setRules(generateRules(p));
    } catch {
      setError("Could not load run history");
    }
  }, []);

  const loadComps = useCallback(async () => {
    try {
      const data: SavedComposition[] = listSongs()
        .map((song) => {
          const pattern = songToArenaPattern(song);
          const lead = song.tracks.find((t) => t.role === "melody");
          return { id: song.id, title: song.title, bpm: song.bpm, instrument: lead?.inst ?? "piano", events: pattern.events };
        })
        .filter((c) => c.events.some((e) => e.role === "melody"));
      setComps(data);
    } catch {
      setError("Could not load compositions");
    }
  }, []);

  useEffect(() => {
    void refreshAdaptive();
    void loadComps();
    return () => {
      disposeBridgeRef.current?.();
      audio.stop();
    };
  }, [audio, refreshAdaptive, loadComps]);

  // Keyboard controls: lane keys hit, arrows move the cursor, Enter hits the cursor lane.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g || g.finished) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (!e.repeat) g.moveLane(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.repeat) return;
      const keys = LANE_KEYS[g.laneCount] ?? [];
      const idx = keys.indexOf(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (idx >= 0) {
        e.preventDefault();
        g.playerLane = idx;
        g.hit(idx, "keyboard");
      } else if (e.key === "Enter") {
        g.hit(g.playerLane, "keyboard");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Poll the tilt sensor for the on-screen meter.
  useEffect(() => {
    if (!motionOn) return;
    const id = window.setInterval(() => setTiltView(reading.current.tilt), 120);
    return () => window.clearInterval(id);
  }, [motionOn, reading]);

  // Render + update loop, active only while a run is in progress.
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let lastUi = 0;
    const frame = (t: number) => {
      const g = gameRef.current;
      if (!g || g.finished) return;
      if (g.mode === "tilt") g.setLaneFromTilt(reading.current.tilt);
      g.update();
      if (canvasRef.current) drawArena(canvasRef.current, g, flashRef.current, t);
      if (t - lastUi > 100) {
        lastUi = t;
        setHud({
          score: g.score,
          combo: g.combo,
          maxCombo: g.maxCombo,
          hits: g.hits,
          misses: g.misses,
          accuracy: g.notes.length ? g.hits / g.notes.length : 0,
        });
      }
      if (!g.finished) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, reading]);

  const flash = (judgement: keyof typeof JUDGE_STYLE) => {
    flashRef.current = { ...JUDGE_STYLE[judgement], t: performance.now() };
  };

  const completeRun = async (summary: RunSummary, used: GameRules) => {
    setLastRun(summary);
    setPhase("done");
    disposeBridgeRef.current?.();
    disposeBridgeRef.current = null;
    try {
      addSession(summary, used);
      await refreshAdaptive();
    } catch {
      setError("Run finished, but it could not be saved");
    }
  };

  const buildRunPattern = (): { pattern: Pattern; runRules: GameRules } => {
    if (source === "adaptive") {
      const pattern = composePattern({
        name: "Arena run",
        seed: Math.floor(Math.random() * 1_000_000_000),
        bpm: rules.bpm,
        root: rules.root,
        scale: rules.scale,
        bars: 8,
        instrument: rules.instrument,
        progression: rules.progression,
        density: rules.density,
        swing: rules.swing,
        drums: true,
      });
      return { pattern, runRules: rules };
    }
    const comp = comps.find((c) => String(c.id) === source);
    if (!comp) throw new Error("Selected composition is no longer available");
    const end = Math.max(...comp.events.map((e) => e.beat + e.dur));
    const pattern: Pattern = {
      name: comp.title,
      bpm: comp.bpm,
      lengthBeats: Math.max(4, Math.ceil(end / 4) * 4),
      events: comp.events,
    };
    return {
      pattern,
      runRules: {
        ...rules,
        bpm: comp.bpm,
        instrument: comp.instrument === "guitar" ? "guitar" : "piano",
      },
    };
  };

  const start = async () => {
    setError(null);
    try {
      const { pattern, runRules } = buildRunPattern();
      const game = new ArenaGame(audio, runRules, pattern, mode);
      game.subscribe((e: ArenaEvent) => {
        if (e.type === "hit") flash(e.judgement);
        else if (e.type === "miss") flash("miss");
        else if (e.type === "finish") void completeRun(e.summary, runRules);
      });
      disposeBridgeRef.current?.();
      disposeBridgeRef.current = bridgeArenaToMusic(game, audio);
      gameRef.current = game;
      flashRef.current = null;
      setHud(EMPTY_HUD);
      setLastRun(null);
      setPhase("playing");
      await game.start();
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Could not start the arena");
    }
  };

  const quit = () => {
    gameRef.current?.finish();
  };

  const touchLane = (lane: number) => {
    const g = gameRef.current;
    if (!g || g.finished) return;
    g.playerLane = lane;
    g.hit(lane, "touch");
  };

  const enableMotion = async () => {
    const ok = await request();
    setMotionOn(ok);
  };

  const playing = phase === "playing";
  const lanes = rules.laneCount;
  const liveSensor = reading.current.live;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-teal">Game engine</p>
          <h1 className="mt-1 text-3xl font-semibold text-ivory">Rhythm Arena</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Hit the melody as it falls. The chart is composed by the music engine, judged on its clock, and the
            rules for each run are generated from your play history.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/studio" className="rounded-lg bg-panel2 px-4 py-2 text-ivory hover:bg-line">
            Studio
          </Link>
          <Link href="/" className="rounded-lg bg-panel2 px-4 py-2 text-ivory hover:bg-line">
            Home
          </Link>
        </nav>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl bg-panel p-4 border border-line">
          <div className="relative mx-auto w-full max-w-[420px]">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="block h-auto w-full rounded-2xl"
              aria-label="Rhythm arena playfield"
            />
            {phase !== "playing" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-ink/70 p-6 text-center">
                <p className="text-sm uppercase tracking-[0.2em] text-teal">
                  {phase === "done" ? "Run complete" : "Ready"}
                </p>
                {lastRun ? (
                  <>
                    <p className="mt-2 text-4xl font-semibold text-ivory">{lastRun.score.toLocaleString()}</p>
                    <p className="mt-2 text-sm text-ivory/80">
                      {lastRun.hits} hits · {lastRun.misses} misses · max combo {lastRun.maxCombo} · accuracy{" "}
                      {pct(lastRun.accuracy)}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 max-w-xs text-sm text-ivory/80">
                    {mode === "keyboard"
                      ? "Keys D F J K hit the lanes, arrows move the cursor, Space hits the middle lane."
                      : "Tilt your device to move the cursor lane. Shake to strike. On desktop, use the keyboard."}
                  </p>
                )}
                <button
                  type="button"
                  onClick={start}
                  className="mt-6 rounded-lg bg-sun px-6 py-3 text-sm font-semibold text-ebony hover:brightness-110"
                >
                  {phase === "done" ? "Play again" : "Start run"}
                </button>
              </div>
            )}
          </div>

          <div className="mx-auto mt-4 grid max-w-[420px] gap-2" style={{ gridTemplateColumns: `repeat(${lanes}, minmax(0,1fr))` }}>
            {Array.from({ length: lanes }, (_, i) => (
              <button
                key={i}
                type="button"
                onPointerDown={() => touchLane(i)}
                disabled={!playing}
                className="h-14 rounded-2xl bg-panel2 text-xs font-mono text-ivory/80 border border-line active:bg-sun/40 disabled:opacity-40"
              >
                {LANE_KEYS[lanes]?.[i] === " " ? "SPC" : LANE_KEYS[lanes]?.[i]?.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="mx-auto mt-4 flex max-w-[420px] items-center justify-between gap-3">
            <div className="flex gap-4 text-sm">
              <span className="text-muted">Score</span>
              <span className="font-mono text-ivory">{hud.score.toLocaleString()}</span>
              <span className="text-muted">Combo</span>
              <span className="font-mono text-ivory">{hud.combo}</span>
            </div>
            <button
              type="button"
              onClick={quit}
              disabled={!playing}
              className="rounded-lg bg-panel2 px-4 py-2 text-sm text-ivory hover:bg-line disabled:opacity-40"
            >
              End run
            </button>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="space-y-4 rounded-2xl bg-panel p-5 border border-line">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-ivory/80">Controls</h2>
            <div className="grid grid-cols-2 gap-2">
              {(["keyboard", "tilt"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={playing}
                  onClick={() => setMode(m)}
                  className={`rounded-xl px-3 py-2 text-sm capitalize border border-line disabled:opacity-40 ${
                    mode === m ? "bg-sun text-ebony" : "bg-panel2 text-ivory/80"
                  }`}
                >
                  {m === "tilt" ? "Motion" : "Keyboard"}
                </button>
              ))}
            </div>

            {mode === "tilt" && (
              <div className="space-y-2 rounded-xl bg-panel2 p-3 text-sm">
                {permission === "unsupported" ? (
                  <p className="text-muted">This device has no motion sensors. Use the keyboard instead.</p>
                ) : !motionOn ? (
                  <button
                    type="button"
                    onClick={enableMotion}
                    className="w-full rounded-lg bg-panel2 px-3 py-2 text-ivory hover:bg-line"
                  >
                    Enable motion sensors
                  </button>
                ) : (
                  <>
                    <Meter label="Tilt" value={(tiltView + 1) / 2} display={tiltView.toFixed(2)} />
                    <p className="text-xs text-muted">
                      {liveSensor ? "Sensor live. Shake to strike the cursor lane." : "Waiting for sensor data…"}
                    </p>
                  </>
                )}
              </div>
            )}

            <label className="block text-sm">
              <span className="text-muted">Chart</span>
              <select
                value={source}
                disabled={playing}
                onChange={(e) => setSource(e.target.value)}
                className="mt-1 w-full rounded-xl bg-panel2 px-3 py-2 text-ivory border border-line disabled:opacity-40"
              >
                <option value="adaptive">Adaptive (generated for you)</option>
                {comps.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.title} · {c.bpm} BPM
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted">
              Lanes: {rules.laneCount} · Tempo: {rules.bpm} BPM · Key: {midiName(rules.root)} {SCALE_LABELS[rules.scale]}
            </p>
          </section>

          <section className="space-y-4 rounded-2xl bg-panel p-5 border border-line">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-ivory/80">Live stats</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Hits" value={String(hud.hits)} />
              <Stat label="Misses" value={String(hud.misses)} />
              <Stat label="Max combo" value={String(hud.maxCombo)} />
            </div>
            <Meter label="Accuracy" value={hud.accuracy} display={pct(hud.accuracy)} />
          </section>

          <section className="space-y-4 rounded-2xl bg-panel p-5 border border-line">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-ivory/80">Player profile</h2>
              <span className="text-xs text-muted">{profile.sessions} runs</span>
            </div>
            <Meter label="Skill" value={profile.skill} display={pct(profile.skill)} />
            <Meter label="Accuracy" value={profile.accuracy} display={pct(profile.accuracy)} />
            <Meter label="Motion usage" value={profile.motionRatio} display={pct(profile.motionRatio)} />
            <p className="text-xs text-muted">
              Average timing offset {profile.meanOffsetMs.toFixed(0)} ms (negative = rushing)
            </p>
          </section>

          <section className="space-y-3 rounded-2xl bg-panel p-5 border border-line">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-ivory/80">
              Generated rule program
            </h2>
            <ul className="max-h-64 space-y-2 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-200">
              {rules.source.map((line, i) => (
                <li key={i} className="rounded-lg bg-black/30 px-2 py-1">
                  {line}
                </li>
              ))}
            </ul>
          </section>

          {runs.length > 0 && (
            <section className="space-y-3 rounded-2xl bg-panel p-5 border border-line">
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-ivory/80">Recent runs</h2>
              <ul className="space-y-1 text-sm">
                {runs.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex justify-between text-ivory/80">
                    <span className="capitalize">{r.mode}</span>
                    <span className="font-mono">{r.score.toLocaleString()}</span>
                    <span className="font-mono text-muted">{pct(r.accuracy)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-panel2 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg text-ivory">{value}</p>
    </div>
  );
}
