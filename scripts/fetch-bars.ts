// Build src/data/bars/: every named bar, pub and beer garden within 4 km of
// each city in src/cities.ts, one file per city, plus index.json with counts.
//   npm run fetch-bars                    # cities not fetched yet
//   npm run fetch-bars -- --force         # re-fetch everything
//   npm run fetch-bars -- York Leeds      # just these (always re-fetched)
//
// Bar data © OpenStreetMap contributors, ODbL. The game credits this.
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { CITIES, citySlug } from "../src/cities";

const RADIUS_M = 4000;
const DIR = new URL("../src/data/bars/", import.meta.url);
const INDEX = new URL("index.json", DIR);

// Public Overpass servers are often overloaded; keep trying, politely.
const SERVERS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const PASSES = 8;

async function overpassCsv(query: string): Promise<string> {
  const errors: string[] = [];
  for (let pass = 0; pass < PASSES; pass++) {
    if (pass) await new Promise((r) => setTimeout(r, Math.min(60_000, 10_000 * pass)));
    for (const url of SERVERS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "User-Agent": "bar-crawl-roulette/0.2 (fetch-bars script)",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(180_000),
        });
        const text = await res.text();
        // Overpass sometimes answers 200 with an error page instead of data.
        if (!res.ok || text.trimStart().startsWith("<")) {
          errors.push(`${new URL(url).host}: HTTP ${res.status}`);
          continue;
        }
        return text;
      } catch (e) {
        errors.push(`${new URL(url).host}: ${(e as Error).message}`);
      }
    }
  }
  throw new Error([...new Set(errors)].join("; "));
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const names = args.filter((a) => !a.startsWith("--"));
const targets = names.length
  ? CITIES.filter((c) => names.some((n) => c.city.toLowerCase().startsWith(n.toLowerCase())))
  : CITIES.filter((c) => force || !existsSync(new URL(`${citySlug(c.city)}.json`, DIR)));

mkdirSync(DIR, { recursive: true });

// Files for cities that are no longer in the list.
const wanted = new Set(CITIES.map((c) => `${citySlug(c.city)}.json`));
for (const f of readdirSync(DIR)) {
  if (f !== "index.json" && f.endsWith(".json") && !wanted.has(f)) unlinkSync(new URL(f, DIR));
}

function writeIndex() {
  const index: Record<string, number> = {};
  for (const c of CITIES) {
    const file = new URL(`${citySlug(c.city)}.json`, DIR);
    if (existsSync(file)) index[c.city] = JSON.parse(readFileSync(file, "utf8")).length;
  }
  writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n");
}

for (const city of targets) {
  const query =
    `[out:csv(::lat,::lon,name;false)][timeout:150];` +
    `nwr["amenity"~"^(bar|pub|biergarten)$"]["name"](around:${RADIUS_M},${city.lat},${city.lng});` +
    `out center;`;
  const t0 = Date.now();
  try {
    const csv = await overpassCsv(query);
    const rows = csv
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((p) => p.length >= 3 && p[2].trim())
      .map(([lat, lng, ...name]) => [name.join(" ").trim(), +(+lat).toFixed(5), +(+lng).toFixed(5)] as [string, number, number])
      .filter(([, lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    // The same pub mapped twice (a point and a building) has the same name close by.
    const unique = [...new Map(rows.map((b) => [`${b[0]}|${b[1].toFixed(3)}|${b[2].toFixed(3)}`, b])).values()];
    writeFileSync(new URL(`${citySlug(city.city)}.json`, DIR), JSON.stringify(unique));
    writeIndex();
    console.log(`${city.city.padEnd(15)} ${String(unique.length).padStart(5)} bars  (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (e) {
    console.log(`${city.city.padEnd(15)} FAILED (${(e as Error).message})`);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
writeIndex();
console.log(`\nindex: ${Object.keys(JSON.parse(readFileSync(INDEX, "utf8"))).length} of ${CITIES.length} cities have data`);
