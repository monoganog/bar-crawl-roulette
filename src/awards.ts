import { formatTime, type GameState, type TurnResult } from "./state";

export interface Award {
  emoji: string;
  title: string;
  /** What it's for, in a few words. */
  blurb: string;
  winners: string[];
  /** The number behind it, e.g. "walked 3.4× the shortest route". */
  stat: string;
  /** Always handed out (and revealed last), not left to the shuffle. */
  always?: boolean;
}

const m = (metres: number) => `${Math.round(metres)} m`;
const secs = (ms: number) => formatTime(ms);

/**
 * Pick the player(s) with the best value. `values` maps each player to a
 * number (or null if they don't qualify); ties share the award.
 */
function best(values: Map<string, number | null>, dir: "max" | "min"): { winners: string[]; value: number } | null {
  let top: number | null = null;
  for (const v of values.values()) {
    if (v === null || !Number.isFinite(v)) continue;
    if (top === null || (dir === "max" ? v > top : v < top)) top = v;
  }
  if (top === null) return null;
  const winners = [...values].filter(([, v]) => v === top).map(([p]) => p);
  return { winners, value: top };
}

/** The single best turn across everyone, by `score` (null = doesn't qualify). */
function bestTurn(
  results: TurnResult[],
  score: (r: TurnResult) => number | null,
  dir: "max" | "min",
): { turn: TurnResult; value: number } | null {
  let out: { turn: TurnResult; value: number } | null = null;
  for (const r of results) {
    const v = score(r);
    if (v === null || !Number.isFinite(v)) continue;
    if (!out || (dir === "max" ? v > out.value : v < out.value)) out = { turn: r, value: v };
  }
  return out;
}

function perPlayer(s: GameState, fn: (mine: TurnResult[]) => number | null) {
  return new Map(s.settings.players.map((p) => [p, fn(s.results.filter((r) => r.player === p))]));
}

const finished = (r: TurnResult) => r.timeMs !== null;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeAwards(s: GameState): Award[] {
  const capMs = s.settings.timeCapSec * 1000;
  const out: Award[] = [];
  const add = (a: Omit<Award, "winners">, winners: string[]) => {
    if (winners.length) out.push({ ...a, winners });
  };

  // Fastest single turn.
  const ice = bestTurn(s.results, (r) => r.timeMs, "min");
  if (ice)
    add(
      {
        emoji: "🧊",
        title: "Fastest of the Night",
        blurb: "Quickest bar and drink of the crawl",
        stat: `${secs(ice.value)} · round ${ice.turn.round} in ${ice.turn.city}`,
        always: true,
      },
      [ice.turn.player],
    );

  const dog = bestTurn(s.results, (r) => r.barMs, "min");
  if (dog)
    add(
      { emoji: "🐕", title: "Bloodhound", blurb: "Sniffed out a bar fastest", stat: `bar found at ${secs(dog.value)}` },
      [dog.turn.player],
    );

  const sipper = bestTurn(s.results, (r) => r.drinkMs, "min");
  if (sipper)
    add(
      { emoji: "🚀", title: "Speed Sipper", blurb: "Fastest drink of the night", stat: `empty at ${secs(sipper.value)}` },
      [sipper.turn.player],
    );

  const nurse = bestTurn(s.results, (r) => r.drinkMs, "max");
  if (nurse && sipper && nurse.turn !== sipper.turn)
    add(
      { emoji: "🐢", title: "Nursing It", blurb: "Took their sweet time with a drink", stat: `${secs(nurse.value)} for one drink` },
      [nurse.turn.player],
    );

  // Walked the furthest compared with the shortest route.
  const lost = bestTurn(s.results, (r) => (r.walkedM && r.pathM ? r.walkedM / r.pathM : null), "max");
  if (lost && lost.value >= 1.5)
    add(
      {
        emoji: "🧭",
        title: "Most Lost",
        blurb: "Took the scenic route",
        stat: `walked ${lost.value.toFixed(1)}× the shortest route in ${lost.turn.city}`,
      },
      [lost.turn.player],
    );

  // Made it to a known bar while walking barely more than the shortest route.
  const beeline = bestTurn(
    s.results.filter((r) => finished(r) && (r.walkedM ?? 0) > 0 && r.endPathM !== undefined && r.endPathM <= 40),
    (r) => (r.walkedM && r.pathM ? r.walkedM / r.pathM : null),
    "min",
  );
  if (beeline && beeline.value <= 1.3)
    add(
      { emoji: "🎯", title: "Beeline", blurb: "Walked it like they knew the way", stat: `only ${beeline.value.toFixed(2)}× the shortest route` },
      [beeline.turn.player],
    );

  const marathon = best(perPlayer(s, (mine) => sum(mine.map((r) => r.walkedM ?? 0)) || null), "max");
  if (marathon)
    add({ emoji: "🏃", title: "Marathon", blurb: "Most ground covered all night", stat: `${m(marathon.value)} walked` }, marathon.winners);

  // Found a bar while barely moving.
  const couch = bestTurn(s.results.filter((r) => r.barMs !== null && r.steps !== undefined), (r) => r.steps ?? null, "min");
  if (couch && couch.value <= 5)
    add(
      {
        emoji: "🛋️",
        title: "Couch Potato",
        blurb: "Found a bar without really trying",
        stat: couch.value === 0 ? "didn't take a single step" : `${couch.value} step${couch.value === 1 ? "" : "s"}`,
      },
      [couch.turn.player],
    );

  // Ended further from their nearest bar than they started.
  const wrongWay = bestTurn(s.results, (r) => (r.endPathM !== undefined && r.pathM ? r.endPathM - r.pathM : null), "max");
  if (wrongWay && wrongWay.value >= 30)
    add(
      { emoji: "🔄", title: "Wrong Way", blurb: "Ended up further from a bar than they started", stat: `${m(wrongWay.value)} further from the nearest bar` },
      [wrongWay.turn.player],
    );

  // Claimed a bar that isn't on our map at all.
  const local = bestTurn(s.results.filter(finished), (r) => r.claimNearestBarM ?? null, "max");
  if (local && local.value >= 60)
    add(
      {
        emoji: "🗺️",
        title: "Local Knowledge",
        blurb: "Found a bar that isn't on our map",
        stat: `nearest known bar was ${m(local.value)} away`,
      },
      [local.turn.player],
    );

  const lastOrders = bestTurn(s.results.filter(finished), (r) => r.timeMs!, "max");
  if (lastOrders && capMs - lastOrders.value <= 60_000 && lastOrders.turn !== ice?.turn)
    add(
      { emoji: "🔔", title: "Last Orders", blurb: "Cut it fine", stat: `${secs(capMs - lastOrders.value)} to spare` },
      [lastOrders.turn.player],
    );

  const dnfs = best(perPlayer(s, (mine) => mine.filter((r) => !finished(r)).length || null), "max");
  if (dnfs)
    add({ emoji: "💀", title: "Out of Time", blurb: "Most DNFs", stat: `${dnfs.value} DNF${dnfs.value === 1 ? "" : "s"}` }, dnfs.winners);

  // Bar and drink at almost the same moment.
  const multi = bestTurn(s.results.filter(finished), (r) => (r.barMs !== null && r.drinkMs !== null ? Math.abs(r.barMs - r.drinkMs) : null), "min");
  if (multi && multi.value <= 5_000)
    add(
      { emoji: "🤹", title: "Multitasker", blurb: "Found a bar and finished their drink at the same time", stat: `${(multi.value / 1000).toFixed(1)} s apart` },
      [multi.turn.player],
    );

  // Drank up long before finding anywhere to drink.
  const thirsty = bestTurn(s.results, (r) => (r.barMs !== null && r.drinkMs !== null ? r.barMs - r.drinkMs : null), "max");
  if (thirsty && thirsty.value >= 30_000)
    add(
      { emoji: "🥤", title: "Drink First, Ask Later", blurb: "Empty glass, still no bar", stat: `${secs(thirsty.value)} of dry wandering` },
      [thirsty.turn.player],
    );

  // Found the bar, then stood around finishing their drink.
  const loiter = bestTurn(s.results, (r) => (r.barMs !== null && r.drinkMs !== null ? r.drinkMs - r.barMs : null), "max");
  if (loiter && loiter.value >= 30_000)
    add(
      { emoji: "🪑", title: "Window Shopper", blurb: "Found a bar, then took ages to drink", stat: `${secs(loiter.value)} outside the door` },
      [loiter.turn.player],
    );

  // Biggest drop from their first finished turn to their last.
  const improved = best(
    perPlayer(s, (mine) => {
      const done = mine.filter(finished).sort((a, b) => a.round - b.round);
      return done.length >= 2 ? done[0].timeMs! - done[done.length - 1].timeMs! : null;
    }),
    "max",
  );
  if (improved && improved.value > 0)
    add(
      { emoji: "📈", title: "Most Improved", blurb: "Got better as the night went on", stat: `${secs(improved.value)} faster than their first turn` },
      improved.winners,
    );

  // Most consistent times (smallest spread), at least 3 finished turns.
  const steady = best(
    perPlayer(s, (mine) => {
      const t = mine.filter(finished).map((r) => r.timeMs!);
      return t.length >= 3 ? Math.max(...t) - Math.min(...t) : null;
    }),
    "min",
  );
  if (steady)
    add({ emoji: "🪨", title: "Steady Eddie", blurb: "Most consistent all night", stat: `every turn within ${secs(steady.value)}` }, steady.winners);

  const countries = best(perPlayer(s, (mine) => new Set(mine.map((r) => r.country)).size || null), "max");
  if (countries && countries.value >= 2 && countries.winners.length < s.settings.players.length)
    add({ emoji: "🌍", title: "Globetrotter", blurb: "Most countries visited", stat: `${countries.value} countries` }, countries.winners);

  const rerolls = best(perPlayer(s, (mine) => sum(mine.map((r) => r.rerolls ?? 0)) || null), "max");
  if (rerolls)
    add({ emoji: "🎲", title: "Re-roll Royalty", blurb: "Never happy with where they landed", stat: `${rerolls.value} re-roll${rerolls.value === 1 ? "" : "s"}` }, rerolls.winners);

  const lucky = bestTurn(s.results, (r) => r.pathM ?? null, "min");
  if (lucky)
    add({ emoji: "🍀", title: "Lucky Drop", blurb: "Dropped closest to a bar", stat: `a ${m(lucky.value)} walk from ${lucky.turn.bar ?? "a bar"}` }, [lucky.turn.player]);

  return pickAwards(s, out);
}

/** How many awards are handed out at the end of the night. */
export const AWARDS_SHOWN = 4;

/**
 * Deal AWARDS_SHOWN awards from everything that qualified, at random, so
 * each night gets a different mix. Different winners come first; someone
 * only gets a second award if there aren't enough other people to go round.
 * The shuffle is seeded from the results, so a refresh deals the same hand.
 */
function pickAwards(s: GameState, pool: Award[]): Award[] {
  const rand = seededRandom(JSON.stringify(s.results.map((r) => [r.round, r.player, r.timeMs])));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // The fastest turn always gets an award; the shuffle deals the rest.
  const always = shuffled.filter((a) => a.always);
  const picked: Award[] = [];
  const awarded = new Set<string>(always.flatMap((a) => a.winners));
  const slots = AWARDS_SHOWN - always.length;
  // First pass: only awards for people who don't have one yet.
  for (const a of shuffled) {
    if (picked.length === slots) break;
    if (a.always || a.winners.some((w) => awarded.has(w))) continue;
    picked.push(a);
    a.winners.forEach((w) => awarded.add(w));
  }
  // Second pass: fill any gaps with whatever's left.
  for (const a of shuffled) {
    if (picked.length === slots) break;
    if (!a.always && !picked.includes(a)) picked.push(a);
  }

  // Short game, not enough qualified: top up with consolation awards,
  // to people without one first.
  const consolations = [
    { emoji: "🎗️", title: "Just Happy To Be Here", blurb: "Showed up, drank up" },
    { emoji: "🍟", title: "Here For The Snacks", blurb: "The bar was never the point" },
    { emoji: "🫶", title: "Moral Support", blurb: "The crawl needed you" },
    { emoji: "🧢", title: "Designated Navigator", blurb: "Next time, surely" },
  ];
  const players = [...s.settings.players].sort((a, b) => Number(awarded.has(a)) - Number(awarded.has(b)));
  for (let i = 0; picked.length < slots && i < Math.min(players.length, consolations.length); i++) {
    const p = players[i];
    const mine = s.results.filter((r) => r.player === p);
    const walked = sum(mine.map((r) => r.walkedM ?? 0));
    const cities = [...new Set(mine.map((r) => r.city))];
    const stat = walked ? `${m(walked)} walked across ${cities.join(", ")}` : cities.length ? `visited ${cities.join(", ")}` : "turned up";
    picked.push({ ...consolations[i], winners: [p], stat });
  }
  // Saved for last: the big one.
  return [...picked, ...always];
}

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
