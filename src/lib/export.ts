import type { Instrument } from "@/engine/types";
import { STEPS_PER_BEAT, isDrumTrack, type Song } from "./song";

const PPQ = 480;

const GM_PROGRAM: Partial<Record<Instrument, number>> = {
  piano: 0,
  epiano: 4,
  guitar: 25,
  bass: 33,
  synth: 81,
  strings: 48,
};

function varLen(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function str(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0) & 0x7f);
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: number[]): number[] {
  return [...str(type), ...u32(data.length), ...data];
}

/** Standard MIDI File (format 1) with one track per song track. */
export function songToMidi(song: Song): Uint8Array {
  const tempo = Math.round(60_000_000 / song.bpm);
  const tracks: number[][] = [];
  const meta = [
    0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    ...[0, 0xff, 0x03, ...varLen(song.title.length), ...str(song.title)],
    0, 0xff, 0x2f, 0,
  ];
  tracks.push(meta);

  let melodicChannel = 0;
  song.tracks.forEach((t) => {
    const drum = isDrumTrack(t);
    const ch = drum ? 9 : melodicChannel++ % 9;
    const ticksPerStep = PPQ / STEPS_PER_BEAT;
    const evs: { tick: number; bytes: number[] }[] = [];
    for (const n of t.notes) {
      const on = n.step * ticksPerStep;
      const off = on + Math.max(1, n.len) * ticksPerStep - 1;
      const vel = Math.max(1, Math.min(127, Math.round(n.vel * t.volume * 127)));
      evs.push({ tick: on, bytes: [0x90 | ch, n.midi & 127, vel] });
      evs.push({ tick: off, bytes: [0x80 | ch, n.midi & 127, 0] });
    }
    evs.sort((a, b) => a.tick - b.tick || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
    const data: number[] = [0, 0xff, 0x03, ...varLen(t.name.length), ...str(t.name)];
    if (!drum) data.push(0, 0xc0 | ch, GM_PROGRAM[t.inst] ?? 0);
    let last = 0;
    for (const e of evs) {
      data.push(...varLen(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    data.push(0, 0xff, 0x2f, 0);
    tracks.push(data);
  });

  const header = chunk("MThd", [0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255]);
  const body = tracks.flatMap((d) => chunk("MTrk", d));
  return new Uint8Array([...header, ...body]);
}

/** 16-bit PCM WAV encoder. */
export function audioBufferToWav(buf: AudioBuffer): Uint8Array {
  const chs = Math.min(2, buf.numberOfChannels);
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * chs * 2));
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  out.setUint32(4, 36 + len * chs * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, chs, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * chs * 2, true);
  out.setUint16(32, chs * 2, true);
  out.setUint16(34, 16, true);
  writeStr(36, "data");
  out.setUint32(40, len * chs * 2, true);
  const data = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}

export function download(bytes: Uint8Array | string, filename: string, mime: string): void {
  const part: BlobPart = typeof bytes === "string" ? bytes : (bytes.slice().buffer as ArrayBuffer);
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "song";
}
