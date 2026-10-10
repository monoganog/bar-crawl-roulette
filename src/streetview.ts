import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { loadBars, nearestBar, PLAYABLE_CITIES, type Bar } from "./bars";
import type { City } from "./cities";
import type { DropSpec } from "./difficulty";

const EARTH_RADIUS_M = 6_371_000;

/** Accept drops up to this much longer than the target walk. */
const PATH_SLACK = 0.25;
/**
 * Every bar must also be at least this fraction of the walk away in a
 * straight line, so none is sitting in plain sight across a courtyard.
 */
const MIN_STRAIGHT_FRACTION = 0.4;
/** A bar is reachable from a panorama this close to it. */
const BAR_SNAP_M = 40;
/** Safety cap on panoramas explored per drop attempt. */
const MAX_NODES = 900;
/** Panorama lookups in flight at once while exploring. */
const CONCURRENCY = 16;
/** Give up on a single drop attempt after this long; it counts as a miss. */
const ATTEMPT_TIMEOUT_MS = 10_000;
/** Gap points tried per city before switching city. */
const MAX_SEED_ATTEMPTS = 6;
const MAX_CITIES = 6;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface FoundLocation {
  panoId: string;
  city: City;
  position: LatLng;
  /** The closest known bar by walking distance. Any bar counts, though. */
  nearestBar: Bar;
  /** Shortest walk along Street View links from the drop to the nearest bar. */
  pathM: number;
  /** Straight-line distance from the drop to that bar. */
  barDistanceM: number;
  /** Walk to the nearest bar from every panorama explored, by pano id. */
  route: Map<string, number>;
  /** Every panorama explored and its links: the street network for the mini map. */
  streets: Map<string, PanoNode>;
  /** Every known bar in the city, for evidence and the mini map. */
  bars: Bar[];
  attempts: number;
}

export class GoogleAuthError extends Error {}

type StreetViewLib = google.maps.StreetViewLibrary;
let lib: Promise<StreetViewLib> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

/** Load the Street View library once. Rejects if the key is refused. */
export function loadStreetView(key: string): Promise<StreetViewLib> {
  if (!lib) {
    // Google reports a bad or restricted key through this global, not
    // through the promise, so we turn it into an error ourselves.
    (window as unknown as { gm_authFailure: () => void }).gm_authFailure = () => {
      authFailed = true;
      authListeners.forEach((fn) => fn());
    };
    setOptions({ key, v: "weekly" });
    lib = importLibrary("streetView");
  }
  return lib;
}

/** Call `fn` if Google rejects the key (now or later). Returns an unsubscribe. */
export function onAuthFailure(fn: () => void): () => void {
  if (authFailed) fn();
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export function distanceM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Nearest official outdoor panorama to `point`, or null if there's none
 * within `radiusM`. StreetViewService lookups are not billed.
 */
async function nearestPanorama(
  service: google.maps.StreetViewService,
  point: LatLng,
  radiusM: number,
): Promise<{ panoId: string; position: LatLng; distanceM: number } | null> {
  try {
    const { data } = await service.getPanorama({
      location: point,
      radius: radiusM,
      preference: "nearest" as google.maps.StreetViewPreference,
      sources: ["google", "outdoor"] as google.maps.StreetViewSource[],
    });
    const panoId = data.location?.pano;
    const ll = data.location?.latLng;
    if (!panoId || !ll) return null;
    const position = { lat: ll.lat(), lng: ll.lng() };
    return { panoId, position, distanceM: distanceM(point, position) };
  } catch {
    // ZERO_RESULTS (nothing nearby) or UNKNOWN_ERROR: either way, a miss.
    return null;
  }
}

export interface PanoNode {
  id: string;
  pos: LatLng;
  links: string[];
}

/** One panorama and the panoramas its arrows lead to. Null if unusable. */
async function fetchNode(service: google.maps.StreetViewService, id: string): Promise<PanoNode | null> {
  try {
    const { data } = await service.getPanorama({ pano: id });
    const ll = data.location?.latLng;
    // Links can lead into user-uploaded photo spheres; stay on Google's own.
    if (!ll || !/google/i.test(data.copyright ?? "")) return null;
    return {
      id,
      pos: { lat: ll.lat(), lng: ll.lng() },
      links: (data.links ?? []).map((l) => l?.pano).filter((p): p is string => !!p),
    };
  } catch {
    return null;
  }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface Exploration {
  nodes: Map<string, PanoNode>;
  /** Shortest known walk from the start panorama, by pano id. */
  dist: Map<string, number>;
}

/**
 * Walk outward from a panorama along Street View links, level by level
 * (each level's lookups run in parallel), recording the shortest walk back
 * to the start for every panorama within `maxM`.
 */
async function explore(
  service: google.maps.StreetViewService,
  startId: string,
  maxM: number,
  signal?: AbortSignal,
): Promise<Exploration | null> {
  const start = await fetchNode(service, startId);
  if (!start) return null;
  const nodes = new Map([[start.id, start]]);
  const dead = new Set<string>();
  const dist = new Map([[start.id, 0]]);
  let frontier = [start];

  while (frontier.length && nodes.size < MAX_NODES) {
    signal?.throwIfAborted();
    const unseen = [...new Set(frontier.flatMap((n) => n.links))].filter((id) => !nodes.has(id) && !dead.has(id));
    const fetched = await mapLimited(unseen, CONCURRENCY, (id) => fetchNode(service, id));
    unseen.forEach((id, i) => {
      const n = fetched[i];
      if (n) nodes.set(id, n);
      else dead.add(id);
    });

    // Relax every edge out of the frontier. A panorama reached by a shorter
    // route than before goes back on the frontier so its neighbours improve.
    const next = new Map<string, PanoNode>();
    for (const u of frontier) {
      const du = dist.get(u.id)!;
      for (const vid of u.links) {
        const v = nodes.get(vid);
        if (!v) continue;
        const dv = du + distanceM(u.pos, v.pos);
        if (dv < (dist.get(vid) ?? Infinity)) {
          dist.set(vid, dv);
          if (dv <= maxM) next.set(vid, v);
        }
      }
    }
    frontier = [...next.values()];
  }
  return { nodes, dist };
}

/**
 * Walking distance from every explored panorama to its nearest bar
 * (multi-source Dijkstra over the explored street network; no lookups).
 * Each bar is reachable from any panorama within BAR_SNAP_M of it.
 */
function nearestBarWalks(
  nodes: Map<string, PanoNode>,
  bars: Bar[],
): { dist: Map<string, number>; via: Map<string, Bar> } {
  const dist = new Map<string, number>();
  const via = new Map<string, Bar>();
  for (const bar of bars) {
    for (const n of nodes.values()) {
      const d = distanceM(n.pos, bar);
      if (d <= BAR_SNAP_M && d < (dist.get(n.id) ?? Infinity)) {
        dist.set(n.id, d);
        via.set(n.id, bar);
      }
    }
  }
  const done = new Set<string>();
  // A few hundred nodes at most, so a simple scan for the minimum is fine.
  for (;;) {
    let u: string | null = null;
    for (const [id, d] of dist) if (!done.has(id) && (u === null || d < dist.get(u)!)) u = id;
    if (u === null) break;
    done.add(u);
    const nu = nodes.get(u)!;
    for (const vid of nu.links) {
      const v = nodes.get(vid);
      if (!v || done.has(vid)) continue;
      const dv = dist.get(u)! + distanceM(nu.pos, v.pos);
      if (dv < (dist.get(vid) ?? Infinity)) {
        dist.set(vid, dv);
        via.set(vid, via.get(u)!);
      }
    }
  }
  return { dist, via };
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)];
}

export interface Drop {
  panoId: string;
  position: LatLng;
  nearestBar: Bar;
  pathM: number;
  barDistanceM: number;
  route: Map<string, number>;
  streets: Map<string, PanoNode>;
  explored: number;
}

/** Points tried per batch, all explored at once. */
const SEEDS_PER_BATCH = 3;
/** How far a drop may be from the seed point we explored around. */
const SEED_RADIUS_M = 100;

/**
 * Random points in the city that sit in a gap between bars of roughly the
 * right size: the nearest bar is a bit under the target walk away in a
 * straight line (walks are longer than straight lines). Pure maths on the
 * bar list; no lookups.
 */
export function gapPoints(city: City, bars: Bar[], pathM: number, rand: () => number = Math.random, n = 24): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < 4000 && out.length < n; i++) {
    // Uniform over a 3.5 km disc around the centre (bars go out to 4 km).
    const r = 3500 * Math.sqrt(rand());
    const t = 2 * Math.PI * rand();
    const p = {
      lat: city.lat + ((r * Math.cos(t)) / 6_371_000) * (180 / Math.PI),
      lng: city.lng + ((r * Math.sin(t)) / (6_371_000 * Math.cos((city.lat * Math.PI) / 180))) * (180 / Math.PI),
    };
    const near = nearestBar(bars, p);
    if (near && near.distanceM >= pathM * 0.55 && near.distanceM <= pathM * 1.05) out.push(p);
  }
  return out;
}

/**
 * Plan a drop near `seed`: explore the street network around it, work out
 * the walk to the nearest of *all* the city's bars from every spot, and pick
 * a random spot (close to the seed, where the distances can be trusted)
 * whose walk is `pathM` to `pathM × (1 + PATH_SLACK)`.
 */
export async function planDrop(
  service: google.maps.StreetViewService,
  seed: LatLng,
  cityBars: Bar[],
  pathM: number,
  rand: () => number = Math.random,
  signal?: AbortSignal,
): Promise<Drop | null> {
  const start = await nearestPanorama(service, seed, SEED_RADIUS_M);
  if (!start) return null;
  const maxM = pathM * (1 + PATH_SLACK);
  // Any bar beyond what we explore is further than maxM on foot from a spot
  // within SEED_RADIUS_M of the start, so it can't be the nearest.
  const exploreM = maxM + SEED_RADIUS_M + BAR_SNAP_M;
  const ex = await explore(service, start.panoId, exploreM, signal);
  if (!ex) return null;

  const area = cityBars.filter((b) => distanceM(b, seed) <= exploreM + SEED_RADIUS_M + BAR_SNAP_M);
  const { dist, via } = nearestBarWalks(ex.nodes, area);

  const candidates = [...ex.nodes.values()].filter((n) => {
    if ((ex.dist.get(n.id) ?? Infinity) > SEED_RADIUS_M) return false;
    const d = dist.get(n.id);
    if (d === undefined || d < pathM || d > maxM) return false;
    // No bar (even one we couldn't reach on foot) right there in plain sight.
    return area.every((b) => distanceM(n.pos, b) >= pathM * MIN_STRAIGHT_FRACTION);
  });
  if (!candidates.length) return null;

  const c = pick(candidates, rand);
  const nearest = via.get(c.id)!;
  return {
    panoId: c.id,
    position: c.pos,
    nearestBar: nearest,
    pathM: dist.get(c.id)!,
    barDistanceM: distanceM(c.pos, nearest),
    route: dist,
    streets: ex.nodes,
    explored: ex.nodes.size,
  };
}

/**
 * Pick a random city of the allowed kind, then gaps between its bars, and
 * plan a drop `spec.pathM` of walking from the nearest bar. A few gaps are
 * explored at once; after MAX_SEED_ATTEMPTS, switch cities.
 */
export async function findRandomLocation(
  key: string,
  opts: {
    spec: DropSpec;
    signal?: AbortSignal;
    city?: City;
    /** Stay in this city, even if it takes a few goes (the beer tour). */
    onlyCity?: City;
    onProgress?: (msg: string) => void;
    rand?: () => number;
  },
): Promise<FoundLocation> {
  const rand = opts.rand ?? Math.random;
  if (!PLAYABLE_CITIES.length) throw new Error("No bar data. Run `npm run fetch-bars`.");
  // Fall back to any playable city if we have no bar data for this kind.
  const allowed = PLAYABLE_CITIES.filter((c) => opts.spec.scripts.includes(c.script));
  const cities = allowed.length ? allowed : PLAYABLE_CITIES;
  const { StreetViewService } = await loadStreetView(key);
  const service = new StreetViewService();
  const triedCities = new Set<string>();
  let attempts = 0;

  for (let c = 0; c < MAX_CITIES; c++) {
    const pool = cities.filter((p) => !triedCities.has(p.city));
    const city = opts.onlyCity ?? (c === 0 && opts.city ? opts.city : pick(pool.length ? pool : cities, rand));
    triedCities.add(city.city);
    const bars = await loadBars(city.city);
    const seeds = gapPoints(city, bars, opts.spec.pathM, rand, MAX_SEED_ATTEMPTS);

    for (let i = 0; i < seeds.length; i += SEEDS_PER_BATCH) {
      opts.signal?.throwIfAborted();
      if (authFailed) throw new GoogleAuthError("Google rejected the API key.");
      opts.onProgress?.(`Finding you a street… (attempt ${(attempts += 1)})`);
      const batch = seeds.slice(i, i + SEEDS_PER_BATCH);
      // A slow attempt (a huge tangle of panoramas) is abandoned rather than
      // leaving the player on the loading screen.
      const signals = [AbortSignal.timeout(ATTEMPT_TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])];
      const signal = AbortSignal.any(signals);
      const drops = await Promise.all(
        batch.map((p) =>
          planDrop(service, p, bars, opts.spec.pathM, rand, signal).catch((e) => {
            if (opts.signal?.aborted) throw e;
            return null; // timed out
          }),
        ),
      );
      opts.signal?.throwIfAborted();
      const drop = drops.find((d) => d !== null);
      if (drop) {
        const { explored: _, ...rest } = drop;
        return { ...rest, city, bars, attempts };
      }
    }
  }
  if (authFailed) throw new GoogleAuthError("Google rejected the API key.");
  throw new Error(
    `Couldn't find a good spot after ${attempts} attempts${opts.onlyCity ? ` in ${opts.onlyCity.city}` : ` across ${MAX_CITIES} cities`}. ` +
      `Try the re-roll button; if it keeps happening, Google's daily limit may have run out.`,
  );
}
