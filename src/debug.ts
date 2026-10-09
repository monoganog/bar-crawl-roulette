import type { LatLng } from "./streetview";

/**
 * Only in `npm run dev`. The panel shows where the nearest bar is, so it's
 * left out of the published build entirely.
 */
export const DEBUG_AVAILABLE = import.meta.env.DEV;

const KEY = "bar-crawl-roulette:debug";

export function debugOn(): boolean {
  if (!DEBUG_AVAILABLE) return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDebugOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}

/** Initial compass bearing from `a` to `b`, in degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compassPoint(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}
