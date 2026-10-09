import type { Script } from "./cities";

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTIES: Record<Difficulty, { name: string; emoji: string; blurb: string }> = {
  easy: { name: "Tourist", emoji: "🧳", blurb: "English-speaking cities, shorter walks" },
  normal: { name: "Pub crawler", emoji: "🍺", blurb: "English for 2 rounds, then gets foreign" },
  hard: { name: "Lost abroad", emoji: "🌍", blurb: "Anywhere from round 1, longer walks" },
};

/** Walking distance: 100 m in round 1, +50 m a round, capped. */
const PATH_BASE_M = 100;
const PATH_STEP_M = 50;
const PATH_MAX_M = 300;

const DISTANCE_MULTIPLIER: Record<Difficulty, number> = { easy: 0.75, normal: 1, hard: 1.5 };

/** Sign languages unlocked at each stage. Stage 0 is English only. */
const STAGES: Script[][] = [["english"], ["english", "latin"], ["english", "latin", "other"]];

export interface DropSpec {
  /** Target walk from the drop to the bar, in metres. */
  pathM: number;
  /** Which kinds of city this round can be in. */
  scripts: Script[];
}

export function dropSpec(round: number, difficulty: Difficulty = "normal"): DropSpec {
  // Normal: English for rounds 1–2, + Latin alphabet in 3, anywhere from 4.
  const stage = difficulty === "easy" ? 0 : difficulty === "hard" ? STAGES.length - 1 : Math.max(0, round - 2);
  const base = Math.min(PATH_MAX_M, PATH_BASE_M + PATH_STEP_M * (round - 1));
  return {
    pathM: Math.round(base * DISTANCE_MULTIPLIER[difficulty]),
    scripts: STAGES[Math.min(stage, STAGES.length - 1)],
  };
}

export function describeScripts(scripts: Script[]): string {
  if (scripts.length === 1) return "English-speaking";
  if (!scripts.includes("other")) return "English or Latin alphabet";
  return "anywhere";
}
