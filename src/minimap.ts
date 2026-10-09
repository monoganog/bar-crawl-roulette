import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { Bar } from "./bars";
import type { FoundLocation, LatLng } from "./streetview";

/** How much ground the in-turn map covers: metres per CSS pixel. */
const METRES_PER_PX = 1.5;
/** The route map shows at least this much ground, even for a short walk. */
const ROUTE_MIN_SPAN_M = 260;
const ROUTE_PADDING_PX = 72;
/** The route draws itself on: a pause for the page to land, then the line. */
const ROUTE_ANIM_DELAY_MS = 350;
const ROUTE_ANIM_MIN_MS = 1200;
const ROUTE_ANIM_MAX_MS = 2600;
/** How long a marker takes to pop in once the line reaches it. */
const POP_MS = 320;

/** Colours match the CSS tokens in style.css. */
const C = {
  street: "#7a6d99",
  path: "#4f4563",
  trail: "#ffb703",
  me: "#ff3d7f",
  cone: "rgba(255, 61, 127, 0.3)",
  start: "#b3a8c4",
  bar: "#2ee6a6",
  barFaint: "rgba(46, 230, 166, 0.45)",
  label: "#fbf7ff",
  labelHalo: "#0d0b14",
};

// Free OpenStreetMap vector tiles, no key needed: https://openfreemap.org
const TILES = "https://tiles.openfreemap.org/planet";

/**
 * Roads and paths only. No labels, water, buildings or landmarks, so the
 * map shows the shape of the streets without giving the city away.
 */
const STYLE: StyleSpecification = {
  version: 8,
  sources: { omt: { type: "vector", url: TILES } },
  layers: [
    {
      id: "paths",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: ["all", ["in", ["get", "class"], ["literal", ["path", "track"]]], ["!=", ["get", "brunnel"], "tunnel"]],
      paint: { "line-color": C.path, "line-width": 1.5 },
    },
    {
      id: "roads",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: [
        "all",
        ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "busway"]]],
        ["!=", ["get", "brunnel"], "tunnel"],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": C.street,
        "line-width": ["match", ["get", "class"], ["motorway", "trunk", "primary"], 4.5, ["secondary", "tertiary"], 3.5, 2.5],
      },
    },
  ],
};

/** During a turn: centred on the player, north up. */
interface FollowView {
  mode: "follow";
  me: LatLng;
  headingDeg: number;
  trail: LatLng[];
  showBars: boolean;
}

/** After a turn: fitted to the whole walk, with the bars they passed named. */
interface RouteView {
  mode: "route";
  trail: LatLng[];
  /** Where they pressed BAR FOUND, if they did. */
  claim: LatLng | null;
  /** Bars close to the route; these get labels. */
  passed: Bar[];
  /** Exploring after the turn: where they've wandered since, from where they stopped. */
  extra: LatLng[];
  /** Where the photo is now and which way it faces. */
  me: { pos: LatLng; headingDeg: number } | null;
}

type View = FollowView | RouteView;
type Project = (p: LatLng) => { x: number; y: number };

/**
 * A label-free street map. Streets come from OpenFreeMap tiles; if those
 * can't load, it falls back to drawing the Street View network explored when
 * the drop was planned. Trail, start, bars and the player are drawn on top.
 */
export class Minimap {
  private tiles: HTMLDivElement;
  private overlay: HTMLCanvasElement;
  private attribution: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private map: MapLibreMap | null = null;
  private mapState: "none" | "loading" | "ready" | "failed" = "none";
  private loc: FoundLocation | null = null;
  private last: View | null = null;
  /** The route animation's clock; set when the route view first appears. */
  private anim: { start: number; duration: number } | null = null;
  private raf = 0;

  constructor(private container: HTMLElement) {
    container.innerHTML = `
      <div class="minimap-tiles"></div>
      <canvas class="minimap-overlay"></canvas>
      <div class="minimap-attr hidden">
        © <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
        <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>
      </div>`;
    this.tiles = container.querySelector(".minimap-tiles")!;
    this.overlay = container.querySelector(".minimap-overlay")!;
    this.attribution = container.querySelector(".minimap-attr")!;
    this.ctx = this.overlay.getContext("2d")!;
  }

  /** A new drop (first turn or a re-roll). */
  setLocation(loc: FoundLocation) {
    this.loc = loc;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.map?.remove();
    this.map = null;
  }

  draw(view: View) {
    // Switching to the route view starts its animation; later redraws (a
    // resize, the tiles arriving, dragging the photo) carry on from there.
    if (view.mode === "route" && this.last?.mode !== "route") this.anim = null;
    this.last = view;
    if (!this.loc) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return; // hidden: nothing to draw yet
    this.sizeOverlay(w, h);
    const { centre, mPerPx } =
      view.mode === "follow" ? { centre: view.me, mPerPx: METRES_PER_PX } : this.routeFit(view, w, h);
    if (this.mapState === "none") this.startMap(centre);
    if (this.map && this.mapState === "ready") {
      this.map.resize();
      this.map.jumpTo({ center: [centre.lng, centre.lat], zoom: zoomFor(centre.lat, mPerPx) });
    }
    const P: Project = (p) => this.project(p, centre, mPerPx, w, h);
    this.ctx.clearRect(0, 0, w, h);
    if (this.mapState !== "ready") this.drawExploredStreets(P);
    if (view.mode === "follow") this.drawFollow(view, P, w, h);
    else this.drawRoute(view, P, w, h);
  }

  /** One animation frame: same camera, just redraw what's on top. */
  private redrawRoute() {
    const view = this.last as RouteView;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h || !this.loc) return;
    const { centre, mPerPx } = this.routeFit(view, w, h);
    const P: Project = (p) => this.project(p, centre, mPerPx, w, h);
    this.ctx.clearRect(0, 0, w, h);
    if (this.mapState !== "ready") this.drawExploredStreets(P);
    this.drawRoute(view, P, w, h);
  }

  /** Centre and scale that fit the whole walk, the start and the claim. */
  private routeFit(view: RouteView, w: number, h: number) {
    const pts = [
      this.loc!.position,
      ...view.trail,
      ...view.extra,
      ...(view.claim ? [view.claim] : []),
      ...(view.me ? [view.me.pos] : []),
    ];
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const centre = {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
    const k = Math.cos((centre.lat * Math.PI) / 180);
    const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 111_320 * k, ROUTE_MIN_SPAN_M);
    const spanY = Math.max((Math.max(...lats) - Math.min(...lats)) * 110_540, ROUTE_MIN_SPAN_M);
    const mPerPx = Math.max(spanX / (w - ROUTE_PADDING_PX * 2), spanY / (h - ROUTE_PADDING_PX * 2));
    return { centre, mPerPx };
  }

  /** Load MapLibre and the tiles on first use; fall back quietly on failure. */
  private async startMap(at: LatLng) {
    this.mapState = "loading";
    try {
      const [{ Map, setWorkerUrl }, { default: workerUrl }] = await Promise.all([
        import("maplibre-gl"),
        // Vite bundles MapLibre's tile-decoding worker and gives us its URL;
        // the default lookup can't find it once Vite has bundled the library.
        import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);
      setWorkerUrl(workerUrl);
      const map = new Map({
        container: this.tiles,
        style: STYLE,
        center: [at.lng, at.lat],
        zoom: zoomFor(at.lat, METRES_PER_PX),
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
      this.map = map;
      // Errors before the map has loaded mean the tiles aren't reachable.
      const giveUp = setTimeout(() => this.fail(), 10_000);
      map.on("error", () => {
        if (this.mapState === "loading") this.fail();
      });
      map.once("load", () => {
        clearTimeout(giveUp);
        if (this.mapState !== "loading") return;
        this.mapState = "ready";
        this.attribution.classList.remove("hidden");
        if (this.last) this.draw(this.last);
      });
    } catch {
      this.fail();
    }
  }

  private fail() {
    if (this.mapState === "failed") return;
    this.mapState = "failed";
    this.map?.remove();
    this.map = null;
    this.attribution.classList.add("hidden");
    if (this.last) this.draw(this.last);
  }

  private sizeOverlay(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    if (this.overlay.width !== w * dpr || this.overlay.height !== h * dpr) {
      this.overlay.width = w * dpr;
      this.overlay.height = h * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Screen position of a point, matching the tiles when they're showing. */
  private project(p: LatLng, centre: LatLng, mPerPx: number, w: number, h: number) {
    if (this.map && this.mapState === "ready") {
      const q = this.map.project([p.lng, p.lat]);
      return { x: q.x, y: q.y };
    }
    const k = Math.cos((centre.lat * Math.PI) / 180);
    return {
      x: w / 2 + ((p.lng - centre.lng) * 111_320 * k) / mPerPx,
      y: h / 2 - ((p.lat - centre.lat) * 110_540) / mPerPx,
    };
  }

  /** No tiles: draw the streets we explored instead. */
  private drawExploredStreets(P: Project) {
    const ctx = this.ctx;
    const loc = this.loc!;
    ctx.strokeStyle = C.street;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const n of loc.streets.values()) {
      const a = P(n.pos);
      for (const id of n.links) {
        if (id < n.id) continue;
        const m = loc.streets.get(id);
        if (!m) continue;
        const b = P(m.pos);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
  }

  private drawTrail(trail: LatLng[], P: Project, width = 3) {
    if (trail.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = C.trail;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    trail.forEach((p, i) => {
      const q = P(p);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.stroke();
  }

  private drawStart(P: Project) {
    const ctx = this.ctx;
    const s = P(this.loc!.position);
    ctx.strokeStyle = C.start;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.stroke();
    return s;
  }

  private drawBars(bars: Bar[], P: Project, w: number, h: number, colour: string, r: number) {
    const ctx = this.ctx;
    ctx.fillStyle = colour;
    for (const bar of bars) {
      const p = P(bar);
      if (p.x < -10 || p.y < -10 || p.x > w + 10 || p.y > h + 10) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawNorth(w: number) {
    const ctx = this.ctx;
    ctx.fillStyle = C.start;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("N", w - 14, 6);
  }

  private drawFollow(view: FollowView, P: Project, w: number, h: number) {
    const ctx = this.ctx;
    this.drawTrail(view.trail, P);
    this.drawStart(P);
    if (view.showBars) this.drawBars(this.loc!.bars, P, w, h, C.bar, 4);

    // Me, always in the middle, with a view cone.
    const cx = w / 2;
    const cy = h / 2;
    const a = ((view.headingDeg - 90) * Math.PI) / 180;
    const cone = Math.PI / 5;
    ctx.fillStyle = C.cone;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 28, a - cone, a + cone);
    ctx.closePath();
    ctx.fill();
    this.dot(cx, cy, C.me);
    this.drawNorth(w);
  }

  private drawRoute(view: RouteView, P: Project, w: number, h: number) {
    const ctx = this.ctx;
    const pts = view.trail.map(P);
    // Cumulative length along the drawn line, so things can appear in step.
    const along = [0];
    for (let i = 1; i < pts.length; i++) {
      along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const total = along[along.length - 1] || 0;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const now = performance.now();
    if (!this.anim) {
      this.anim = {
        start: now + ROUTE_ANIM_DELAY_MS,
        duration: reduced ? 0 : Math.min(ROUTE_ANIM_MAX_MS, Math.max(ROUTE_ANIM_MIN_MS, 800 + total * 3)),
      };
    }
    const elapsed = now - this.anim.start;
    const t = this.anim.duration ? Math.min(1, Math.max(0, elapsed / this.anim.duration)) : 1;
    const drawnTo = easeInOutCubic(t) * total;
    // When (in ms since the line started) the line reaches a point.
    const reachedAt = (p: LatLng) => {
      if (!total || !this.anim!.duration) return 0;
      const q = P(p);
      let best = 0;
      let bestD = Infinity;
      pts.forEach((pt, i) => {
        const d = Math.hypot(pt.x - q.x, pt.y - q.y);
        if (d < bestD) [bestD, best] = [d, i];
      });
      return inverseEase(along[best] / total) * this.anim!.duration;
    };
    // 0..1 pop-in for something the line reached at `at` ms.
    const pop = (at: number) => (reduced ? 1 : easeOutBack(Math.min(1, Math.max(0, (elapsed - at) / POP_MS))));

    const passed = new Set(view.passed);
    this.drawBars(this.loc!.bars.filter((b) => !passed.has(b)), P, w, h, C.barFaint, 3.5);

    // The walk so far, cut off exactly where the animation has got to.
    if (pts.length > 1 && drawnTo > 0) {
      ctx.strokeStyle = C.trail;
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        if (along[i] <= drawnTo) {
          ctx.lineTo(pts[i].x, pts[i].y);
          continue;
        }
        const f = (drawnTo - along[i - 1]) / (along[i] - along[i - 1] || 1);
        ctx.lineTo(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f);
        break;
      }
      ctx.stroke();
      // A bright head on the growing line.
      if (t < 1) {
        const head = pointAt(pts, along, drawnTo);
        this.dot(head.x, head.y, C.trail, 4);
      }
    }

    const start = this.drawStart(P);
    const claimAt = view.claim ? P(view.claim) : null;
    // Claimed without moving: the claim label says it all.
    if (!claimAt || Math.hypot(claimAt.x - start.x, claimAt.y - start.y) > 24) {
      this.label("start", start.x, start.y + 16, C.start);
    }

    // Each bar they passed pops in as the line goes by it.
    for (const [i, bar] of view.passed.entries()) {
      const s = pop(reachedAt(bar));
      if (s <= 0) continue;
      const p = P(bar);
      ctx.save();
      ctx.globalAlpha = Math.min(1, s);
      ctx.fillStyle = C.bar;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * s, 0, Math.PI * 2);
      ctx.fill();
      if (i < 8) this.label(bar.name, p.x, p.y - 14, C.label);
      ctx.restore();
    }

    // Where they've wandered since the turn ended: a dashed line.
    if (view.extra.length > 1) {
      const q = view.extra.map(P);
      ctx.save();
      ctx.strokeStyle = "rgba(251, 247, 255, 0.75)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    }

    // Which way the photo is facing, appearing with the end of the line.
    const me = view.me ? P(view.me.pos) : null;
    const meS = view.me ? pop(reachedAt(view.me.pos)) : 0;
    if (me && meS > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, meS);
      this.cone(me.x, me.y, view.me!.headingDeg, 34 * Math.min(1, meS));
      ctx.restore();
    }

    if (view.claim && claimAt) {
      const s = pop(reachedAt(view.claim));
      if (s > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, s);
        this.dot(claimAt.x, claimAt.y, C.me, 7 * s);
        this.label("you said bar", claimAt.x, claimAt.y + 18, C.me);
        ctx.restore();
      }
    }
    // Wandered off from the claim: mark where the photo is now.
    if (me && meS > 0 && (!claimAt || Math.hypot(me.x - claimAt.x, me.y - claimAt.y) > 8)) {
      this.dot(me.x, me.y, C.label, 5);
    }
    this.drawNorth(w);

    // Keep going until the line and the last pop-in have finished.
    const lastPop = Math.max(0, ...view.passed.map(reachedAt), view.claim ? reachedAt(view.claim) : 0) + POP_MS;
    if (!reduced && elapsed < Math.max(this.anim.duration, lastPop)) {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.last?.mode === "route" && this.redrawRoute());
    }
  }

  /** A soft wedge showing which way someone's looking. */
  private cone(x: number, y: number, headingDeg: number, r: number) {
    const ctx = this.ctx;
    const a = ((headingDeg - 90) * Math.PI) / 180;
    const half = Math.PI / 5;
    ctx.fillStyle = "rgba(255, 61, 127, 0.4)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, a - half, a + half);
    ctx.closePath();
    ctx.fill();
  }

  private dot(x: number, y: number, fill: string, r = 6) {
    const ctx = this.ctx;
    ctx.fillStyle = fill;
    ctx.strokeStyle = C.labelHalo;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /** Text with a dark halo, so it reads over streets and dots. */
  private label(text: string, x: number, y: number, colour: string) {
    const ctx = this.ctx;
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = C.labelHalo;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }
}

/**
 * MapLibre zoom that gives `mPerPx` metres per pixel at this latitude.
 * MapLibre's world is 512 px wide at zoom 0, so a pixel there covers ~78 km.
 */
function zoomFor(lat: number, mPerPx: number): number {
  return Math.log2((78_271.517 * Math.cos((lat * Math.PI) / 180)) / mPerPx);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The time (0..1) at which easeInOutCubic reaches `y`, by bisection. */
function inverseEase(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (easeInOutCubic(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Overshoots a touch, then settles: a little pop. */
function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

/** The point `dist` pixels along a polyline. */
function pointAt(pts: { x: number; y: number }[], along: number[], dist: number) {
  for (let i = 1; i < pts.length; i++) {
    if (along[i] >= dist) {
      const f = (dist - along[i - 1]) / (along[i] - along[i - 1] || 1);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    }
  }
  return pts[pts.length - 1];
}
