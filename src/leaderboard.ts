import { fastestOfNight, formatTime, roundWinner, standings, type GameState } from "./state";
import { esc } from "./util";

export function leaderboardHTML(s: GameState): string {
  const fastest = fastestOfNight(s);
  const rows = standings(s);
  const rounds = Array.from({ length: s.settings.rounds }, (_, i) => i + 1);

  const banner = fastest
    ? `<div class="fastest-banner">
         <span class="trophy">🏆</span>
         <div>
           <div class="fb-label">Fastest of the night</div>
           <div class="fb-main">${esc(fastest.player)} · ${formatTime(fastest.timeMs!)}</div>
           <div class="fb-sub">Round ${fastest.round} · ${esc(fastest.city)}, ${esc(fastest.country)}</div>
         </div>
       </div>`
    : `<div class="fastest-banner empty">No finishes yet. Somebody drink faster.</div>`;

  const standingsRows = rows
    .map((r, i) => {
      const leader = i === 0 && r.turns > 0;
      return `<tr class="${leader ? "leader" : ""}">
        <td class="rank">${r.turns ? i + 1 : "–"}</td>
        <td class="name">${esc(r.player)}</td>
        <td class="num wins">${r.wins ? "🏆".repeat(Math.min(r.wins, 5)) : "0"}</td>
        <td class="num">${r.totalMs ? formatTime(r.totalMs) : "—"}</td>
        <td class="num">${r.bestMs === null ? "—" : formatTime(r.bestMs)}</td>
        <td class="num ${r.dnfs ? "dnf" : ""}">${r.dnfs}</td>
      </tr>`;
    })
    .join("");

  const roundRows = s.settings.players
    .map((p) => {
      const cells = rounds
        .map((round) => {
          const res = s.results.find((r) => r.player === p && r.round === round);
          if (!res) return `<td class="num pending">·</td>`;
          const winner = roundWinner(s, round);
          const cls = [
            "num",
            res.timeMs === null ? "dnf" : "",
            res === fastest ? "fastest" : res === winner ? "round-win" : "",
          ].join(" ");
          const where = `${res.city}, ${res.country}`;
          return `<td class="${cls}" title="${esc(where)}">
              ${res.timeMs === null ? "DNF" : formatTime(res.timeMs)}
              <span class="cell-city">${esc(res.city)}</span>
            </td>`;
        })
        .join("");
      return `<tr><td class="name">${esc(p)}</td>${cells}</tr>`;
    })
    .join("");

  return `
    ${banner}
    <h3>Standings</h3>
    <p class="lb-rule">Most rounds won. Ties go to the lowest total time (DNF counts as the cap).</p>
    <table class="lb">
      <thead><tr><th>#</th><th>Player</th><th class="num">Wins</th><th class="num" title="Completed rounds added up; a DNF counts as the time cap">Total</th><th class="num">Best</th><th class="num">DNF</th></tr></thead>
      <tbody>${standingsRows}</tbody>
    </table>
    <h3>By round</h3>
    <table class="lb rounds">
      <thead><tr><th>Player</th>${rounds.map((r) => `<th class="num ${r === s.round && s.phase === "playing" ? "current" : ""}">R${r}</th>`).join("")}</tr></thead>
      <tbody>${roundRows}</tbody>
    </table>`;
}
