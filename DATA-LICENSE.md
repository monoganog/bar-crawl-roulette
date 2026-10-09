# Data licences

## Bar locations: OpenStreetMap (ODbL)

The files in `src/data/bars/` are extracted from [OpenStreetMap](https://www.openstreetmap.org)
and are © OpenStreetMap contributors. They are a derivative database and are made available
under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

You're free to copy, share and adapt them, as long as you credit OpenStreetMap and share any
adapted version of the data under the same licence. See
<https://www.openstreetmap.org/copyright> for details. They're regenerated with
`npm run fetch-bars` (see `scripts/fetch-bars.ts`).

## Mini map tiles: OpenFreeMap

The mini map's streets are loaded at runtime from [OpenFreeMap](https://openfreemap.org)
(© OpenMapTiles, data © OpenStreetMap contributors). Nothing from it is stored in this repo.

## Street View: Google

Street View imagery is loaded live through the Google Maps JavaScript API under
[Google's terms](https://cloud.google.com/maps-platform/terms). Nothing from it is stored in this repo.
