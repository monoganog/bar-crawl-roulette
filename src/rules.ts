import { formatTime } from "./state";

// Line pictograms on a 64×64 grid, drawn in currentColor.
const ICONS = {
  drop: `
    <path d="M32 5c-9.4 0-17 7.4-17 16.6C15 34 32 50 32 50s17-16 17-28.4C49 12.4 41.4 5 32 5z"/>
    <circle cx="32" cy="21.5" r="6"/>
    <path d="M6 59h52M24 59l3-7M40 59l-3-7"/>`,
  find: `
    <circle cx="27" cy="27" r="18"/>
    <path d="M40 40l16 16"/>
    <path d="M20 16h14l-2 21H22z"/>
    <path d="M20.5 21.5h13" />`,
  drink: `
    <path d="M17 8h30l-4 50H21z"/>
    <path d="M20.6 44h22.8" />
    <path class="fill" d="M20.6 44h22.8L43 58H21z"/>
    <path d="M52 14v14M47 23l5 5 5-5"/>`,
  win: `
    <circle cx="32" cy="37" r="20"/>
    <path d="M27 6h10M32 6v11M32 37l9-9M48 19l4-4"/>`,
};

function icon(name: keyof typeof ICONS) {
  return `<svg class="rule-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor"
    stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function rulesHTML(capSec: number): string {
  return `
    <section class="rules" aria-labelledby="rulesTitle">
      <h2 id="rulesTitle">The goal is simple</h2>
      <ol class="rule-steps">
        <li class="rule pink">
          ${icon("drop")}
          <p>Get dropped somewhere in the world</p>
        </li>
        <li class="rule amber">
          ${icon("find")}
          <p>Find somewhere you can order a pint</p>
        </li>
        <li class="rule mint">
          ${icon("drink")}
          <p>Finish your drink</p>

        </li>
        <li class="rule gold">
          ${icon("win")}
          <p>Fastest time wins</p>
        </li>
      </ol>
      <p class="rules-small">
        Any bar counts · out of time at <strong id="rulesCap">${formatTime(capSec * 1000, false)}</strong> = DNF
      </p>
    </section>`;
}
