import { CITIES, type City } from "./cities";
import type { GameState } from "./state";

/**
 * Tonight's beer tour: one round per beer, everyone dropped in the same city
 * so you can crack them open together.
 */
export const BEER_TOUR: { city: string; beer: string }[] = [
  { city: "London", beer: "your London beer" },
  { city: "Chicago", beer: "your American beer" },
  { city: "Munich", beer: "your Munich beer" },
  { city: "Brussels", beer: "your Belgian beer" },
  { city: "Melbourne", beer: "your Melbourne beer" },
  { city: "Dublin", beer: "the Guinness" },
  { city: "Brooklyn", beer: "your Brooklyn beer" },
  { city: "Tokyo", beer: "your Japanese beer" },
  { city: "Barcelona", beer: "your Spanish beer" },
  { city: "Leeds", beer: "your Leeds beer" },
  { city: "Newcastle", beer: "your Newcastle beer" },
  { city: "Edinburgh", beer: "your Scottish beer" },
];

/** This round's city on the beer tour, or undefined for a normal game. */
export function tourCity(s: GameState, round = s.round): City | undefined {
  const name = s.settings.tour?.[round - 1];
  return name ? CITIES.find((c) => c.city === name) : undefined;
}

/** What to open this round, e.g. "the Guinness", or "" for a normal game. */
export function tourBeer(s: GameState, round = s.round): string {
  const city = tourCity(s, round);
  return BEER_TOUR.find((t) => t.city === city?.city)?.beer ?? "";
}
