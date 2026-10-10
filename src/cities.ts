/**
 * How hard the street signs are to read: English, another language in the
 * Latin alphabet (you can still spot "Bar" or "Pub"), or another script.
 */
export type Script = "english" | "latin" | "other";

export interface City {
  city: string;
  country: string;
  /** Roughly the centre of the bar district; bars are fetched within 4 km. */
  lat: number;
  lng: number;
  script: Script;
}

// Fewer places, better data: cities with dense OpenStreetMap pub/bar mapping
// and full Street View coverage. Mostly UK, a handful of English-speaking
// cities abroad, then some harder ones. Run `npm run fetch-bars` after
// adding one; cities with too few known bars are left out automatically.
export const CITIES: City[] = [
  // UK
  { city: "London", country: "United Kingdom", lat: 51.5136, lng: -0.1265, script: "english" },
  { city: "Manchester", country: "United Kingdom", lat: 53.4808, lng: -2.2426, script: "english" },
  { city: "Birmingham", country: "United Kingdom", lat: 52.4797, lng: -1.9026, script: "english" },
  { city: "Liverpool", country: "United Kingdom", lat: 53.4048, lng: -2.9806, script: "english" },
  { city: "Leeds", country: "United Kingdom", lat: 53.7976, lng: -1.5444, script: "english" },
  { city: "Newcastle", country: "United Kingdom", lat: 54.9714, lng: -1.6138, script: "english" },
  { city: "Bristol", country: "United Kingdom", lat: 51.4534, lng: -2.5927, script: "english" },
  { city: "Brighton", country: "United Kingdom", lat: 50.8246, lng: -0.1377, script: "english" },
  { city: "Nottingham", country: "United Kingdom", lat: 52.9536, lng: -1.1505, script: "english" },
  { city: "Sheffield", country: "United Kingdom", lat: 53.3801, lng: -1.4704, script: "english" },
  { city: "Edinburgh", country: "United Kingdom", lat: 55.9496, lng: -3.1910, script: "english" },
  { city: "Glasgow", country: "United Kingdom", lat: 55.8609, lng: -4.2514, script: "english" },
  { city: "Cardiff", country: "United Kingdom", lat: 51.4801, lng: -3.1786, script: "english" },
  { city: "Belfast", country: "United Kingdom", lat: 54.5973, lng: -5.9301, script: "english" },
  { city: "York", country: "United Kingdom", lat: 53.96, lng: -1.0873, script: "english" },
  // English-speaking, abroad
  { city: "Dublin", country: "Ireland", lat: 53.3454, lng: -6.2644, script: "english" },
  { city: "New York", country: "United States", lat: 40.7265, lng: -73.9875, script: "english" },
  { city: "Brooklyn", country: "United States", lat: 40.7163, lng: -73.9579, script: "english" },
  { city: "Chicago", country: "United States", lat: 41.8958, lng: -87.6346, script: "english" },
  { city: "San Francisco", country: "United States", lat: 37.7793, lng: -122.4192, script: "english" },
  { city: "Sydney", country: "Australia", lat: -33.8732, lng: 151.2069, script: "english" },
  { city: "Melbourne", country: "Australia", lat: -37.8136, lng: 144.9631, script: "english" },
  { city: "Auckland", country: "New Zealand", lat: -36.8509, lng: 174.7645, script: "english" },
  { city: "Wellington", country: "New Zealand", lat: -41.2889, lng: 174.7772, script: "english" },
  // Another language, Latin alphabet
  { city: "Amsterdam", country: "Netherlands", lat: 52.3702, lng: 4.8952, script: "latin" },
  { city: "Berlin", country: "Germany", lat: 52.5235, lng: 13.4115, script: "latin" },
  { city: "Paris", country: "France", lat: 48.8606, lng: 2.3522, script: "latin" },
  { city: "Prague", country: "Czechia", lat: 50.0835, lng: 14.4241, script: "latin" },
  { city: "Munich", country: "Germany", lat: 48.1374, lng: 11.5755, script: "latin" },
  { city: "Brussels", country: "Belgium", lat: 50.8467, lng: 4.3525, script: "latin" },
  { city: "Barcelona", country: "Spain", lat: 41.3833, lng: 2.1777, script: "latin" },
  // Another script entirely
  { city: "Tokyo", country: "Japan", lat: 35.6938, lng: 139.7034, script: "other" },
  { city: "Seoul", country: "South Korea", lat: 37.5563, lng: 126.922, script: "other" },
  { city: "Athens", country: "Greece", lat: 37.9784, lng: 23.7276, script: "other" },
];

export function citySlug(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
