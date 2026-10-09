import type { Difficulty } from "./difficulty";

export interface Settings {
  players: string[];
  timeCapSec: number;
  rounds: number;
  /** Missing in games saved before difficulty existed: treat as "normal". */
  difficulty?: Difficulty;
}

export interface TurnResult {
  round: number;
  player: string;
  /** Final time in ms, or null for a DNF. */
  timeMs: number | null;
  barMs: number | null;
  drinkMs: number | null;
  city: string;
  country: string;
  panoId: string;
  /** The nearest known bar to the start (by walk), and how far it was in a straight line. */
  bar?: string;
  barDistanceM?: number;
  /** Walk to the nearest known bar along Street View links, at the start and at the end. */
  pathM?: number;
  endPathM?: number;
  /** For tuning: straight line to the nearest known bar where they finished. */
  endBarDistanceM?: number;
  walkedM?: number;
  steps?: number;
  /** Times the player asked for a new spot this turn. */
  rerolls?: number;
  /** Straight line from where they pressed BAR FOUND to the nearest known bar. */
  claimNearestBarM?: number;
}

export type Phase = "setup" | "playing" | "finished";

export interface GameState {
  phase: Phase;
  settings: Settings;
  round: number;
  playedThisRound: string[];
  results: TurnResult[];
}

const KEY = "bar-crawl-roulette:v1";

const DEFAULT_SETTINGS: Settings = { players: [], timeCapSec: 180, rounds: 3, difficulty: "normal" };

function fresh(settings: Settings = DEFAULT_SETTINGS): GameState {
  return { phase: "setup", settings: { ...settings }, round: 1, playedThisRound: [], results: [] };
}

export function load(): GameState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s && Array.isArray(s.results) && s.settings) return s;
    }
  } catch {}
  return fresh();
}

export function save(s: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

/** Wipe the results but keep the player list and settings for the next game. */
export function newGame(prev: GameState): GameState {
  const s = fresh(prev.settings);
  save(s);
  return s;
}

export function startGame(settings: Settings): GameState {
  const next: GameState = { ...fresh(settings), phase: "playing" };
  save(next);
  return next;
}

export function remainingThisRound(s: GameState): string[] {
  return s.settings.players.filter((p) => !s.playedThisRound.includes(p));
}

/**
 * The playing order: whoever the wheel picked in round 1, in that order.
 * Anyone without a round-1 turn (round 1 still going) goes on the end.
 */
export function turnOrder(s: GameState): string[] {
  const first = s.results.filter((r) => r.round === 1).map((r) => r.player);
  const order = first.filter((p, i) => first.indexOf(p) === i && s.settings.players.includes(p));
  return [...order, ...s.settings.players.filter((p) => !order.includes(p))];
}

/**
 * Who plays next without a spin, or null if the wheel should decide. The
 * wheel only picks in round 1, and only while there's a real choice.
 */
export function nextWithoutSpin(s: GameState): string | null {
  const remaining = remainingThisRound(s);
  if (s.round === 1 && remaining.length > 1) return null;
  return turnOrder(s).find((p) => remaining.includes(p)) ?? null;
}

export function recordTurn(s: GameState, r: TurnResult): GameState {
  const next: GameState = {
    ...s,
    results: [...s.results, r],
    playedThisRound: [...s.playedThisRound, r.player],
  };
  save(next);
  return next;
}

/** Called once everyone has played: move to the next round or finish. */
export function advanceRound(s: GameState): GameState {
  const next: GameState =
    s.round >= s.settings.rounds
      ? { ...s, phase: "finished" }
      : { ...s, round: s.round + 1, playedThisRound: [] };
  save(next);
  return next;
}

export interface Standing {
  player: string;
  /** Rounds won: fastest finish in a round everyone has played. */
  wins: number;
  /**
   * Turns in completed rounds added up, with a DNF counting as the full time
   * cap. Mid-round, only some players have played, so that round waits.
   */
  totalMs: number;
  bestMs: number | null;
  dnfs: number;
  turns: number;
}

/** A round counts once everyone has had their turn in it. */
export function roundComplete(s: GameState, round: number): boolean {
  if (round < s.round || s.phase === "finished") return true;
  return round === s.round && remainingThisRound(s).length === 0;
}

/** Fastest finisher of a completed round, or null (not complete, or all DNF). */
export function roundWinner(s: GameState, round: number): TurnResult | null {
  if (!roundComplete(s, round)) return null;
  let best: TurnResult | null = null;
  for (const r of s.results) {
    if (r.round === round && r.timeMs !== null && (!best || r.timeMs < best.timeMs!)) best = r;
  }
  return best;
}

/**
 * Ranked by rounds won, then lowest total time (DNF = time cap), then best
 * single time.
 */
export function standings(s: GameState): Standing[] {
  const capMs = s.settings.timeCapSec * 1000;
  const winners = Array.from({ length: s.settings.rounds }, (_, i) => roundWinner(s, i + 1)?.player);
  const rows = s.settings.players.map((player) => {
    const mine = s.results.filter((r) => r.player === player);
    const times = mine.map((r) => r.timeMs).filter((t): t is number => t !== null);
    return {
      player,
      wins: winners.filter((w) => w === player).length,
      totalMs: mine
        .filter((r) => roundComplete(s, r.round))
        .reduce((sum, r) => sum + (r.timeMs ?? capMs), 0),
      bestMs: times.length ? Math.min(...times) : null,
      dnfs: mine.filter((r) => r.timeMs === null).length,
      turns: mine.length,
    };
  });
  return rows.sort(
    (a, b) =>
      b.wins - a.wins ||
      a.totalMs - b.totalMs ||
      (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity) ||
      a.player.localeCompare(b.player),
  );
}

export function fastestOfNight(s: GameState): TurnResult | null {
  let best: TurnResult | null = null;
  for (const r of s.results) {
    if (r.timeMs !== null && (!best || r.timeMs < best.timeMs!)) best = r;
  }
  return best;
}

export function formatTime(ms: number, tenths = true): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const sec = Math.floor((total % 60000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  return `${m}:${String(sec).padStart(2, "0")}${tenths ? `.${t}` : ""}`;
}
