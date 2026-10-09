import { roundWinner, type GameState, type TurnResult } from "./state";

/** Rounds won by each player, counting only rounds up to and including `upTo`. */
export function trophies(s: GameState, upTo: number): Map<string, number> {
  const wins = new Map(s.settings.players.map((p) => [p, 0]));
  for (let r = 1; r <= upTo; r++) {
    const w = roundWinner(s, r)?.player;
    if (w && wins.has(w)) wins.set(w, wins.get(w)! + 1);
  }
  return wins;
}

/** "🏆🏆" for two wins; a number past five so it stays on one line. */
export function trophyIcons(n: number): string {
  if (n <= 0) return "";
  return n > 5 ? `🏆×${n}` : "🏆".repeat(n);
}

export interface RoundSummary {
  winner: TurnResult | null;
  /** The story of the night so far, e.g. "Dan takes the lead!" */
  headline: string;
}

/** What to say once a round is over. Call when the round is complete. */
export function summariseRound(s: GameState): RoundSummary {
  const round = s.round;
  const winner = roundWinner(s, round);
  const before = trophies(s, round - 1);
  const after = trophies(s, round);
  const last = round >= s.settings.rounds;
  const leadersBefore = leaders(before);
  const leadersAfter = leaders(after);
  const W = winner?.player ?? "";
  // Pick a phrasing from the round number, so a refresh says the same thing.
  const say = (...options: string[]) => options[(round - 1) % options.length];

  if (!winner) {
    if (!leadersAfter.length) return { winner, headline: say("Nobody found a bar. The bar staff are disappointed.", "A round to forget. Nobody made it.") };
    return { winner, headline: `Nobody made it this round, so ${list(leadersAfter)} ${leadersAfter.length > 1 ? "stay" : "stays"} in front.` };
  }

  if (last) {
    if (leadersAfter.length === 1) {
      const champ = leadersAfter[0];
      return {
        winner,
        headline:
          champ === W
            ? say(`${W} seals it in style!`, `${W} finishes it off and wins the crawl!`)
            : `${W} takes the last round, but ${champ} wins the crawl!`,
      };
    }
    return { winner, headline: `Level on trophies at the end: ${list(leadersAfter)}. Total time decides it.` };
  }

  if (round === 1) return { winner, headline: say(`${W} starts off strong`, `${W} draws first blood`, `${W} sets the pace`) };

  const streak = winStreak(s, round, W);
  if (leadersAfter.length === 1) {
    const L = leadersAfter[0];
    const wasSoleLeader = leadersBefore.length === 1 && leadersBefore[0] === L;
    if (L === W && wasSoleLeader) {
      if (streak >= 3) return { winner, headline: `${W} makes it ${streak} in a row 🔥` };
      const margin = after.get(L)! - Math.max(...[...after].filter(([p]) => p !== L).map(([, n]) => n), 0);
      return { winner, headline: margin >= 2 ? say(`${W} is running away with it`, `${W} pulls clear`) : say(`${W} extends the lead`, `${W} stays out in front`) };
    }
    if (L === W) {
      return {
        winner,
        headline: leadersBefore.includes(W) ? `${W} breaks the tie and takes the lead!` : say(`${W} takes the lead!`, `New leader: ${W}!`),
      };
    }
    return { winner, headline: say(`${W} fights back, but ${L} still leads`, `${W} wins this one, ${L} still on top`) };
  }

  if (leadersAfter.includes(W)) return { winner, headline: say(`${W} draws level: all to play for`, `All square at the top: ${list(leadersAfter)}`) };
  return { winner, headline: `${W} wins the round. ${list(leadersAfter)} share the lead.` };
}

function leaders(wins: Map<string, number>): string[] {
  const top = Math.max(0, ...wins.values());
  return top === 0 ? [] : [...wins].filter(([, n]) => n === top).map(([p]) => p);
}

/** How many rounds in a row `player` has won, ending with `round`. */
function winStreak(s: GameState, round: number, player: string): number {
  let n = 0;
  for (let r = round; r >= 1 && roundWinner(s, r)?.player === player; r--) n++;
  return n;
}

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
