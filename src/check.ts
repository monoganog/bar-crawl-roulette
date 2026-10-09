// Dev-only coverage check, served at /check.html by `npm run dev`.
import { barCount, loadBars, MIN_BARS_PER_CITY } from "./bars";
import { CITIES, type City } from "./cities";
import { dropSpec } from "./difficulty";
import { gapPoints, loadStreetView, onAuthFailure, planDrop } from "./streetview";

const KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "").trim();
const SEEDS_TO_TRY = 3;
const ROUNDS = [1, 2, 3];
const out = document.querySelector<HTMLPreElement>("#out")!;
const log = (html: string) => (out.innerHTML += html + "\n");
let running = false;

onAuthFailure(() => log(`<span class="bad">Google rejected the API key.</span>`));

async function run(targets: City[]) {
  if (running) return;
  if (!KEY) return log(`<span class="bad">VITE_GOOGLE_MAPS_KEY is not set.</span>`);
  running = true;
  const { StreetViewService } = await loadStreetView(KEY);
  const service = new StreetViewService();
  for (const city of targets) {
    const name = city.city.padEnd(15);
    if (barCount(city.city) < MIN_BARS_PER_CITY) {
      log(`<span class="bad">${name} ${barCount(city.city)} bars: not playable</span>`);
      continue;
    }
    const bars = await loadBars(city.city);
    for (const round of ROUNDS) {
      const pathM = dropSpec(round).pathM;
      const seeds = gapPoints(city, bars, pathM, Math.random, SEEDS_TO_TRY);
      const t0 = performance.now();
      const drops = await Promise.all(seeds.map((b) => planDrop(service, b, bars, pathM)));
      const ms = performance.now() - t0;
      const hits = drops.filter((d) => d !== null);
      const cls = hits.length === seeds.length ? "ok" : hits.length ? "meh" : "bad";
      const detail = hits
        .map((h) => `${h.pathM.toFixed(0)}/${h.barDistanceM.toFixed(0)}m (${h.explored})`)
        .join(", ");
      log(
        `<span class="${cls}">${name} R${round} ${pathM}m  ${hits.length}/${seeds.length}</span>` +
          `  ${(ms / 1000).toFixed(1)}s  walk/straight to nearest bar (panos): ${detail || "-"}`,
      );
    }
  }
  log("done\n");
  running = false;
}

const SAMPLE = ["London", "York", "Manchester", "Dublin", "Tokyo"];
document.querySelector("#sample")!.addEventListener("click", () => run(CITIES.filter((c) => SAMPLE.includes(c.city))));
document.querySelector("#all")!.addEventListener("click", () => run(CITIES));
