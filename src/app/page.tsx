import Link from "next/link";
import { count, max } from "drizzle-orm";
import { db } from "@/db";
import { compositions, gameSessions } from "@/db/schema";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Music engine",
    body: "Synthesized piano (additive partials with hammer noise) and plucked guitar with strum, drums, a reverb bus and a sample-accurate multi-track transport.",
  },
  {
    title: "Game engine",
    body: "A rhythm arena charted from the composed melody, judged on the music clock. Each combo milestone adds a generated arpeggio layer to the music.",
  },
  {
    title: "Adaptive rules",
    body: "Run history becomes a behaviour profile. The profile generates a rule program for the next run: lanes, tempo, timing windows, key and progression. Every fired rule is logged.",
  },
  {
    title: "Motion",
    body: "On phones, tilt steers the lane and shake strikes or strums. On desktop, keyboard and touch do the same job.",
  },
];

export default async function HomePage() {
  const [runStats] = await db
    .select({ runs: count(), best: max(gameSessions.score) })
    .from(gameSessions);
  const [compStats] = await db.select({ n: count() }).from(compositions);

  const stats = [
    { label: "Arena runs", value: Number(runStats?.runs ?? 0) },
    { label: "Best score", value: Number(runStats?.best ?? 0) },
    { label: "Saved compositions", value: Number(compStats?.n ?? 0) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-fuchsia-300">Music · Game · Motion</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-white sm:text-5xl">
            A game that writes its own music, and music that plays the game.
          </h1>
          <p className="mt-5 max-w-xl text-base text-slate-300">
            The music engine composes and performs. The game engine charts, judges and adapts. Both share one beat
            clock, so a hit is a note and a good phrase changes the game.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/studio"
              className="rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:brightness-110"
            >
              Open the studio
            </Link>
            <Link
              href="/arena"
              className="rounded-full bg-white/10 px-6 py-3 text-sm font-semibold text-slate-100 ring-1 ring-white/15 hover:bg-white/20"
            >
              Play the arena
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-3xl bg-slate-900/70 p-5 text-center ring-1 ring-white/10">
              <p className="font-mono text-2xl font-semibold text-white">{s.value.toLocaleString()}</p>
              <p className="mt-2 text-xs text-slate-400">{s.label}</p>
            </div>
          ))}
          <div className="col-span-3 rounded-3xl bg-slate-900/70 p-5 ring-1 ring-white/10">
            <p className="text-xs uppercase tracking-wider text-slate-400">How the engines connect</p>
            <ol className="mt-3 space-y-2 text-sm text-slate-300">
              <li>1. The composer writes a melody, chords, bass and drums from a seed.</li>
              <li>2. The arena charts the melody by its contour and judges hits against the transport clock.</li>
              <li>3. Each hit sounds the note. Combos open the filter and add arpeggio layers.</li>
              <li>4. The run is saved and the adaptive program rewrites the rules for the next run.</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <article key={f.title} className="rounded-3xl bg-slate-900/70 p-6 ring-1 ring-white/10">
            <h2 className="text-lg font-semibold text-white">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{f.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
