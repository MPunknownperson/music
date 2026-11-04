import {
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { GameRules, NoteEvent } from "@/engine/types";

/** One completed arena run, with the rule program that produced it. */
export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull().default("keyboard"),
  score: integer("score").notNull().default(0),
  maxCombo: integer("max_combo").notNull().default(0),
  hits: integer("hits").notNull().default(0),
  misses: integer("misses").notNull().default(0),
  accuracy: real("accuracy").notNull().default(0),
  meanOffsetMs: real("mean_offset_ms").notNull().default(0),
  motionRatio: real("motion_ratio").notNull().default(0),
  bpm: integer("bpm").notNull().default(100),
  laneCount: integer("lane_count").notNull().default(4),
  rules: jsonb("rules").$type<GameRules>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A composed or generated musical sequence that can be replayed or charted. */
export const compositions = pgTable("compositions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  bpm: integer("bpm").notNull().default(100),
  instrument: text("instrument").notNull().default("piano"),
  seed: integer("seed").notNull().default(0),
  events: jsonb("events").$type<NoteEvent[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
