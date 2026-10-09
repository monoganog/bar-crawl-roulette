import "@fontsource/caveat/700.css";
import "./style.css";
import { computeAwards } from "./awards";
import { summariseRound, trophies, trophyIcons } from "./commentary";
import { leaderboardHTML } from "./leaderboard";
import { rulesHTML } from "./rules";
import { DIFFICULTIES, dropSpec, type Difficulty } from "./difficulty";
import { findRandomLocation, loadStreetView, type FoundLocation } from "./streetview";
import * as G from "./state";
import { Turn } from "./turn";
import { esc } from "./util";
import { Wheel } from "./wheel";

const API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "").trim();
const VERSION = [
  `v${__APP_VERSION__}`,
  import.meta.env.DEV ? "dev" : __BUILD_NUMBER__ && `build ${__BUILD_NUMBER__}`,
  __COMMIT__,
]
  .filter(Boolean)
  .join(" · ");
// Start loading Google's script now so the first turn doesn't wait for it.
if (API_KEY) loadStreetView(API_KEY).catch(() => {});

const app = document.querySelector<HTMLDivElement>("#app")!;
let state = G.load();
let screen: { key?: (e: KeyboardEvent) => boolean; destroy?: () => void } = {};
let prefetch: { promise: Promise<FoundLocation>; abort: AbortController } | null = null;

app.innerHTML = `
  <header class="top">
    <div class="brand">
      <div class="logo">🍺 Bar Crawl <span>Roulette</span></div>
      <div class="version">${VERSION}</div>
    </div>
    <div class="round-pill" id="roundPill"></div>
    <div class="top-actions">
      <button class="ghost danger" id="newBtn">New game</button>
    </div>
  </header>
  <main id="screen"></main>
  <div class="modal hidden" id="lbModal">
    <div class="modal-card">
      <button class="modal-close" id="lbClose" aria-label="Close">×</button>
      <h2>Leaderboard</h2>
      <div id="lbBody"></div>
    </div>
  </div>`;

const main = document.querySelector<HTMLElement>("#screen")!;
const lbModal = document.querySelector<HTMLElement>("#lbModal")!;

document.querySelector("#lbClose")!.addEventListener("click", toggleLeaderboard);
lbModal.addEventListener("click", (e) => e.target === lbModal && toggleLeaderboard());
document.querySelector("#newBtn")!.addEventListener("click", () => {
  if (state.results.length && !confirm("Start a new game? This clears the leaderboard.")) return;
  cancelPrefetch();
  state = G.newGame(state);
  render();
});

window.addEventListener(
  "keydown",
  (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (!lbModal.classList.contains("hidden")) {
      if (k === "escape" || k === "l") {
        toggleLeaderboard();
        e.preventDefault();
      }
      return;
    }
    if (screen.key?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (k === "l" && state.phase !== "setup") {
      toggleLeaderboard();
      e.preventDefault();
    }
  },
  // Capture phase, so Space/Enter/L reach the game before Street View sees them.
  true,
);

function toggleLeaderboard() {
  const open = lbModal.classList.toggle("hidden") === false;
  if (open) document.querySelector("#lbBody")!.innerHTML = leaderboardHTML(state);
}

function setScreen(s: typeof screen) {
  screen.destroy?.();
  screen = s;
  document.body.classList.remove("in-turn");
  // Each screen starts at the top, not wherever the last one was scrolled to.
  main.scrollTop = 0;
}

function render() {
  const pill = document.querySelector<HTMLElement>("#roundPill")!;
  const diff = DIFFICULTIES[state.settings.difficulty ?? "normal"];
  pill.innerHTML =
    state.phase === "playing"
      ? `Round ${state.round} / ${state.settings.rounds}<span class="pill-diff"> · ${diff.emoji} ${diff.name}</span>`
      : "";
  pill.classList.toggle("hidden", state.phase !== "playing");
  document.querySelector<HTMLElement>("#newBtn")!.classList.toggle("hidden", state.phase === "setup");

  if (state.phase === "setup") renderSetup();
  else if (state.phase === "finished") renderFinished();
  else if (G.remainingThisRound(state).length === 0) {
    // Playing solo, the results page already said how it went: skip the
    // round review and carry straight on.
    if (state.settings.players.length === 1) {
      state = G.advanceRound(state);
      render();
    } else {
      renderRoundOver();
    }
  }
  else renderWheel();
}

// ---------- Setup ----------

function renderSetup() {
  const players = [...state.settings.players];
  let capMin = state.settings.timeCapSec / 60;
  let rounds = state.settings.rounds;
  let difficulty: Difficulty = state.settings.difficulty ?? "normal";

  // On a phone, focusing the name box scrolls the page down to it and pops up
  // the keyboard before anyone has read the rules. Only do it with a mouse,
  // or once they've started adding players.
  let typing = window.matchMedia("(pointer: fine)").matches;
  const draw = () => {
    main.innerHTML = `
      ${rulesHTML(capMin * 60)}
      <section class="setup">
        <h1>Who's crawling tonight?</h1>
        ${
          API_KEY
            ? ""
            : `<div class="warn">No Google Maps API key found. Add <code>VITE_GOOGLE_MAPS_KEY</code> to <code>.env</code> and restart <code>npm run dev</code>. See the README.</div>`
        }
        <ul class="player-list">
          ${players
            .map(
              (p, i) =>
                `<li><span>${esc(p)}</span><button class="remove" data-i="${i}" aria-label="Remove ${esc(p)}">×</button></li>`,
            )
            .join("")}
        </ul>
        <form class="add-player" id="addForm">
          <input id="nameInput" placeholder="Add a player…" maxlength="20" autocomplete="off" />
          <button class="secondary" type="submit">Add</button>
        </form>
        <div class="settings">
          <label>Time cap (minutes)
            <input id="capInput" type="number" min="0.5" max="30" step="0.5" value="${capMin}" />
          </label>
          <label>Rounds
            <input id="roundsInput" type="number" min="1" max="20" step="1" value="${rounds}" />
          </label>
        </div>
        <fieldset class="difficulty">
          <legend>Difficulty</legend>
          ${(Object.keys(DIFFICULTIES) as Difficulty[])
            .map((d) => {
              const info = DIFFICULTIES[d];
              return `<label class="diff ${d === difficulty ? "on" : ""}">
                <input type="radio" name="difficulty" value="${d}" ${d === difficulty ? "checked" : ""} />
                <span class="diff-emoji">${info.emoji}</span>
                <span class="diff-name">${info.name}</span>
                <span class="diff-blurb">${info.blurb}</span>
              </label>`;
            })
            .join("")}
        </fieldset>
        <div class="setup-error" id="setupError"></div>
        <button class="primary huge" id="startBtn" ${players.length && API_KEY ? "" : "disabled"}>
          Let's go 🍻
        </button>
        <p class="small-print">
          18+ only. Drink responsibly: know your limits, and water or soft drinks work just as well.
          Uses Google Street View (<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's privacy policy</a>
          and <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener">terms</a> apply),
          map tiles from <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
          and bar data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.
          Your game is saved only in this browser.
        </p>
      </section>`;

    const input = main.querySelector<HTMLInputElement>("#nameInput")!;
    const err = main.querySelector<HTMLElement>("#setupError")!;
    if (typing) input.focus({ preventScroll: true });
    main.querySelector("#addForm")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      if (players.some((p) => p.toLowerCase() === name.toLowerCase())) {
        err.textContent = `${name} is already playing.`;
        return;
      }
      players.push(name);
      typing = true; // keep the keyboard up for the next name
      draw();
    });
    main.querySelectorAll<HTMLButtonElement>(".remove").forEach((b) =>
      b.addEventListener("click", () => {
        players.splice(Number(b.dataset.i), 1);
        draw();
      }),
    );
    main.querySelector<HTMLInputElement>("#capInput")!.addEventListener("input", (e) => {
      capMin = Number((e.target as HTMLInputElement).value);
      if (capMin > 0) main.querySelector("#rulesCap")!.textContent = G.formatTime(capMin * 60_000, false);
    });
    main.querySelectorAll<HTMLInputElement>('input[name="difficulty"]').forEach((r) =>
      r.addEventListener("change", () => {
        difficulty = r.value as Difficulty;
        main.querySelectorAll(".diff").forEach((l) => l.classList.toggle("on", l.contains(r)));
      }),
    );
    main.querySelector<HTMLInputElement>("#roundsInput")!.addEventListener("input", (e) => {
      rounds = Number((e.target as HTMLInputElement).value);
    });
    main.querySelector("#startBtn")!.addEventListener("click", () => {
      if (!(capMin >= 0.5 && capMin <= 30)) return void (err.textContent = "Time cap must be 0.5–30 minutes.");
      if (!(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20))
        return void (err.textContent = "Rounds must be a whole number from 1 to 20.");
      state = G.startGame({ players, timeCapSec: Math.round(capMin * 60), rounds, difficulty });
      render();
    });
  };
  setScreen({});
  draw();
}

// ---------- Wheel ----------

function renderWheel() {
  const remaining = G.remainingThisRound(state);
  const next = G.nextWithoutSpin(state);
  main.innerHTML = `
    <section class="wheel-screen">
      <div class="wheel-col">
        ${
          next
            ? `<div class="order" id="order"></div>`
            : `<div class="wheel-box"><canvas id="wheel"></canvas></div>`
        }
        <div class="wheel-cta" id="wheelCta">
          <button class="primary huge" id="spinBtn">SPIN <kbd>Space</kbd></button>
          <div class="wheel-hint">The wheel decides the order. ${remaining.length} of ${state.settings.players.length} still to pick.</div>
        </div>
      </div>
      <aside class="side-lb">${leaderboardHTML(state)}</aside>
    </section>`;

  let phase: "idle" | "spinning" | "picked" = "idle";
  let picked = "";
  let wheel: Wheel | null = null;
  const cta = main.querySelector<HTMLElement>("#wheelCta")!;

  const showPicked = (label: string) => {
    phase = "picked";
    cta.innerHTML = `
      <div class="picked">
        <div class="picked-label">${label}</div>
        <div class="picked-name">${esc(picked)}</div>
        <div class="picked-hint">Grab your drink. The clock starts when the street loads.</div>
        <button class="primary huge" id="goBtn">Start turn <kbd>Enter</kbd></button>
      </div>`;
    main.querySelector("#goBtn")!.addEventListener("click", go);
  };
  const go = () => {
    if (phase === "picked") renderTurn(picked);
  };

  const spin = async () => {
    if (phase !== "idle" || !wheel) return;
    phase = "spinning";
    startPrefetch(); // look for a location while the wheel spins
    const winner = Math.floor(Math.random() * remaining.length);
    picked = remaining[winner];
    cta.innerHTML = `<div class="wheel-hint">Round and round… <kbd>Space</kbd> to skip</div>`;
    await wheel.spin(winner);
    if (screen !== thisScreen) return;
    showPicked("You're up");
  };

  let onResize = () => {};
  if (next) {
    // Round robin: no wheel, just the order with whoever's next highlighted.
    picked = next;
    const order = G.turnOrder(state);
    const won = trophies(state, state.round - 1);
    main.querySelector<HTMLElement>("#order")!.innerHTML = `
      <div class="order-label">Round ${state.round} turn order</div>
      <ol class="order-list">
        ${order
          .map((p) => {
            const cls = p === next ? "now" : state.playedThisRound.includes(p) ? "done" : "";
            const cups = trophyIcons(won.get(p) ?? 0);
            return `<li class="${cls}">${cls === "done" ? "✓ " : ""}${esc(p)}${cups ? ` <span class="cups">${cups}</span>` : ""}</li>`;
          })
          .join("")}
      </ol>`;
    startPrefetch(); // no spin to hide the search behind, so start now
    showPicked(state.round === 1 ? "Last one standing" : "Up next");
  } else {
    wheel = new Wheel(main.querySelector<HTMLCanvasElement>("#wheel")!, remaining);
    onResize = () => wheel!.resize();
    window.addEventListener("resize", onResize);
    main.querySelector("#spinBtn")!.addEventListener("click", spin);
    // Clicking the wheel mid-spin skips to the result too.
    main.querySelector("#wheel")!.addEventListener("click", () => phase === "spinning" && wheel!.skip());
  }

  const thisScreen = {
    key: (e: KeyboardEvent) => {
      const k = e.key;
      if (k !== " " && k !== "Enter") return false;
      if (e.repeat) return true; // holding the key shouldn't skip and start in one go
      if (phase === "idle") spin();
      else if (phase === "spinning") wheel?.skip();
      else go();
      return true;
    },
    destroy: () => window.removeEventListener("resize", onResize),
  };
  setScreen(thisScreen);
}

function startPrefetch() {
  cancelPrefetch();
  if (!API_KEY) return;
  const abort = new AbortController();
  const promise = findRandomLocation(API_KEY, { spec: currentSpec(), signal: abort.signal });
  promise.catch(() => {}); // the turn screen reports errors
  prefetch = { promise, abort };
}

function currentSpec() {
  return dropSpec(state.round, state.settings.difficulty);
}

function cancelPrefetch() {
  prefetch?.abort.abort();
  prefetch = null;
}

// ---------- Turn ----------

function renderTurn(player: string) {
  const spec = currentSpec();
  const search = prefetch?.promise ?? findRandomLocation(API_KEY, { spec });
  const abort = prefetch?.abort;
  prefetch = null;

  const turn = new Turn({
    root: main,
    apiKey: API_KEY,
    player,
    round: state.round,
    capSec: state.settings.timeCapSec,
    drop: spec,
    location: search,
    onFinish: (r) => {
      state = G.recordTurn(state, r);
    },
    onContinue: () => render(),
  });
  setScreen({
    key: (e) => turn.handleKey(e),
    destroy: () => {
      abort?.abort();
      turn.destroy();
    },
  });
  // Phones hide the header during a turn (see style.css).
  document.body.classList.add("in-turn");
}

// ---------- Round over / finished ----------

function renderRoundOver() {
  const last = state.round >= state.settings.rounds;
  const roundResults = state.results
    .filter((r) => r.round === state.round)
    .sort((a, b) => (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity));
  const { winner, headline } = summariseRound(state);
  const won = trophies(state, state.round);
  main.innerHTML = `
    <section class="interstitial">
      <div class="round-label">Round ${state.round} of ${state.settings.rounds}</div>
      <div class="round-winner">
        ${
          winner
            ? `<span class="round-cup">🏆</span>
               <span><strong>${esc(winner.player)}</strong> wins round ${state.round}</span>
               <span class="round-winner-time">${G.formatTime(winner.timeMs!)}</span>`
            : `<span class="round-cup">🫗</span><span>No winner this round</span>`
        }
      </div>
      <p class="round-headline">${esc(headline)}</p>
      <ol class="round-list">
        ${roundResults
          .map(
            (r) => `<li class="${r.timeMs === null ? "dnf" : ""}">
              <span class="rl-name">${esc(r.player)}${trophyIcons(won.get(r.player) ?? 0) ? ` <span class="cups">${trophyIcons(won.get(r.player) ?? 0)}</span>` : ""}</span>
              <span class="rl-time">${r.timeMs === null ? "DNF" : G.formatTime(r.timeMs)}</span>
              <span class="rl-city">${esc(r.city)}, ${esc(r.country)}</span>
            </li>`,
          )
          .join("")}
      </ol>
      <button class="primary huge" id="nextBtn">${last ? "Final results 🏆" : `Start round ${state.round + 1}`} <kbd>Enter</kbd></button>
    </section>`;
  const next = () => {
    state = G.advanceRound(state);
    render();
  };
  main.querySelector("#nextBtn")!.addEventListener("click", next);
  setScreen({
    key: (e) => {
      if (e.key !== "Enter" && e.key !== " ") return false;
      // The key that closed the last reveal may still be held down.
      if (!e.repeat) next();
      return true;
    },
  });
}

function renderFinished() {
  const champ = G.standings(state)[0];
  const awards = computeAwards(state);
  main.innerHTML = `
    <section class="finished">
      <div class="champ">
        <div class="champ-label">Champion of the crawl</div>
        <div class="champ-name">${champ && (champ.wins || champ.bestMs !== null) ? `👑 ${esc(champ.player)}` : "Nobody. Shameful."}</div>
        ${champ && champ.wins ? `<div class="champ-sub">${champ.wins} round${champ.wins === 1 ? "" : "s"} won · ${G.formatTime(champ.totalMs)} total</div>` : ""}
      </div>
      <div class="awards-head">
        <h2>The awards</h2>
        <div class="awards-actions">
          <span class="awards-hint" id="awardsHint">Drumroll…</span>
        </div>
      </div>
      <ol class="awards">
        ${awards
          .map(
            (a, i) => `
          <li>
            <button class="award" data-i="${i}" aria-label="Reveal award ${i + 1}">
              <span class="award-inner">
                <span class="award-back"><span>${i + 1}</span></span>
                <span class="award-front">
                  <span class="award-emoji">${a.emoji}</span>
                  <span class="award-title">${esc(a.title)}</span>
                  <span class="award-winner">${a.winners.map(esc).join(" & ")}</span>
                  <span class="award-stat">${esc(a.stat)}</span>
                  <span class="award-blurb">${esc(a.blurb)}</span>
                </span>
              </span>
            </button>
          </li>`,
          )
          .join("")}
      </ol>
      <div class="finished-lb">${leaderboardHTML(state)}</div>
      <button class="primary huge" id="againBtn">New game</button>
    </section>`;

  const cards = [...main.querySelectorAll<HTMLButtonElement>(".award")];
  const hint = main.querySelector<HTMLElement>("#awardsHint")!;
  const reveal = (card: HTMLButtonElement) => {
    card.classList.add("revealed");
    card.setAttribute("aria-label", card.querySelector(".award-front")!.textContent!.replace(/\s+/g, " ").trim());
    if (cards.every((c) => c.classList.contains("revealed"))) hint.textContent = "That's everyone. Same time next week?";
  };
  const revealNext = () => {
    const next = cards.find((c) => !c.classList.contains("revealed"));
    if (next) {
      reveal(next);
      next.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };
  cards.forEach((c) => c.addEventListener("click", () => reveal(c)));
  // Turn the cards over one at a time, a second apart. Space or a tap
  // reveals the next one early.
  const timer = window.setInterval(() => {
    revealNext();
    if (cards.every((c) => c.classList.contains("revealed"))) window.clearInterval(timer);
  }, 1000);
  main.querySelector("#againBtn")!.addEventListener("click", () => {
    state = G.newGame(state);
    render();
  });
  setScreen({
    key: (e) => {
      if (e.key !== " " && e.key !== "Enter") return false;
      if (!e.repeat) revealNext();
      return true;
    },
    destroy: () => window.clearInterval(timer),
  });
}

render();
