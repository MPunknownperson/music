"use client";

import type { GameRules, RunSummary } from "@/engine/types";
import type { Song } from "./song";

/**
 * Browser-local persistence. The platform runs without any database so it can
 * be deployed to Cloudflare Workers / Pages as a pure edge app; songs, takes
 * and arena history live in localStorage on the player's device.
 */

const SONGS_KEY = "mpstudio.songs.v1";
const SESSIONS_KEY = "mpstudio.sessions.v1";
const PREFS_KEY = "mpstudio.prefs.v1";

export interface StoredSession extends RunSummary {
  id: number;
  createdAt: string;
  rules: GameRules | null;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or private mode */
  }
}

export function listSongs(): Song[] {
  return read<Song[]>(SONGS_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSong(id: string): Song | undefined {
  return listSongs().find((s) => s.id === id);
}

export function saveSong(song: Song): Song {
  const next = { ...song, updatedAt: Date.now() };
  const all = read<Song[]>(SONGS_KEY, []).filter((s) => s.id !== song.id);
  all.push(next);
  write(SONGS_KEY, all.slice(-100));
  return next;
}

export function deleteSong(id: string): void {
  write(
    SONGS_KEY,
    read<Song[]>(SONGS_KEY, []).filter((s) => s.id !== id),
  );
}

export function listSessions(limit = 20): StoredSession[] {
  return read<StoredSession[]>(SESSIONS_KEY, [])
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export function addSession(summary: RunSummary, rules: GameRules | null): StoredSession {
  const all = read<StoredSession[]>(SESSIONS_KEY, []);
  const s: StoredSession = { ...summary, rules, id: Date.now(), createdAt: new Date().toISOString() };
  all.push(s);
  write(SESSIONS_KEY, all.slice(-200));
  return s;
}

export interface Prefs {
  volume: number;
  [key: string]: unknown;
}

export function getPrefs(): Prefs {
  return read<Prefs>(PREFS_KEY, { volume: 0.8 });
}

export function setPrefs(p: Partial<Prefs>): void {
  write(PREFS_KEY, { ...getPrefs(), ...p });
}
