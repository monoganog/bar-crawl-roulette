import index from "./data/bars/index.json";
import { CITIES, citySlug, type City } from "./cities";
import type { LatLng } from "./streetview";

/** One city's bars as stored: [name, lat, lng][]. Built by `npm run fetch-bars`. */
export type BarsFile = [string, number, number][];

export interface Bar extends LatLng {
  name: string;
}

/** Cities with fewer known bars than this are left out: the data's too thin. */
export const MIN_BARS_PER_CITY = 60;

const COUNTS = index as Record<string, number>;

/** Cities we have enough bar data for. */
export const PLAYABLE_CITIES: City[] = CITIES.filter((c) => (COUNTS[c.city] ?? 0) >= MIN_BARS_PER_CITY);

export function barCount(city: string): number {
  return COUNTS[city] ?? 0;
}

// Each city's file is its own chunk, downloaded only when that city comes up.
const files = import.meta.glob<BarsFile>(["./data/bars/*.json", "!./data/bars/index.json"], {
  import: "default",
});
const cache = new Map<string, Promise<Bar[]>>();

/** The closest bar to `p` in a straight line, or null if there are none. */
export function nearestBar(bars: Bar[], p: LatLng): { bar: Bar; distanceM: number } | null {
  let best: { bar: Bar; distanceM: number } | null = null;
  // An equirectangular approximation is plenty at city scale, and cheap.
  const k = Math.cos((p.lat * Math.PI) / 180);
  for (const bar of bars) {
    const dx = (bar.lng - p.lng) * k;
    const dy = bar.lat - p.lat;
    const d = Math.sqrt(dx * dx + dy * dy) * 111_195;
    if (!best || d < best.distanceM) best = { bar, distanceM: d };
  }
  return best;
}

/** Every known bar in a city. */
export function loadBars(city: string): Promise<Bar[]> {
  let bars = cache.get(city);
  if (!bars) {
    const load = files[`./data/bars/${citySlug(city)}.json`];
    bars = load
      ? load().then((rows) => rows.map(([name, lat, lng]) => ({ name, lat, lng })))
      : Promise.resolve([]);
    cache.set(city, bars);
  }
  return bars;
}
