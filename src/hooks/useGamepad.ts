"use client";

import { useEffect, useRef, useState } from "react";

/** Standard Gamepad mapping indices (Xbox naming, PlayStation in comments). */
export const PAD = {
  A: 0, // Cross
  B: 1, // Circle
  X: 2, // Square
  Y: 3, // Triangle
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export const PAD_LABELS: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "Back",
  9: "Start",
  10: "LS",
  11: "RS",
  12: "↑",
  13: "↓",
  14: "←",
  15: "→",
};

export interface GamepadHandlers {
  onButton?: (index: number, pressed: boolean, value: number) => void;
  /** Called every frame with the stick axes [lx, ly, rx, ry]. */
  onAxes?: (axes: readonly number[]) => void;
}

/**
 * Polls connected gamepads every animation frame and turns button state
 * changes into press / release callbacks. Analog triggers count as pressed
 * past 0.35 and report their value (useful as velocity).
 */
export function useGamepad(handlers: GamepadHandlers, enabled = true): { connected: string | null } {
  const ref = useRef(handlers);
  const [connected, setConnected] = useState<string | null>(null);

  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("getGamepads" in navigator)) return;
    let raf = 0;
    const prev = new Map<number, boolean[]>();
    let lastId: string | null = null;

    const loop = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let id: string | null = null;
      for (const gp of pads) {
        if (!gp || !gp.connected) continue;
        id = id ?? gp.id;
        const before = prev.get(gp.index) ?? [];
        const now = gp.buttons.map((b) => b.pressed || b.value > 0.35);
        now.forEach((p, i) => {
          if (p !== !!before[i]) ref.current.onButton?.(i, p, gp.buttons[i].value || (p ? 1 : 0));
        });
        prev.set(gp.index, now);
        ref.current.onAxes?.(gp.axes);
      }
      if (id !== lastId) {
        lastId = id;
        setConnected(id);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  return { connected };
}
