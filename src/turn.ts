import { bearingDeg, compassPoint, DEBUG_AVAILABLE, debugOn, setDebugOn } from "./debug";
import {
  distanceM,
  findRandomLocation,
  GoogleAuthError,
  loadStreetView,
  onAuthFailure,
  type FoundLocation,
  type LatLng,
} from "./streetview";
import { describeScripts, type DropSpec } from "./difficulty";
import { nearestBar, type Bar } from "./bars";
import { Minimap } from "./minimap";
import { formatTime, type TurnResult } from "./state";
import { esc } from "./util";

type Btn = "bar" | "drink";

/** A bar this close to the route counts as one they walked past. */
const PASSED_M = 35;
/** A bar this close to where they pressed BAR FOUND is the one they picked. */
const CLAIMED_M = 40;

const BAR_HINT = "click when you spot one";
const DRINK_HINT = "click when your glass is empty";

// Google reports a rejected key and a used-up daily quota the same way, so
// the message has to cover both.
const KEY_ERROR =
  "Google Street View isn't available right now. Either today's free usage has run out (try again tomorrow), or the API key isn't set up for this site.";

export interface TurnOptions {
  root: HTMLElement;
  apiKey: string;
  player: string;
  round: number;
  capSec: number;
  /** Walk distance and allowed cities for this round, used again on re-roll. */
  drop: DropSpec;
  /** A search that may already be under way (started during the spin or on "Up next"). */
  location: Promise<FoundLocation>;
  /** The turn is over. Record the result now so a refresh can't lose it. */
  onFinish: (r: TurnResult) => void;
  /** The player has seen the reveal and wants to go back to the wheel. */
  onContinue: () => void;
}

export class Turn {
  /** Kept across re-rolls: each new StreetViewPanorama is a billed load. */
  private pano: google.maps.StreetViewPanorama | null = null;
  private loc: FoundLocation | null = null;
  private abort = new AbortController();
  private t0: number | null = null;
  private raf = 0;
  private pressed: Record<Btn, number | null> = { bar: null, drink: null };
  private done = false;
  /** Bumped on every re-roll so a stale search can't mount a viewer. */
  private gen = 0;
  private el: Record<string, HTMLElement> = {};
  private offAuth: () => void;
  /** Movement tracking, for the debug panel and for tuning drop distances. */
  private lastPos: LatLng | null = null;
  private walkedM = 0;
  private steps = 0;
  private trail: LatLng[] = [];
  private rerolls = 0;
  /** Exactly what they were looking at when they pressed BAR FOUND. */
  private claim: {
    panoId: string;
    pov: google.maps.StreetViewPov;
    zoom: number;
    position: LatLng;
    atMs: number;
  } | null = null;
  /** "results" once the turn is over and the results page is showing. */
  private stage: "playing" | "results" = "playing";
  /** Bars near the route, worked out once for the results page. */
  private passed: Bar[] = [];
  /** Redraws the results page's map and photo when the window changes size. */
  private onResize = () => {
    if (this.pano) google.maps.event.trigger(this.pano, "resize");
    this.refresh();
  };
  private result: TurnResult | null = null;
  /** The panorama they were on when the turn ended, for the Maps link. */
  private endPanoId: string | null = null;
  private minimap: Minimap;

  constructor(private o: TurnOptions) {
    o.root.innerHTML = `
      <div class="turn">
        <div class="viewer-wrap">
          <div class="viewer" data-el="viewer"></div>
          <div class="loading" data-el="loading">
            <div class="spinner"></div>
            <div class="loading-msg" data-el="loadingMsg">Spinning the globe…</div>
          </div>
          <div class="debug hidden" data-el="debug"></div>
          <div class="minimap hidden" data-el="minimap" role="img" aria-label="Map of nearby streets"></div>
          <div class="reveal hidden" data-el="reveal"></div>
        </div>
        <aside class="panel">
          <div class="who">
            <div class="who-label">Round ${o.round} · now drinking</div>
            <div class="who-name">${esc(o.player)}</div>
          </div>
          <div class="timer" data-el="timer">0:00.0</div>
          <div class="cap"><div class="cap-fill" data-el="capFill"></div></div>
          <div class="cap-label" data-el="capLabel">cap ${formatTime(o.capSec * 1000, false)}</div>
          <button class="big-btn bar" data-btn="bar" disabled>
            <span class="big-btn-main"><span class="tick">✓</span> BAR FOUND</span>
            <span class="big-btn-sub" data-el="barSub">${BAR_HINT}</span>
          </button>
          <button class="big-btn drink" data-btn="drink" disabled>
            <span class="big-btn-main"><span class="tick">✓</span> DRINK FINISHED</span>
            <span class="big-btn-sub" data-el="drinkSub">${DRINK_HINT}</span>
          </button>
          <div class="small-actions">
            <button class="ghost" data-act="reroll" title="Imagery broken or stuck? Get a new spot and restart the clock.">↻ Bad spot, re-roll</button>
            <button class="ghost" data-act="giveup">Give up (DNF)</button>
          </div>
        </aside>
      </div>`;
    o.root.querySelectorAll<HTMLElement>("[data-el]").forEach((e) => (this.el[e.dataset.el!] = e));
    o.root.querySelectorAll<HTMLButtonElement>("[data-btn]").forEach((b) =>
      b.addEventListener("click", () => this.press(b.dataset.btn as Btn)),
    );
    o.root.querySelector('[data-act="reroll"]')!.addEventListener("click", () => {
      if (this.done) return;
      this.rerolls++;
      this.reroll();
    });
    o.root.querySelector('[data-act="giveup"]')!.addEventListener("click", () => {
      if (this.t0 !== null && !this.done) this.finish(null);
    });

    this.offAuth = onAuthFailure(() => {
      if (!this.done) this.showLoading(KEY_ERROR, true);
    });
    this.minimap = new Minimap(this.el.minimap);
    this.el.debug.classList.toggle("hidden", !debugOn());
    this.load(o.location);
  }

  handleKey(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (k === "`" && DEBUG_AVAILABLE) {
      const on = this.el.debug.classList.toggle("hidden") === false;
      setDebugOn(on);
      this.refresh();
      return true;
    }
    if (this.done) {
      if (k !== "enter" && k !== " ") return false;
      // Holding the key shouldn't skip the exhibit and the reveal in one go.
      if (e.repeat) return true;
      this.o.onContinue();
      return true;
    }
    return false;
  }

  destroy() {
    this.abort.abort();
    cancelAnimationFrame(this.raf);
    this.offAuth();
    window.removeEventListener("resize", this.onResize);
    if (this.pano) google.maps.event.clearInstanceListeners(this.pano);
    this.pano = null;
    this.minimap.destroy();
  }

  private async load(search: Promise<FoundLocation>) {
    const signal = this.abort.signal;
    const gen = ++this.gen;
    this.showLoading("Spinning the globe…");
    try {
      const loc = await search;
      if (signal.aborted || gen !== this.gen) return;
      this.loc = loc;
      this.lastPos = null;
      this.walkedM = 0;
      this.steps = 0;
      this.trail = [];
      this.minimap.setLocation(loc);
      this.renderDebug();
      this.showLoading("Pouring the pixels…");
      await this.showPanorama(loc);
    } catch (err) {
      if (signal.aborted || gen !== this.gen) return;
      const msg =
        err instanceof GoogleAuthError ? KEY_ERROR : (err as Error).message;
      this.showLoading(msg, true);
    }
  }

  private async showPanorama(loc: FoundLocation) {
    const { StreetViewPanorama } = await loadStreetView(this.o.apiKey);
    if (this.abort.signal.aborted) return;
    if (this.pano) {
      this.pano.setPano(loc.panoId);
      return;
    }
    this.pano = new StreetViewPanorama(this.el.viewer, {
      pano: loc.panoId,
      pov: { heading: Math.random() * 360, pitch: 0 },
      // Hide everything that gives the location away. Google's logo and
      // terms links stay, as their terms require.
      addressControl: false,
      showRoadLabels: false,
      panControl: false,
      fullscreenControl: false,
      enableCloseButton: false,
      motionTracking: false,
      motionTrackingControl: false,
      // Navigation stays on.
      linksControl: true,
      clickToGo: true,
      zoomControl: true,
    });
    this.pano.addListener("position_changed", () => this.onMove());
    this.pano.addListener("pov_changed", () => this.refresh());
    // A new panorama's arrows arrive after its position does.
    this.pano.addListener("links_changed", () => this.renderDebug());
    // Fires once the panorama for a pano id has loaded, and again on every
    // step the player takes. Only the first one for each spot matters.
    this.pano.addListener("status_changed", () => {
      if (this.t0 !== null || this.done || !this.loc) return;
      if (this.pano!.getStatus() === "OK") {
        this.el.loading.classList.add("hidden");
        this.el.minimap.classList.remove("hidden");
        this.startClock();
        this.refresh();
      } else {
        console.warn("Street View could not open", this.loc.panoId, this.pano!.getStatus());
        this.reroll();
      }
    });
  }

  private onMove() {
    const p = this.pano?.getPosition();
    if (!p || !this.loc || this.done) return;
    // After a re-roll, ignore stray events from the old spot until the new
    // panorama is showing, so the jump between cities isn't counted.
    if (!this.lastPos && this.pano!.getPano() !== this.loc.panoId) return;
    const pos = { lat: p.lat(), lng: p.lng() };
    if (this.lastPos) {
      const d = distanceM(this.lastPos, pos);
      if (d > 0.5) {
        this.walkedM += d;
        this.steps++;
      }
    }
    this.lastPos = pos;
    this.trail.push(pos);
    this.refresh();
  }

  private refresh() {
    this.renderDebug();
    if (!this.loc) return;
    if (this.stage === "results") {
      this.minimap.draw({ mode: "route", trail: this.routeTrail(), claim: this.claim?.position ?? null, passed: this.passed });
      return;
    }
    this.minimap.draw({
      mode: "follow",
      me: this.lastPos ?? this.loc.position,
      headingDeg: this.pano?.getPov().heading ?? 0,
      trail: this.trail,
      // Bars are only on the map for debugging.
      showBars: !this.el.debug.classList.contains("hidden"),
    });
  }

  private renderDebug() {
    const el = this.el.debug;
    if (el.classList.contains("hidden")) return;
    if (!this.loc) {
      el.innerHTML = `<div class="debug-title">DEBUG <span class="debug-hint">press \` to hide</span></div><div>finding a spot…</div>`;
      return;
    }
    const { barDistanceM, pathM, route, city, bars } = this.loc;
    const panoId = this.pano?.getPano() ?? this.loc.panoId;
    const here = this.lastPos ?? this.loc.position;
    // Nearest known bar from here, as the crow flies.
    const near = nearestBar(bars, here) ?? { bar: this.loc.nearestBar, distanceM: distanceM(here, this.loc.nearestBar) };
    const straight = near.distanceM;
    const bearing = bearingDeg(here, near.bar);
    const heading = this.pano?.getPov().heading ?? 0;
    const relTo = (deg: number) => ((deg - heading + 540) % 360) - 180;
    const turnText = (rel: number) =>
      Math.abs(rel) < 15 ? "straight ahead" : `${Math.abs(rel).toFixed(0)}° ${rel > 0 ? "right" : "left"}`;

    // Walking distance from here, if this panorama was explored, and which
    // arrow is the next step on the shortest route.
    const walk = route.get(panoId);
    let next: { heading: number; dist: number } | null = null;
    for (const l of this.pano?.getLinks() ?? []) {
      const d = l?.pano ? route.get(l.pano) : undefined;
      if (d !== undefined && l?.heading != null && (!next || d < next.dist)) next = { heading: l.heading, dist: d };
    }
    const arrowRel = next && walk !== undefined && next.dist < walk ? relTo(next.heading) : relTo(bearing);
    const progress = walk !== undefined ? pathM - walk : null;

    el.innerHTML = `
      <div class="debug-title">DEBUG <span class="debug-hint">press \` to hide</span></div>
      <div class="debug-row"><span>round</span>R${this.o.round}: ${this.o.drop.pathM} m, ${describeScripts(this.o.drop.scripts)}</div>
      <div class="debug-row"><span>city</span>${esc(city.city)} (${city.script}, ${bars.length} bars)</div>
      <div class="debug-row"><span>nearest</span>${esc(near.bar.name)}</div>
      <div class="debug-big ${straight <= 40 ? "close" : ""}">
        <span class="debug-arrow" style="transform: rotate(${arrowRel}deg)">↑</span>
        ${walk !== undefined ? `${walk.toFixed(0)} m <small>walk</small>` : `${straight.toFixed(0)} m <small>straight</small>`}
      </div>
      <div class="debug-row"><span>next step</span>${
        walk === undefined
          ? "off the explored map"
          : next && next.dist < walk
            ? turnText(relTo(next.heading))
            : walk < 30
              ? "you're there"
              : "no arrow leads closer"
      }</div>
      <div class="debug-row"><span>straight</span>${straight.toFixed(0)} m, ${compassPoint(bearing)} ${bearing.toFixed(0)}° (${turnText(relTo(bearing))})</div>
      <div class="debug-row"><span>start</span>${pathM.toFixed(0)} m walk / ${barDistanceM.toFixed(0)} m straight to ${esc(this.loc.nearestBar.name)}</div>
      <div class="debug-row"><span>progress</span>${
        progress === null ? "?" : Math.abs(progress) < 1 ? "not moved yet" : `${Math.abs(progress).toFixed(0)} m ${progress > 0 ? "closer" : "further"}`
      }</div>
      <div class="debug-row"><span>walked</span>${this.walkedM.toFixed(0)} m in ${this.steps} steps</div>
      <div class="debug-row"><span>explored</span>${route.size} panoramas</div>
      <div class="debug-row"><span>pano</span><code>${esc(panoId)}</code></div>`;
  }

  private startClock() {
    this.t0 = performance.now();
    this.o.root.querySelectorAll<HTMLButtonElement>("[data-btn]").forEach((b) => (b.disabled = false));
    const capMs = this.o.capSec * 1000;
    const frame = () => {
      if (this.done || this.t0 === null) return;
      const elapsed = performance.now() - this.t0;
      if (elapsed >= capMs) {
        this.finish(null);
        return;
      }
      this.renderClock(elapsed, capMs);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private renderClock(elapsed: number, capMs: number) {
    this.el.timer.textContent = formatTime(elapsed);
    const left = capMs - elapsed;
    this.el.capFill.style.width = `${Math.min(100, (elapsed / capMs) * 100)}%`;
    this.el.capLabel.textContent = `${formatTime(left, false)} left`;
    this.el.timer.classList.toggle("danger", left <= 30_000);
  }

  private press(which: Btn) {
    if (this.done || this.t0 === null) return;
    const btn = this.o.root.querySelector<HTMLButtonElement>(`[data-btn="${which}"]`)!;
    // Pressed again while the other isn't: take it back ("that's not a bar").
    // Once both are pressed the turn is over, so there's nothing to undo.
    if (this.pressed[which] !== null) {
      this.pressed[which] = null;
      btn.classList.remove("latched");
      this.el[`${which}Sub`].textContent = which === "bar" ? BAR_HINT : DRINK_HINT;
      if (which === "bar") this.claim = null;
      return;
    }
    const at = performance.now() - this.t0;
    this.pressed[which] = at;
    btn.classList.add("latched");
    this.el[`${which}Sub`].textContent = `at ${formatTime(at)} · click to undo`;
    if (which === "bar" && this.pano && this.loc) {
      this.claim = {
        panoId: this.pano.getPano(),
        pov: { ...this.pano.getPov() },
        zoom: this.pano.getZoom(),
        position: this.lastPos ?? this.loc.position,
        atMs: at,
      };
    }
    if (this.pressed.bar !== null && this.pressed.drink !== null) {
      this.finish(Math.max(this.pressed.bar, this.pressed.drink));
    }
  }

  private reroll() {
    if (this.done) return;
    cancelAnimationFrame(this.raf);
    this.t0 = null;
    this.loc = null;
    this.claim = null;
    this.el.minimap.classList.add("hidden");
    this.pressed = { bar: null, drink: null };
    this.el.timer.textContent = "0:00.0";
    this.el.timer.classList.remove("danger");
    this.el.capFill.style.width = "0%";
    this.el.capLabel.textContent = `cap ${formatTime(this.o.capSec * 1000, false)}`;
    this.el.barSub.textContent = BAR_HINT;
    this.el.drinkSub.textContent = DRINK_HINT;
    this.o.root.querySelectorAll<HTMLButtonElement>("[data-btn]").forEach((b) => {
      b.disabled = true;
      b.classList.remove("latched");
    });
    this.load(
      findRandomLocation(this.o.apiKey, {
        spec: this.o.drop,
        signal: this.abort.signal,
        onProgress: (m) => this.showLoading(m),
      }),
    );
  }

  private finish(timeMs: number | null) {
    if (this.done || !this.loc) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    const { city, panoId, nearestBar: startBar, barDistanceM, pathM, route, bars } = this.loc;
    const endPos = this.lastPos ?? this.loc.position;
    this.endPanoId = this.pano?.getPano() ?? this.loc.panoId;
    const result: TurnResult = {
      round: this.o.round,
      player: this.o.player,
      timeMs,
      barMs: this.pressed.bar,
      drinkMs: this.pressed.drink,
      city: city.city,
      country: city.country,
      panoId,
      bar: startBar.name,
      barDistanceM: Math.round(barDistanceM),
      pathM: Math.round(pathM),
      endPathM: this.pano?.getPano() && route.has(this.pano.getPano()) ? Math.round(route.get(this.pano.getPano())!) : undefined,
      endBarDistanceM: Math.round(nearestBar(bars, endPos)?.distanceM ?? distanceM(endPos, startBar)),
      walkedM: Math.round(this.walkedM),
      steps: this.steps,
      rerolls: this.rerolls,
      claimNearestBarM: this.claim ? Math.round(nearestBar(bars, this.claim.position)?.distanceM ?? 0) : undefined,
    };
    this.o.onFinish(result);
    this.result = result;

    this.el.timer.textContent = timeMs === null ? "DNF" : formatTime(timeMs);
    this.el.timer.classList.remove("danger");
    this.el.timer.classList.add(timeMs === null ? "dnf" : "final");
    this.o.root.querySelectorAll<HTMLButtonElement>("[data-btn], [data-act]").forEach((b) => (b.disabled = true));
    // The turn's over: the buttons are locked, so drop the "click to undo".
    (["bar", "drink"] as const).forEach((w) => {
      const at = this.pressed[w];
      this.el[`${w}Sub`].textContent = at === null ? "–" : `at ${formatTime(at)}`;
    });
    this.o.root.querySelector(".turn")!.classList.add("done");

    this.showResults();
  }

  /** The walk as drawn on the map: from the start, through every step. */
  private routeTrail(): LatLng[] {
    const start = this.loc!.position;
    return this.trail.length && this.trail[0] !== start ? [start, ...this.trail] : this.trail;
  }

  /**
   * One page after the turn: a polaroid of the BAR FOUND view (the live
   * panorama, framed, so no new billed load), the route with every bar they
   * walked past, and the numbers.
   */
  private showResults() {
    const r = this.result!;
    const loc = this.loc!;
    const claim = this.claim;
    this.stage = "results";

    // Bars within a short walk of the route. Ones right by the claim don't
    // count as "walked past": that's the one they picked.
    const route = this.routeTrail();
    const near = (b: Bar, pts: LatLng[], m: number) => pts.some((p) => distanceM(p, b) <= m);
    this.passed = loc.bars.filter((b) => near(b, route.length ? route : [loc.position], PASSED_M));
    const ignored = claim ? this.passed.filter((b) => distanceM(b, claim.position) <= CLAIMED_M) : [];
    const walkedPast = this.passed.filter((b) => !ignored.includes(b));
    const nearby = loc.bars.filter((b) => distanceM(b, loc.position) <= 300).length;

    // Evidence for the room, not a verdict: OSM doesn't know every bar.
    let evidence = "";
    if (claim) {
      const n = nearestBar(loc.bars, claim.position);
      const d = n ? Math.round(n.distanceM) : Infinity;
      const name = n ? `<strong>${esc(n.bar.name)}</strong>` : "";
      evidence =
        d <= 30
          ? `🍺 ${name} is right there on our map (${d} m)`
          : d <= 60
            ? `🍺 Nearest bar on our map: ${name}, ${d} m away`
            : n
              ? `🧐 Nothing on our map within 60 m (nearest: ${name}, ${d} m). Local knowledge, or a lie?`
              : `🧐 No bars on our map round here. Local knowledge, or a lie?`;
    }

    const player = esc(this.o.player);
    const caption = claim
      ? `“That's a bar!” – ${player}, ${formatTime(claim.atMs)}`
      : r.timeMs === null
        ? `Where ${player} ran out of time`
        : `Where ${player} finished`;
    const tile = (tone: string, label: string, value: string, sub: string) => `
      <div class="stat-tile ${tone}">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        <div class="stat-sub">${sub}</div>
      </div>`;

    const reveal = this.el.reveal;
    reveal.classList.add("results");
    reveal.innerHTML = `
      <div class="results-page">
        <header class="results-head">
          <div class="results-time ${r.timeMs === null ? "dnf" : ""}">${r.timeMs === null ? "⏰ DNF" : `🍻 ${formatTime(r.timeMs)}`}</div>
          <div class="results-where">${player}, you were in <strong>${esc(r.city)}</strong>, ${esc(r.country)}</div>
        </header>
        <div class="results-grid">
          <figure class="polaroid">
            <div class="polaroid-photo" data-slot="photo"></div>
            <figcaption class="polaroid-caption">${caption}</figcaption>
          </figure>
          <div class="route-card">
            <div class="route-map" data-slot="map"></div>
            <div class="route-legend">
              <span><i class="key trail"></i>your walk</span>
              <span><i class="key bar"></i>bars you passed</span>
              <span><i class="key faint"></i>other bars</span>
              ${claim ? `<span><i class="key claim"></i>your “bar”</span>` : ""}
            </div>
          </div>
        </div>
        ${evidence ? `<p class="results-evidence">${evidence}</p>` : ""}
        <div class="stat-tiles">
          ${tile(
            "amber",
            "🚶 Walked",
            `${Math.round(this.walkedM)} m`,
            this.steps ? `in ${this.steps} step${this.steps === 1 ? "" : "s"}` : "didn't move an inch",
          )}
          ${tile(
            "mint",
            "🍺 Bars walked past",
            String(walkedPast.length),
            walkedPast.length ? esc(listNames(walkedPast.map((b) => b.name))) : "Not a pub in sight",
          )}
          ${tile(
            "pink",
            "⏱ Bar found",
            r.barMs === null ? "–" : formatTime(r.barMs),
            r.drinkMs === null ? "drink not finished" : `drink empty at ${formatTime(r.drinkMs)}`,
          )}
          ${tile(
            "gold",
            "📍 Nearest bar to start",
            `${Math.round(loc.pathM)} m`,
            `${esc(r.bar ?? "")} · ${nearby} within 300 m`,
          )}
        </div>
        <div class="results-actions">
          <button class="primary huge" data-act="continue">Continue <kbd>Enter</kbd></button>
          <a class="reveal-link" href="https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(this.endPanoId ?? loc.panoId)}" target="_blank" rel="noopener">open where you finished in Google Maps ↗</a>
        </div>
        <div class="osm-credit">Bar data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>
      </div>`;
    reveal.querySelector('[data-act="continue"]')!.addEventListener("click", () => this.o.onContinue());
    reveal.classList.remove("hidden");
    this.o.root.querySelector(".turn")!.classList.add("results-mode");

    // Move the live panorama into the polaroid, and the map into its box.
    reveal.querySelector('[data-slot="photo"]')!.appendChild(this.el.viewer);
    reveal.querySelector('[data-slot="map"]')!.appendChild(this.el.minimap);
    this.el.minimap.classList.remove("hidden");

    const pano = this.pano;
    if (pano) {
      // A still "photo": look around, but no walking and no controls.
      pano.setOptions({ linksControl: false, clickToGo: false, zoomControl: false });
      if (claim) {
        if (pano.getPano() !== claim.panoId) {
          // A new pano resets the view when it loads, so set it again after.
          google.maps.event.addListenerOnce(pano, "pano_changed", () => {
            pano.setPov(claim.pov);
            pano.setZoom(claim.zoom);
          });
          pano.setPano(claim.panoId);
        }
        pano.setPov(claim.pov);
        pano.setZoom(claim.zoom);
      }
    }
    // Let the new layout settle, then resize both to their new boxes.
    requestAnimationFrame(this.onResize);
    window.addEventListener("resize", this.onResize);
  }

  private showLoading(msg: string, error = false) {
    this.el.loading.classList.remove("hidden");
    this.el.loading.classList.toggle("error", error);
    this.el.loadingMsg.textContent = msg;
  }
}

function listNames(names: string[]): string {
  const shown = names.slice(0, 5);
  const more = names.length - shown.length;
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0] ?? "";
  return more > 0 ? `${shown.join(", ")} and ${more} more` : head;
}
