"use client";

import { useEffect, useRef } from "react";

/**
 * Two-row "tracker" layout used by most DAWs:
 *  lower octave  Z S X D C V G B H N J M , L . ; /
 *  upper octave  Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P [ = ]
 * Uses `KeyboardEvent.code`, so it works on QWERTY, AZERTY, QWERTZ, etc.
 */
export const KEY_OFFSETS: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
  Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30,
  BracketRight: 31,
};

const CODE_LABEL: Record<string, string> = {
  Comma: ",", Period: ".", Semicolon: ";", Slash: "/", BracketLeft: "[", BracketRight: "]", Equal: "=",
};

function labelOf(code: string): string {
  if (CODE_LABEL[code]) return CODE_LABEL[code];
  return code.replace("Key", "").replace("Digit", "");
}

/** Label of the computer key that plays `midi` for a given base note (prefers the upper row). */
export function keyLabelFor(midi: number, base: number): string | null {
  const off = midi - base;
  const upper = Object.entries(KEY_OFFSETS).find(([c, o]) => o === off && /Key[QWERTYUIOP]|Digit|Bracket|Equal/.test(c));
  const any = upper ?? Object.entries(KEY_OFFSETS).find(([, o]) => o === off);
  return any ? labelOf(any[0]) : null;
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export interface NoteKeyboardOptions {
  base: number;
  enabled?: boolean;
  onNoteOn: (midi: number, code: string) => void;
  onNoteOff: (midi: number, code: string) => void;
  /** Non-note keys (arrows, space, …). Return true if handled. */
  onOtherKey?: (e: KeyboardEvent, down: boolean) => boolean | void;
}

export function useNoteKeyboard(opts: NoteKeyboardOptions): void {
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });

  useEffect(() => {
    const held = new Map<string, number>();
    const down = (e: KeyboardEvent) => {
      const o = ref.current;
      if (o.enabled === false || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (o.onOtherKey?.(e, true)) {
        e.preventDefault();
        return;
      }
      const off = KEY_OFFSETS[e.code];
      if (off === undefined) return;
      e.preventDefault();
      if (e.repeat || held.has(e.code)) return;
      const midi = o.base + off;
      held.set(e.code, midi);
      o.onNoteOn(midi, e.code);
    };
    const up = (e: KeyboardEvent) => {
      const o = ref.current;
      if (o.onOtherKey?.(e, false)) return;
      const midi = held.get(e.code);
      if (midi === undefined) return;
      held.delete(e.code);
      o.onNoteOff(midi, e.code);
    };
    const blur = () => {
      held.forEach((m, c) => ref.current.onNoteOff(m, c));
      held.clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
}
