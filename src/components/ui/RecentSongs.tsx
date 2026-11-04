"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NOTE_NAMES, pitchClass } from "@/engine/music/theory";
import type { Song } from "@/lib/song";
import { listSessions, listSongs } from "@/lib/store";

export default function RecentSongs() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [best, setBest] = useState(0);

  useEffect(() => {
    setSongs(listSongs().slice(0, 4));
    setBest(listSessions(200).reduce((m, s) => Math.max(m, s.score), 0));
  }, []);

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between">
        <p className="label">Your recent songs</p>
        {best > 0 && <span className="text-xs text-muted">Arena best: <b className="text-maple">{best.toLocaleString()}</b></span>}
      </div>
      {songs.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Nothing yet. <Link href="/studio" className="font-semibold text-sun">Start a song</Link>. Everything is saved privately in this browser.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {songs.map((s) => (
            <li key={s.id}>
              <Link href={`/studio?song=${s.id}`} className="flex items-center justify-between rounded-xl bg-panel2 px-3 py-2 hover:bg-line">
                <span className="truncate text-sm font-semibold">{s.title}</span>
                <span className="text-xs text-muted">
                  {NOTE_NAMES[pitchClass(s.root)]} · {s.bpm} BPM
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
