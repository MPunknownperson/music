"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "@/engine/util";

export type MotionPermission = "unknown" | "granted" | "denied" | "unsupported";

export interface MotionReading {
  /** Left/right tilt (gamma), normalised to -1..1. */
  tilt: number;
  /** Front/back tilt (beta), normalised to -1..1. */
  pitch: number;
  /** Linear acceleration magnitude in m/s² (gravity removed when available). */
  accel: number;
  /** Number of shake gestures detected. */
  shakes: number;
  /** performance.now() of the last shake, or 0. */
  lastShakeAt: number;
  /** True once at least one sensor event has arrived. */
  live: boolean;
}

const SHAKE_THRESHOLD = 16;
const SHAKE_COOLDOWN_MS = 380;
const TILT_RANGE_DEG = 35;
const TILT_DEADZONE_DEG = 2.5;

type PermissionAPI = { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * Reads DeviceOrientation / DeviceMotion. Readings live in a ref so animation
 * loops can poll them without re-rendering. Permission is requested through
 * `request()` (required on iOS, must be called from a user gesture).
 */
export function useMotion(enabled: boolean, onShake?: (strength: number) => void) {
  const readingRef = useRef<MotionReading>({
    tilt: 0,
    pitch: 0,
    accel: 0,
    shakes: 0,
    lastShakeAt: 0,
    live: false,
  });
  const shakeHandlerRef = useRef<typeof onShake>(onShake);
  const [permission, setPermission] = useState<MotionPermission>("unknown");

  useEffect(() => {
    shakeHandlerRef.current = onShake;
  }, [onShake]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasOrientation = "DeviceOrientationEvent" in window;
    const hasMotion = "DeviceMotionEvent" in window;
    if (!hasOrientation && !hasMotion) setPermission("unsupported");
  }, []);

  const request = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const DOE = (window as unknown as { DeviceOrientationEvent?: PermissionAPI }).DeviceOrientationEvent;
    const DME = (window as unknown as { DeviceMotionEvent?: PermissionAPI }).DeviceMotionEvent;
    try {
      for (const api of [DME, DOE]) {
        if (api && typeof api.requestPermission === "function") {
          const result = await api.requestPermission();
          if (result !== "granted") {
            setPermission("denied");
            return false;
          }
        }
      }
      setPermission("granted");
      return true;
    } catch {
      setPermission("denied");
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const r = readingRef.current;

    const onOrientation = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma ?? 0;
      const beta = e.beta ?? 0;
      const g = Math.abs(gamma) < TILT_DEADZONE_DEG ? 0 : gamma;
      r.tilt = clamp(g / TILT_RANGE_DEG, -1, 1);
      r.pitch = clamp(beta / 45, -1, 1);
      r.live = true;
    };

    const onMotion = (e: DeviceMotionEvent) => {
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      if (!acc) return;
      const mag = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
      r.accel = mag;
      r.live = true;
      const now = performance.now();
      if (mag > SHAKE_THRESHOLD && now - r.lastShakeAt > SHAKE_COOLDOWN_MS) {
        r.lastShakeAt = now;
        r.shakes += 1;
        shakeHandlerRef.current?.(clamp(mag / 30, 0, 1));
      }
    };

    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [enabled]);

  return { reading: readingRef, permission, request };
}
