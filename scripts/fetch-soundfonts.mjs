#!/usr/bin/env node
/**
 * Vendors a curated set of WebAudioFont SoundFont presets into public/soundfonts
 * so the core instruments work offline. Any other GM program is streamed from
 * the WebAudioFont CDN on demand (see src/engine/audio/soundfont.ts).
 */
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://surikov.github.io/webaudiofontdata/sound/";
const OUT = "public/soundfonts";

const MELODIC = [
  [0, "0000_FluidR3_GM_sf2_file"], [1, "0010_FluidR3_GM_sf2_file"],
  [4, "0040_JCLive_sf2_file"], [5, "0050_FluidR3_GM_sf2_file"],
  [6, "0060_FluidR3_GM_sf2_file"], [11, "0110_FluidR3_GM_sf2_file"],
  [12, "0120_FluidR3_GM_sf2_file"], [16, "0160_FluidR3_GM_sf2_file"],
  [19, "0190_FluidR3_GM_sf2_file"], [24, "0240_FluidR3_GM_sf2_file"],
  [25, "0250_FluidR3_GM_sf2_file"], [26, "0260_FluidR3_GM_sf2_file"],
  [27, "0270_FluidR3_GM_sf2_file"], [29, "0290_FluidR3_GM_sf2_file"],
  [32, "0320_FluidR3_GM_sf2_file"], [33, "0330_FluidR3_GM_sf2_file"],
  [34, "0340_FluidR3_GM_sf2_file"], [38, "0380_FluidR3_GM_sf2_file"],
  [40, "0400_FluidR3_GM_sf2_file"], [42, "0420_FluidR3_GM_sf2_file"],
  [46, "0460_FluidR3_GM_sf2_file"], [48, "0480_FluidR3_GM_sf2_file"],
  [52, "0520_FluidR3_GM_sf2_file"], [56, "0560_FluidR3_GM_sf2_file"],
  [65, "0650_FluidR3_GM_sf2_file"], [73, "0730_FluidR3_GM_sf2_file"],
  [81, "0810_FluidR3_GM_sf2_file"], [89, "0890_FluidR3_GM_sf2_file"],
];

// Drum keys: try a few known banks until one exists.
const DRUM_KEYS = [35, 36, 37, 38, 39, 40, 42, 44, 45, 46, 47, 49, 51];
const DRUM_BANKS = ["0_FluidR3_GM", "6_JCLive", "22_JCLive", "0_Chaos"];

await mkdir(OUT, { recursive: true });
const manifest = { melodic: {}, drums: {}, bytes: 0 };

async function grab(file) {
  const res = await fetch(BASE + file + ".js");
  if (!res.ok) return null;
  const text = await res.text();
  if (text.length < 2000 || text.trimStart().startsWith("<!DOCTYPE")) return null;
  return text;
}

let done = 0;
const queue = [...MELODIC];
async function worker() {
  while (queue.length) {
    const [program, file] = queue.shift();
    const { access } = await import("node:fs/promises");
    const exists = await access(`${OUT}/${file}.js`).then(() => true).catch(() => false);
    if (exists) {
      const { stat } = await import("node:fs/promises");
      manifest.melodic[program] = file;
      manifest.bytes += (await stat(`${OUT}/${file}.js`)).size;
      done++;
      continue;
    }
    const text = await grab(file);
    if (!text) {
      console.log(`skip ${file}`);
      continue;
    }
    await writeFile(`${OUT}/${file}.js`, text);
    manifest.melodic[program] = file;
    manifest.bytes += text.length;
    done++;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`melodic presets: ${done}`);

for (const key of DRUM_KEYS) {
  for (const bank of DRUM_BANKS) {
    const file = `128${key}_${bank}_sf2_file`;
    const text = await grab(file);
    if (text) {
      await writeFile(`${OUT}/${file}.js`, text);
      manifest.drums[key] = file;
      manifest.bytes += text.length;
      break;
    }
  }
}
console.log(`drum samples: ${Object.keys(manifest.drums).length}`);
await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`total ${(manifest.bytes / 1048576).toFixed(1)} MB`);
