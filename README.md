# 🍺 Bar Crawl Roulette

A drinking game for a group of friends sharing one laptop. Each player in turn gets dropped into Google Street View somewhere in a city, a short walk from the nearest pub: mostly UK towns and cities, with a few abroad. They have to find a bar on screen *and* finish their drink before the time cap runs out. Fastest wins the round; most rounds wins the night.

Everything runs in the browser: no backend.

## Setup

```bash
npm install
cp .env.example .env   # then paste your key into .env
npm run dev
```

Open http://localhost:5173.

### Getting a Google Maps API key

In the [Google Cloud Console](https://console.cloud.google.com):

1. **Create a project** and **link a billing account** to it. Google requires billing even when you stay within the free usage.
2. **APIs & Services → Library:** enable **Maps JavaScript API**. That's the only one needed; it includes Street View.
3. **APIs & Services → Credentials → Create credentials → API key.** Then edit the key:
   - **Application restrictions → Websites:** add `http://localhost:5173/*`, and your real domain when you publish.
   - **API restrictions → Restrict key:** tick only **Maps JavaScript API**.
4. Put it in `.env`:

   ```
   VITE_GOOGLE_MAPS_KEY=AIza...
   ```

   Restart `npm run dev` after editing `.env`.

The key is bundled into the page, which is normal for browser keys. The website and API restrictions are what stop anyone else from using it.

### Keeping it free

- **Only panoramas shown cost anything.** Each turn is billed as one "Dynamic Street View" load. Re-rolls reuse the same panorama and don't add a load. Finding locations uses `StreetViewService`, which is free.
- **Free allowance:** Google currently lists 5,000 Dynamic Street View loads free per month. Check the [pricing page](https://developers.google.com/maps/billing-and-pricing/pricing), since this changes. A game night is roughly players × rounds loads.
- **Set a budget alert:** in **Billing → Budgets & alerts**, create a budget for this project with a tiny amount and email alerts. A budget only alerts you; it doesn't stop usage.
- **Cap daily usage:** in **Maps JavaScript API → Quotas**, lower the per-day limits, e.g. "Map loads per day" to 150. Google bills Street View separately from map loads, so check that counter actually moves after a turn before relying on it as a hard cap.

### Cities and bar data

The cities are in `src/cities.ts`: 15 UK cities, 8 English-speaking cities abroad (Dublin, US, Australia, New Zealand), 5 European cities and 3 with a different script (Tokyo, Seoul, Athens). The list is deliberately short: fewer places with good data beats lots of places with patchy data.

Each city's bars live in `src/data/bars/<city>.json`: **every** named bar, pub and beer garden within 4 km of the centre, from [OpenStreetMap](https://www.openstreetmap.org) (© OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright)). `index.json` holds the counts. The files are committed, so you don't need to fetch anything to play, and each city's file is only downloaded when that city comes up. Cities with fewer than 60 known bars are left out automatically.

To fetch cities that don't have data yet, or after adding one to `src/cities.ts`:

```bash
npm run fetch-bars                    # cities not fetched yet
npm run fetch-bars -- York Leeds      # re-fetch just these
npm run fetch-bars -- --force         # re-fetch everything
```

This uses the free public Overpass API and needs no key. The public servers are often overloaded, so the script retries patiently and saves each city as it arrives.

### Checking coverage

With `npm run dev` running, open http://localhost:5173/check.html. For each city and round length, it tries 3 random gaps between bars and shows how many gave a valid drop, the walk/straight-line distance to the nearest bar, and how many panoramas were explored. These lookups are free. Drop any city that keeps scoring low from `src/cities.ts`.

## How to play

1. **Setup:** add the players, then set the time cap (default 5 min), the number of rounds (default 3) and the difficulty.
2. **Spin:** in round 1, the wheel picks who goes next (press Space again to skip the animation). The last player left doesn't need a spin. From round 2, players go in round 1's order, no wheel.
3. **Turn:** the clock starts once Street View loads. Drag to look around, and click the arrows or the road (or use the keyboard arrows) to move.
   - Click **BAR FOUND** when you spot a bar on screen.
   - Click **DRINK FINISHED** when your glass is empty.
   - Each button latches and records its time. Changed your mind ("that's not a bar")? Click it again to take it back, as long as the other one isn't pressed yet. The turn ends the moment both are pressed, and your time is the later of the two.
   - If you hit the time cap first, the turn is a **DNF**.
   - If the imagery is broken or you're stuck in a tunnel, **Bad spot, re-roll** gives you a new location and restarts the clock.
   - The **mini map** in the top-right corner keeps you in the middle and moves with you. It shows the surrounding streets (no names, water or landmarks), your trail and which way you're facing, north up, about 300 m across. Bars only appear on it once the turn is over.
4. **Results:** one page after each turn. On the left, a polaroid of exactly what you were looking at when you pressed BAR FOUND (the live Street View, framed, so you can still look around), captioned with the time, plus the nearest bar on our map to that spot as evidence. OpenStreetMap doesn't know every bar, so it's evidence, not a verdict. On the right, your route on a map with every bar you walked past named. Underneath: which city you were in, how far you walked, the bars you passed, your button times, and the nearest bar to where you started. **Any bar counts.**

### Winning

The fastest finisher in each round wins that round. **Most rounds won takes the night.** Ties go to the lowest total time across all rounds, with a DNF counting as the full time cap, then to the best single time. A round only counts once everyone has played it.

### End-of-night awards

The final screen deals **4 award cards**, face down, and turns them over one at a time, a second apart (`Space` or a tap reveals the next one early). They're drawn at random from every award someone qualified for that night, so each game gets a different mix:

🧭 Most Lost · 🐕 Bloodhound · 🚀 Speed Sipper · 💀 Out of Time · 🛋️ Couch Potato · 🔄 Wrong Way · 🗺️ Local Knowledge · 🎲 Re-roll Royalty · 🏃 Marathon · 🔔 Last Orders · 🥤 Drink First, Ask Later · 🪑 Window Shopper · 📈 Most Improved · 🤹 Multitasker · 🐢 Nursing It · 🎯 Beeline · 🪨 Steady Eddie · 🌍 Globetrotter · 🍀 Lucky Drop · 🧊 Ice Cold

They're worked out from each turn's data (times, metres walked versus the shortest route, steps, re-rolls, where you claimed a bar). An award only qualifies when someone actually earned it, and ties are shared. The 4 go to different people where possible. The draw is seeded from the night's results, so refreshing deals the same hand. If fewer than 4 qualify (a very short game), consolation awards fill the gaps. The rules live in `src/awards.ts`; change `AWARDS_SHOWN` to deal more or fewer.

The leaderboard sits beside the wheel / turn order and opens anywhere with `L`. It shows wins, total time, best time and DNFs, per-round results, and the fastest time of the night (a bonus, not how you win). Everything is saved in `localStorage`, so a page refresh won't lose the game. **New game** clears the results but keeps the player list.

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Spin the wheel / skip the spin |
| `Enter` | Start turn / continue |
| `L` | Toggle leaderboard |
| `Esc` | Close leaderboard |
| `` ` `` | Toggle the debug panel (`npm run dev` only) |

BAR FOUND and DRINK FINISHED have no keyboard shortcuts on purpose: they're click-only.

### Debug panel

During a turn, press `` ` `` (backtick) to toggle a debug panel. It shows your live walk to the nearest known bar, which arrow is the next step on that route, the nearest bar in a straight line and its direction, how far you've walked, and the panorama ID. It's only available under `npm run dev`; the published build leaves it out, since it shows where the nearest bar is. With the panel open, the mini map also shows every known bar. Each turn result in `localStorage` also stores `pathM` and `endPathM` (walking distance at the start and end), `barDistanceM` and `endBarDistanceM` (straight line), `claimNearestBarM` (from where BAR FOUND was pressed), `walkedM`, `steps` and `rerolls` for tuning.

## Difficulty

Each city in `src/cities.ts` is tagged by how readable its street signs are: `english`, `latin` (another language, but you can still spot "Bar" or "Pub") or `other` (a different script, like Tokyo or Athens). The difficulty chosen at setup decides which of those each round can use, and scales the walking distance:

| Difficulty | Cities | Walk (R1 → R2 → R3) |
| --- | --- | --- |
| 🧳 Tourist | English-speaking all game | ×0.75: 75 → 113 → 150 m |
| 🍺 Pub crawler | R1–2 English, R3 + Latin alphabet, R4+ anywhere | ×1: 100 → 150 → 200 m |
| 🌍 Lost abroad | Anywhere from round 1 | ×1.5: 150 → 225 → 300 m |

The base walk is 100 m plus 50 m a round, capped at 300 m before the multiplier. If there's no bar data for any allowed city, it falls back to any playable city. All of this lives in `src/difficulty.ts`.

## How locations are picked

The goal is to find **a** bar, any bar, so a drop's difficulty is the walk to the **nearest** bar in any direction.

1. Pick a random city that has bar data and suits the round's difficulty.
2. Find **gaps** between its bars: random points whose nearest known bar is a bit under the round's walking distance away in a straight line. This is pure maths on the bar list, with no lookups.
3. Explore the Street View network outward from a gap (the arrows you click), just far enough to cover the round's walk.
4. On that explored network, work out the **walk from every spot to the nearest of all the city's bars**: a multi-source shortest-path search, with no extra lookups.
5. Drop the player on a random spot near the gap whose nearest-bar walk is the round's target (see [Difficulty](#difficulty)), up to 25% longer. Every bar must also be at least 40% of the walk away in a straight line, so none is sitting in plain sight. The player faces a random direction.
6. Three gaps are tried at once; after 6 per city, switch city.

All of these lookups use `StreetViewService`, which is free; only the panorama the player sees is billed.

## The mini map

The streets come from [OpenFreeMap](https://openfreemap.org): free OpenStreetMap vector tiles, no key or account, no usage limits. They're drawn with [MapLibre](https://maplibre.org) in a custom style with only roads and paths: no labels, water, buildings or landmarks, so it shows the shape of the streets without giving the city away. MapLibre is loaded the first time a turn starts, so it doesn't slow down the first screen. If the tiles can't load (offline, or the service is down), the map falls back to drawing the Street View network explored when the drop was planned. Your trail, start point and view cone are drawn on top; bars only once the turn is over, or with the debug panel open.

Because distances are walked along the street network, you can't land on a boat or across a river from your nearest bar, and the distance is the real walk, not as the crow flies. The tolerances are constants at the top of `src/streetview.ts`.

Each search takes a few seconds, so it starts early: during the wheel spin in round 1, and as soon as the "Up next" screen appears after that.

The address box, street-name labels and compass are hidden. Google's logo and terms links stay, as their terms require.

## Build

```bash
npm run build     # type-check + production build into dist/
npm run preview
```

### Version

The header shows which build is running, faintly under the logo: `v0.1.0 · build 6 · a1b2c3d`. That's the `version` in `package.json` (bump it for milestones), the number of commits (goes up with every deploy), and the commit the site was built from. Under `npm run dev` it says `dev` instead of a build number.

### Icon and link preview

The site icon is `public/favicon.svg` (a roulette wheel with a pint). The PNG sizes next to it (`favicon-32.png`, `icon-192.png`, `icon-512.png`, and a square-cornered `apple-touch-icon.png`) were rendered from it with headless Chrome and resized with `sips`. The share preview used by Messenger, WhatsApp and so on is `public/og-image.png` (1200×630), rendered from `scripts/brand/og-image.html`:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot=public/og-image.png "file://$PWD/scripts/brand/og-image.html"
```

The title, description and image tags are in `index.html`. Chat apps cache previews; after changing them, re-scrape the URL in Facebook's [Sharing Debugger](https://developers.facebook.com/tools/debug/) to refresh Messenger.

## Publishing

It's a static site, so any static host works. This repo includes a GitHub Pages workflow (`.github/workflows/deploy.yml`) that builds and deploys on every push to `main`.

**Before it goes public, protect the bill.** The API key has to be in the page, so anyone can read it; the website restriction is the main guard, and it can be worked around. Each turn is one billed Street View load once the free 5,000 a month are used up.

1. In Google Cloud, add the live domain to the key's **website restrictions** (keep `http://localhost:5173/*` for development).
2. Put a hard limit on spending: either confirm the **Map loads per day** quota counts Street View (play a turn and check the counter moves) and keep it low, or set up a budget that **automatically disables billing** when it's reached. A plain budget alert only emails you.

**GitHub Pages setup:**

1. Push to a GitHub repo.
2. **Settings → Secrets and variables → Actions → New repository secret:** `VITE_GOOGLE_MAPS_KEY` with your key.
3. **Settings → Pages → Source:** GitHub Actions.
4. For a custom domain, add a file `public/CNAME` containing just the domain (e.g. `barcrawlroulette.example`), set the domain under **Settings → Pages**, and point your DNS at GitHub as their docs describe. The site is built for the root of a domain; serving it from `username.github.io/repo-name/` instead would need `base` set in a Vite config.

**Small print:** the setup screen carries an 18+ / drink-responsibly note and the privacy and data credits. Bar data is © OpenStreetMap contributors under the ODbL; see [DATA-LICENSE.md](DATA-LICENSE.md). Check Google Maps Platform's terms and acceptable use policy yourself before launch; nothing here is legal advice.
