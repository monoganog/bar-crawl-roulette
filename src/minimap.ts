import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { FoundLocation, LatLng } from "./streetview";

/** About how much ground the map covers: metres per CSS pixel. */
const METRES_PER_PX = 1.5;

/** Colours match the CSS tokens in style.css. */
const C = {
  street: "#7a6d99",
  path: "#4f4563",
  trail: "#ffb703",
  me: "#ff3d7f",
  cone: "rgba(255, 61, 127, 0.3)",
  start: "#b3a8c4",
  bar: "#2ee6a6",
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

interface DrawOpts {
  me: LatLng;
  headingDeg: number;
  trail: LatLng[];
  showBars: boolean;
}

/**
 * A label-free street map, centred on the player, north up. Streets come
 * from OpenFreeMap tiles; if those can't load, it falls back to drawing the
 * Street View network explored when the drop was planned. The player's
 * trail, start and (when allowed) bars are drawn on top.
 */
export class Minimap {
  private tiles: HTMLDivElement;
  private overlay: HTMLCanvasElement;
  private attribution: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private map: MapLibreMap | null = null;
  private mapState: "none" | "loading" | "ready" | "failed" = "none";
  private loc: FoundLocation | null = null;
  private last: DrawOpts | null = null;

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
    this.map?.remove();
    this.map = null;
  }

  draw(opts: DrawOpts) {
    this.last = opts;
    if (!this.loc) return;
    const size = this.container.clientWidth;
    if (!size) return; // hidden: nothing to draw yet
    this.sizeOverlay(size);
    if (this.mapState === "none") this.startMap(opts.me);
    if (this.map && this.mapState === "ready") {
      this.map.resize();
      this.map.jumpTo({ center: [opts.me.lng, opts.me.lat], zoom: zoomFor(opts.me.lat) });
    }
    this.drawOverlay(opts, size);
  }

  /** Load MapLibre and the tiles on first use; fall back quietly on failure. */
  private async startMap(me: LatLng) {
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
        center: [me.lng, me.lat],
        zoom: zoomFor(me.lat),
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

  private sizeOverlay(size: number) {
    const dpr = window.devicePixelRatio || 1;
    if (this.overlay.width !== size * dpr) {
      this.overlay.width = size * dpr;
      this.overlay.height = size * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Screen position of a point, matching the tiles when they're showing. */
  private project(p: LatLng, me: LatLng, size: number) {
    if (this.map && this.mapState === "ready") {
      const q = this.map.project([p.lng, p.lat]);
      return { x: q.x, y: q.y };
    }
    const k = Math.cos((me.lat * Math.PI) / 180);
    return {
      x: size / 2 + ((p.lng - me.lng) * 111_320 * k) / METRES_PER_PX,
      y: size / 2 - ((p.lat - me.lat) * 110_540) / METRES_PER_PX,
    };
  }

  private drawOverlay(opts: DrawOpts, size: number) {
    const ctx = this.ctx;
    const loc = this.loc!;
    const P = (p: LatLng) => this.project(p, opts.me, size);
    ctx.clearRect(0, 0, size, size);

    // No tiles: draw the streets we explored instead.
    if (this.mapState !== "ready") {
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

    // Where they've been.
    if (opts.trail.length > 1) {
      ctx.strokeStyle = C.trail;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      opts.trail.forEach((p, i) => {
        const q = P(p);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      });
      ctx.stroke();
    }

    // Start ring.
    const start = P(loc.position);
    ctx.strokeStyle = C.start;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
    ctx.stroke();

    if (opts.showBars) {
      ctx.fillStyle = C.bar;
      for (const bar of loc.bars) {
        const p = P(bar);
        if (p.x < -10 || p.y < -10 || p.x > size + 10 || p.y > size + 10) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Me, always in the middle, with a view cone.
    const c = size / 2;
    const a = ((opts.headingDeg - 90) * Math.PI) / 180;
    const cone = Math.PI / 5;
    ctx.fillStyle = C.cone;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, 28, a - cone, a + cone);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.me;
    ctx.strokeStyle = "#0d0b14";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // North marker.
    ctx.fillStyle = C.start;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("N", size - 14, 6);
  }
}

/**
 * MapLibre zoom that gives METRES_PER_PX at this latitude. MapLibre's world
 * is 512 px wide at zoom 0, so a pixel there covers ~78 km at the equator.
 */
function zoomFor(lat: number): number {
  return Math.log2((78_271.517 * Math.cos((lat * Math.PI) / 180)) / METRES_PER_PX);
}
