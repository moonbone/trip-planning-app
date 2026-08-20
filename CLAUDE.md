# Trip Planner — context for Claude Code

## What this is
A generic, KML-driven trip-planning app — no trip is hardcoded. Users upload a Google My
Maps KML export; the app derives a day-by-day place list from it, lets you select/reorder
stops per day, and calls a routing API to get real driving times. The map defaults to
centering on Norway on first load (arbitrary starting region), but nothing about the data
model or UI assumes a Norway trip specifically.

## Trip facts worth knowing
The user's own real trip currently loaded into the app is a Norway road trip, Aug 14–24
2026 (fly into Bergen, out of Ålesund) — useful context, not something baked into the app.
- Overnights: Thon Hotel Sandven (Norheimsund, Aug14→15) → Kinsarvik Camping
  (Aug15→18) → Hesla Gård Pensjonat, Gol (Aug18→20) → Hotel Alexandra, Loen (Aug20→24).
- Return flight WF459 departs Ålesund Aug24, 19:25, arrives Bergen.
- **Day 11+ gap — candidate plan found, not yet decided.** A near-identical reference
  itinerary ("Neta and Maor" family trip, tripplanner.co.il/single_ride_with_map/19724,
  same Norheimsund→Kinsarvik→Gol→Loen overnight pattern) lays out Loen→Ålesund→Bergen
  in detail: Aug24 drive Loen→Ålesund, with a stop for a Hebrew-language mushroom-
  foraging tour + Norwegian home-cooked meal with "Rachel" (Israeli guide living in
  Norway), then Aksla mountain viewpoint in Ålesund, then the WF459 evening flight to
  Bergen. 2 nights in Bergen at "Keyser Apartments 8" (Aug24→26), Day 12 full Bergen
  day (aquarium, Bryggen, Troll Museum, Fløyen, fish market), Day 13 (Aug26) flight
  home from Bergen Airport. This is a reference/inspiration itinerary, not a booked
  plan — no Bergen hotel or onward flight is actually booked for the user's trip yet.
- Day 7 (Gol → Loen) is the heaviest driving day (~6hr estimated) — flagged as worth
  double-checking, possibly involves a ferry.

## Architecture
- `index.html` — the whole frontend. Vanilla JS + Leaflet (OSM tiles, no key needed).
  Trip data comes from user-uploaded Google My Maps KML exports, parsed client-side
  (`parseKmlTrip`) — the server never sees them, and there is no server-side places
  endpoint anymore. **Multiple trips** are stored in `localStorage` under a three-key
  layout: `tripplan-trips` (index: trip names, active ids, per-trip variant lists and
  last-visit — the commit point, written last on add / first on delete),
  `tripplan-trip-src:<tripId>` (immutable raw KML; parsing must stay deterministic since
  variant blobs reference the derived place ids), and
  `tripplan-variant:<tripId>:<variantId>` (per-variant `{plans, dayMeta}` — each trip
  has 1+ named plan variants, duplicated/renamed/deleted from the route header;
  switching is via dropdowns). Uploading a KML **adds** a trip (byte-identical
  re-upload just switches to it). Legacy single-trip keys (`tripplan-kml` etc.) are
  migrated on first load. All trip structure is derived from the KML: one `<Folder>`
  per day; folder names carry the day number ("day N"/"יום N") and date; the folder's
  **last placemark** is that night's accommodation (marked `overnight`, pinned to
  route start/end). Places are deduped by name+coords across folders. A filter box
  above the master list (`placeFilter`, `#placeSearchInput`) narrows it by name —
  pinned start/end hotel rows for the active day stay visible regardless of the
  filter since they're structural context, not search results; cleared on trip
  switch. `activateCurrentTrip()` is the single trip-load path — parses the active
  trip's KML, loads its enrichment/comments/packing/variant, re-matches enrichment
  against the newly-loaded data, and renders. Both the page's initial startup and
  every trip switch call it (startup used to duplicate this logic inline and skip
  the enrichment/comments/packing load entirely, so a plain page reload silently
  dropped them until you switched trips away and back — fixed by making startup
  call the same function).
  Calls `PROXY_URL` (currently `/route`, relative — assumes same-origin hosting) for
  routing, falls back to public OSRM demo servers if the proxy fails. Below 860px width, the 3-column layout collapses to a
  single column switched via a bottom tab bar (Places / Route / Summary); Leaflet needs
  `map.invalidateSize()` after its container is unhidden, which `setMobileSection` calls.
  A header toggle switches the whole page between this planner view and the feature-request
  tickets view (`#ticketsView`).
  **Dark mode**: a 🌙/☀️ toggle button in the header. Three-state like the rest of the CSS
  custom-property setup — system preference by default (`@media (prefers-color-scheme:
  dark)`), an explicit choice (`localStorage['tripplan-theme']`, applied as `data-theme` on
  `<html>`) overrides it in either direction. The `data-theme` attribute is set by a tiny
  inline `<script>` at the very top of `<head>`, before the real `<style>` block, so there's
  no flash of the wrong theme on load; the main script only syncs the toggle button's icon
  and reacts to system-preference *changes* when no explicit choice is stored. Almost every
  color already routed through the existing `--bg`/`--panel`/`--ink`/`--accent*`/`--border*`
  custom properties (the `body.beta-env` purple override already proved that pattern), so
  the dark palette is mostly just new values for those under `:root[data-theme="dark"]` /
  the media query — including its own beta-purple variant, since beta always has
  `body.beta-env` set. Two roles needed care because a naive var-swap breaks them: (1)
  `--accent-light` flips from "pale wash" to "dark wash" so the `--accent-dark` text drawn
  on top of it (place-item.selected, status-processed, alloc-future) stays legible either
  way; (2) `.calc-btn`'s background was `--accent-dark` (a role that's a *bright* text color
  in dark mode, not a fillable button surface) — split out to always use `--accent` instead,
  which was deliberately kept close to its light-mode value since it doubles as a filled
  badge/button background (route-item .idx, status-done, beta-badge) *and* a border color in
  both themes. A couple of inputs/textareas (`.dialog-input`, `.comments-section textarea`,
  `.packing-add-row input`, `.fuel-settings input`) had no explicit `background`/`color` at
  all — invisible in light mode since the browser default (white-on-black) happened to match,
  but a stark white box in dark mode; now themed like every other input. Two more spots
  (`.tab .num`, `.route-item .idx`) used `var(--panel)` as an always-white badge text color,
  which would have gone dark-on-dark once `--panel` itself went dark — switched to a literal
  `#fff`, matching how every other filled badge/button already gets its white text. The
  printable itinerary's own popup-window `<style>` is untouched and stays light always — it's
  meant for printing/PDF, not for reading on screen in-theme.
  Beyond KML places: **custom places** (user-added via map
  click, variant-scoped, 'c'-prefixed string ids), **place info enrichment** (imported JSON
  matched to places by title/proximity, shown in a modal — trip-scoped), **comments**
  per place/day/trip (trip-scoped; local key `tripplan-comments:<id>`, per-comment
  POST/DELETE endpoints signed in), and a **packing checklist** (🎒 button next to trip
  comments, its own modal): one flat `{id, text, checked}` list per trip, not per variant
  (what to pack doesn't depend on the route plan) — local key `tripplan-packing:<id>`,
  or a `packingList` field on the trip record signed in via `PUT /api/trips/:id/packing`
  (editor+; whole-array replace on every add/check/delete, same shallow read-modify-write
  pattern as `enrichment`, not per-item CRUD like comments — simpler since packing items
  don't need per-author tracking; server sanitizes/truncates each item's text and caps the
  list at 300 items). A **trip budget** (💰 button next to packing, its own modal) follows
  the exact same pattern one field over: a flat `{id, category, label, amount}` list per
  trip (not per variant), local key `tripplan-budget:<id>` or a `budgetItems` field via
  `PUT /api/trips/:id/budget` (editor+, whole-array replace, sanitized/capped at 300 items,
  amount clamped to `[0, 1e8]`, empty-label items dropped). Displays each amount with the
  fuel settings' currency label rather than a second currency input, since that's already
  "the currency for this trip's costs" in spirit. The budget modal also shows a computed
  whole-trip fuel estimate (`estimatedFuelCost`, reusing the same `dayDriveEstimate()`-
  across-`DAYS` sum the trip overview panel's driving total already computes) with a
  one-click "add to budget" action (`addOrUpdateFuelBudgetItem`) that writes it as a
  `Transport`-category line item labeled `"Estimated fuel (whole trip)"` — so a filled-in
  fuel settings row doesn't leave the budget total silently missing its largest line.
  Detects that item by that exact label to offer "update the logged estimate" instead of
  adding a duplicate whenever the figure has since changed (a different day's route was
  calculated, or the fuel settings themselves were edited), and reports "already logged"
  once the two match. Purely a convenience — the line item is a normal, editable, removable
  budget row after it's added, not a synced/computed field.
  The budget modal also has an optional "Show total in" currency-code input: a live conversion
  of the running total via `api.frankfurter.dev` (free, keyless, CORS-enabled — same trust
  model as Nominatim/Open-Meteo/Overpass, all already called client-side elsewhere in this
  app), cached in memory per `base:target` pair for the session. Requires both the fuel
  settings' currency and the typed target to look like a 3-letter ISO 4217 code
  (`ISO_CURRENCY_RE`) — the fuel currency field is free text with no such validation
  elsewhere in the app, so an unrecognized one (e.g. "kr") shows a guidance message instead
  of a failed request. A failed lookup (unknown code, network error) shows "Could not fetch
  exchange rate" rather than breaking the total, which is always still shown correctly in
  the trip's own currency regardless. The chosen target currency is a personal display
  preference like the fuel settings themselves — one plain, non-trip-scoped
  `tripplan-budget-convert-currency` localStorage key, restored the next time the modal opens.
  A "Split between" row right below it (same `.budget-convert-row` styling, same
  restored-on-modal-open/plain-non-trip-scoped-key pattern — `tripplan-budget-travelers`,
  `loadBudgetTravelers`/`saveBudgetTravelers`) divides the running total by a traveler count
  and shows "≈ N &lt;currency&gt; per person" (`renderBudgetSplit`) — how many people are on a
  given trip doesn't vary by trip data any more than which currency you want the total shown
  in does, so this stays a display preference rather than a new synced trip field. Hidden
  whenever the count is 1 (the default/empty-input state) or the budget itself is empty, same
  as the currency conversion line hides when nothing's been chosen or converted.
  A "⬇️ CSV" button in the budget modal's header (`exportBudgetCsv`/`buildBudgetCsv`) downloads
  every logged item (category, label, amount, the fuel-settings currency) as a spreadsheet-ready
  CSV file — RFC 4180-ish quoting (`csvField`) for labels that contain a comma or quote, since
  those are free text. Same client-side blob-download pattern as GPX/ICS/backup export.
  Every route-item row (stops and pinned hotels alike) has a small "🔎" button
  (`nearbyLink`/`openNearbyModal`) that looks up nearby fuel stations, restaurants, cafes,
  fast food, parking, restrooms, supermarkets, pharmacies, hospitals, and EV charging
  stations — the amenity types actually relevant mid-road-trip, not a general POI browser —
  within 1.5km of that stop, via Overpass
  (`overpass-api.de`, OSM's public query API: keyless, `Access-Control-Allow-Origin: *`,
  same no-auth client-side-callable trust model as Nominatim/Open-Meteo already used
  elsewhere in this app). Results are sorted nearest-first, capped at 15, and unnamed nodes
  (a large share of OSM parking/toilets data) are filtered out since there'd be nothing to
  show or save. Each result has a "+ Add" button that adds it as a custom place to the
  active day using its exact OSM coordinates — same `customPlaces.push` + `plans[day].push`
  pattern every other "add a place" path in this app already uses. A failed/slow Overpass
  call (the free public instance is noticeably less reliable than Nominatim — occasional
  406/504s under load, confirmed against the live API while building this) shows an inline
  error in the modal rather than breaking anything else on the page.
  An AI "Summarize day" button (signed-in UI, server-gated
  to one account) posts a text rendition of the day to `/api/ai/summarize-day`, which calls
  Claude on Bedrock via `aws/ai.mjs` (SDK bundled in Lambda runtime only — locally it 502s).
  A "📍 From Maps" button lets you paste a Google Maps link (or raw `lat, lon`) to add a
  custom place without clicking the map: `parseGoogleMapsCoords` pulls coordinates out of
  long-form URLs client-side (`!3d/!4d` pin, `@lat,lon` view center, or `q=`/`ll=` params).
  Newer share links reference a place by internal id instead (no coordinates anywhere in the
  URL) — those fall back to geocoding the place name/address via OpenStreetMap's free
  Nominatim API. Shortened links (`maps.app.goo.gl`, `goo.gl`, `g.co` — what phones produce
  from the Share button) carry neither, so those go through `POST /resolve-maps-link` first
  to follow the redirect server-side (a browser can't read a cross-origin redirect's
  destination). That same server call also scrapes the place's Open Graph photo/title
  (`aws/handler.mjs` fetches with a link-preview-crawler User-Agent — Google only serves
  real per-place OG data, not a generic placeholder, to that) and stores the photo directly
  on the custom place's `image` field, shown in the place-info modal alongside enrichment.
  A "🔍 Search" button next to it adds a place by typed name/address instead of a map click
  or a Maps link — `searchPlaceByName` geocodes via `geocodeCandidates` (a Nominatim call
  requesting up to 5 matches with `extratags=1`, a sibling of the single-result
  `geocodeAddress` the Maps-link import's title fallback still uses unchanged, since that
  path already has an exact redirect URL behind it and doesn't need a picker). Results open
  a confirm modal (`openSearchResultsModal`, ticket `msw6fddzu25mte`) instead of saving the
  top match straight off: a clickable list when Nominatim returns more than one candidate,
  and for whichever one is selected, a small non-interactive-zoom Leaflet preview map
  (`#searchResultMap`, its own map instance, lazily created and reused — `ensureSearchResultMap`),
  the full address, an editable name field pre-filled from the candidate, and a best-effort
  photo. The photo comes from Wikipedia's public, keyless REST summary API
  (`fetchCandidatePhoto`, same no-auth client-side-callable trust model as Nominatim/
  Open-Meteo) when Nominatim's `extratags` carries an OSM `wikipedia` tag for that place —
  silently omitted otherwise, never blocking the confirm step. Switching candidates while a
  photo fetch is in flight discards the stale response (`searchSelectedIdx !== i` guard),
  same request-token pattern the weather panel uses. `geocodeCandidates` also biases results
  toward the trip's current area (ticket `mswuwmi5itojje`: a generic query like a supermarket
  chain name used to match branches worldwide with no locality bias) — `searchAnchorPoint()`
  resolves to the active day's overnight hotel (falling back to that day's wake hotel, then
  its last real stop, then any place in the trip) and `nominatimSearchBiased` first asks
  Nominatim for matches inside a `viewbox`/`bounded=1` box around it (`viewboxAround`, ~1.5°
  of latitude widened in longitude by `1/cos(lat)` so the box stays roughly square in real
  distance this far north, where longitude degrees compress a lot) before falling back to a
  plain unbounded search if nothing turns up nearby — so a place that's genuinely outside
  today's area still resolves instead of reporting "no match". `geocodeAddress` (the
  Maps-link import's title fallback) is deliberately left unbiased/unchanged, per the
  reasoning two paragraphs up.
  Each day's route-item row also has small ▲/▼ buttons (`moveStopInDay`) alongside the
  existing drag-and-drop reordering — real `<button>` elements, so unlike a `draggable` row
  they're reachable by Tab and operable with Enter/Space, for anyone on a keyboard or a
  touch device where drag-reordering is fiddly. Always recomputes `dayStops(activeDay)`
  fresh at click time and swaps the adjacent pair in that filtered (hotel-free) array, then
  writes the whole thing back to `plans[day]` — the same "replace with just the reordered
  editable stops" contract `commitDragOrder` already uses, so the two reordering paths can't
  drift out of sync with each other.
  Each day's tab (and the route panel's day label, and the printable itinerary) shows the
  day's date via `formatDayDate` (e.g. "Sun, Aug 16") next to the day number — `DAY_DATES` was
  already parsed from the KML, it just wasn't surfaced anywhere but one export string before.
  A "📅 Export calendar" button (next to GPX export) downloads a whole-trip `.ics` file — one
  VEVENT per day, spanning that day's planned start time to its computed end time (or a rough
  4-hour default when the day hasn't been routed), reusing the same `buildDayItinerary()` data
  the printable itinerary and GPX export already fetch. Floating local time (no TZID/`Z`) is
  used deliberately instead of a full `VTIMEZONE` block — simplest thing that reads correctly
  on a phone calendar while the traveler's device is set to the trip's own timezone. A day's
  *last* stop (not just any stop flagged `overnight`) is used as "tonight's" destination, since
  the previous night's hotel is also flagged `overnight` where it appears pinned as that day's
  *first* stop.
  A fuel cost estimate (⛽ row above "Drive summary") takes a consumption (L/100km),
  price/liter, and currency label the user types in — one plain `tripplan-fuel-settings`
  localStorage key, deliberately *not* trip-scoped or synced (it's the car, not the trip)
  — and appends "≈ N <currency> fuel" to the active day's drive stats and to both the
  per-day and whole-trip totals in the printable itinerary (`fuelCostText`, reused by both
  call sites). Omitted entirely whenever consumption or price is unset/zero. A small
  `L/100km`/`mpg` toggle above the fuel-settings row (`#fuelUnitToggle`, styled and behaving
  like the km/mi distance toggle, but a separate, independent setting — a US-mpg driver
  isn't necessarily also reading distances in miles) switches which unit the consumption/
  price fields mean; the `unit` field lives on the same `tripplan-fuel-settings` object
  (normalized to `'l100km'` by `loadFuelSettings()` for settings saved before this toggle
  existed) rather than as its own key, since it's meaningless without the two numbers next
  to it. Switching units deliberately doesn't clear or convert the typed numbers — they're
  just reinterpreted, so the user re-enters them for the new unit; placeholders
  (`syncFuelUnitToggle`) change to `mpg (US)` / `price/gal` to make that obvious. The actual
  cost math is centralized in one `fuelCost(distanceKm, settings)` helper (US gallon: miles
  ÷ mpg × price/gal) shared by `fuelCostText` (every per-leg/day/trip display string) and
  `estimatedFuelCost` (the whole-trip budget-tracker suggestion), so the two unit branches
  can't drift out of sync between the two call sites.
  A km/mi distance-unit toggle (small `km`/`mi` button pair next to the "Trip overview"
  header) is the same kind of personal-not-trip setting as fuel settings and dark mode —
  one plain `tripplan-distance-unit` localStorage key, applying across every trip.
  Deliberately a *display-only* layer: every internal calculation (routing, fuel cost,
  haversine distances, near-duplicate detection, the map's route-arrow spacing) stays in
  km always: `formatDistanceKm(km, decimals?)` is the one place a km number ever gets
  rounded and unit-suffixed for display, called from the drive summary, trip overview,
  route-list leg info, the optimize-order confirm dialog, the printable itinerary, the ICS
  export description, and the copy-day-plan/AI-summary text. Two things deliberately don't
  go through it: the near-duplicate-place badge and sub-1km entries in the nearby-amenities
  lookup stay in meters regardless of the toggle (nobody thinks in fractional miles at
  that scale), and the fuel-consumption field stays L/100km always — an mpg-equivalent
  input is a genuinely different unit system, not just a display conversion, and a bigger
  scope than this toggle; left for a future session if it's wanted. `buildDayItinerary`'s
  `distanceKm`/`legKm` fields hold raw km numbers (not pre-rounded strings) specifically so
  every consumer can format them per the active unit at render time.
  A "🗺️ Export GPX" button (col-left, next to Print itinerary) downloads the whole trip
  as a single `.gpx` file for GPS devices/apps (Garmin, OsmAnd, Google Earth…):
  `buildTripGpx` emits a `<wpt>` per unique stop across every day (deduped like `PLACES`
  already is, overnight stops tagged `<sym>Lodging</sym>`) plus a `<trk>` per day when
  that day's route can be fetched — same sequential per-day fetch-with-fallback as the
  printable itinerary, so a day that can't be routed just loses its track line rather
  than failing the whole export.
  A "💾 Backup trip" / "📥 Restore backup" pair (col-left, next to Export GPX) round-trips
  everything about a trip through one JSON file: the KML source plus every plan variant
  (not just the active one), enrichment, comments, packing, and budget — the only way to
  get those back if local storage is cleared or an account is lost, since the KML file
  alone only regenerates the place list. `buildTripBackup` reads every variant's state
  (from live `plans`/`dayMeta`/`customPlaces` for the active one, `remoteVariantState` or
  the `tripplan-variant:` local key for the rest). `restoreTripBackup` always creates a
  **new** trip (never overwrites) by pushing the backup through the same endpoints the UI
  itself uses — `POST /api/trips`, a `PUT` on the auto-created first variant, `POST` per
  extra variant, `PUT` enrichment/packing/budget, one `POST` per comment (a single bad
  comment is skipped, not fatal to the rest) — then reloads from `loadRemoteIndex()` as
  the source of truth rather than hand-building the new trip's index entry; the local-mode
  path writes the same `tripplan-*` keys `addTrip`/`addVariant` already use. A malformed
  or non-JSON file fails with an inline message instead of throwing.
  A "📋 Copy day plan" button (col-right, always visible, no sign-in needed) copies the
  same plain-text day rendition used for the AI summary (`dayDescriptionText`) to the
  clipboard, falling back to a `prompt()` box if `navigator.clipboard` is blocked —
  handy for texting a day's stops to travel companions without a signal. A
  "🖨️ Print itinerary" button (col-left, trip-file panel) opens a new tab and builds a
  full, offline-printable day-by-day itinerary for every day in the trip: it fetches
  driving times per day independently of whatever's cached in `lastRoute` (via
  `buildDayItinerary`, reusing `fetchFromProxy`/`fetchFromOSRM`), and degrades
  gracefully per day if routing fails — still listing stops and stay durations, just
  without clock times, rather than failing the whole export. The tab is opened
  synchronously before the first `await` so popup blockers don't catch it; a "Building…"
  placeholder is shown and updated with per-day progress while routes are fetched
  sequentially (one day at a time, to stay well under OpenRouteService's free-tier rate
  limits). The printable page is a fully standalone HTML document (own inline
  `<style>`, print media query, a "Print / Save as PDF" button) — not styled via the
  main app's CSS. A "Trip overview" panel (col-right, above the per-day "Drive summary")
  shows whole-trip stats derived purely from already-loaded state (`renderTripOverview`,
  no routing calls) — day count, total places, overnight-stop count, and how many days
  still need at least one stop before a route can be calculated. A long-driving-day
  warning (⚠️ badge on the day tab, a line in the active day's drive summary, a count in
  the trip overview, and a note in the printable itinerary) fires at 270+ minutes of
  driving (`LONG_DRIVE_WARN_MIN`) — the common "keep it under ~4.5h" road-trip guidance,
  not anything Norway-specific. `dayDriveEstimate` uses the exact figure when a day
  matches the last-calculated `lastRoute`, otherwise a straight-line/50kmh fallback
  (`ESTIMATE_AVG_SPEED_KMH`) so every day tab can be flagged without routing all of them
  up front — deliberately a rough overestimate for winding/mountain roads, so it favors
  flagging over missing a genuinely long day. When the active day's date is today, the
  drive summary also shows a live "now" banner (`nowBanner`, called from `renderStats`,
  refreshed every 60s by a `setInterval`) — before departure, at a stop until its planned
  departure time, driving with an ETA, or done for the day — computed by walking the same
  start→drive→stay segments the timeline rows already render and comparing against the
  current wall clock. Only shown once a route is calculated for that day (arrival times
  come from `lastRoute`, same guard `renderStats` already uses). A weather forecast line (col-right, between
  "Trip overview" and "Drive summary") shows the active day's forecast — high/low temp,
  precipitation, sunrise/sunset, a condition icon — for whichever place is first in that day's route
  (`renderWeather`, called from `renderAll`). Calls Open-Meteo directly from the browser
  (`api.open-meteo.com`, no key, CORS-enabled for client-side use — same trust model as
  the Nominatim geocoding already called client-side elsewhere in this app), so it needs
  no server env var and works whether signed in or not. Its forecast horizon is ~16 days,
  so days already past or too far out just render nothing rather than a stale guess; a
  request-token guard (`weatherRequestToken`) discards a slow response that resolves after
  the user has already switched to a different day. Results are cached in memory per
  `lat,lon,date` for the session (`weatherCache`) — switching back to an already-fetched
  day doesn't re-hit the API.
  A whole-trip weather strip (`renderTripWeatherStrip`, its own `#weatherStrip` row between
  "Trip overview" and the single-day weather line) shows one compact chip per day within
  Open-Meteo's forecast horizon — icon plus high/low — so a rainy day (or a day already
  flagged long-driving or ferry) is visible before you're on the road, not just checked one
  day at a time. Reuses `fetchWeather`'s exact same call/cache as the single-day panel (a
  day fetched here isn't re-fetched when you switch to it, and vice versa), fetched
  sequentially day-by-day rather than all at once — a keyless public API is worth being
  gentle with. Each day's reference point is `getRouteIds(day)[0]`, i.e. that day's
  *starting* location (the previous night's hotel) — the same convention the single-day
  panel already uses, so e.g. day 2's forecast reflects where day 2 begins that morning
  (day 1's hotel), not day 2's own destination. A day whose forecast fetch fails is
  silently omitted from the strip rather than shown broken; the active day's chip is
  highlighted. Guarded by its own request token (`weatherStripToken`), same pattern as
  `weatherRequestToken`, so a trip/day switch mid-fetch discards the stale in-flight result.
  A "🔀 Optimize order" button (route header, next to "Reset day") reorders a day's editable
  stops to shorten the route between the pinned wake/sleep hotel(s) — nearest-neighbor
  construction plus 2-opt refinement (`optimizeDayOrder`) over straight-line (`haversineKm`)
  distance, entirely client-side: no routing-API calls, since scoring every candidate
  ordering against OpenRouteService/OSRM would mean one request per candidate. Deliberately
  a heuristic starting point, not a claim of true optimality — the confirm dialog says so
  explicitly and names the before/after straight-line distance, and nudges the user to
  recalculate driving times afterward for the real figures. Only ever reorders the stops
  `dayStops()` returns (the hotel anchors are never elements of the array 2-opt operates
  on, so they can't move); on a loop day (staying the same hotel two nights, `isLoopDay`)
  both ends anchor to the same place. A no-op day (already-optimal order, or fewer than two
  stops to reorder) shows an explanatory alert instead of a confirm dialog.
  Removing a stop from a day (the route list's × button, or unchecking a place in the master
  list) shows a brief "Removed X · Undo" toast (`showUndoToast`, bottom-center, auto-hides
  after 6s) instead of asking for confirmation up front — those two are single-click, easy
  to fire by accident, and previously the only way back was re-finding the place in the
  master list. The permanent "delete this custom place from the trip" action already has its
  own confirm dialog, so it doesn't also get a toast. A second removal before undoing the
  first replaces the toast rather than stacking — only the most recent removal is undoable.
  The "Trip overview" panel's stats now include a whole-trip driving total (time + km,
  summed via `dayDriveEstimate`, which already exists for the per-day long-drive badge) —
  exact for any day matching `lastRoute`, straight-line-estimated otherwise, with a "≈" prefix
  and an "N/M days calculated exactly" note whenever at least one day is still an estimate.
  `dayDriveEstimate` itself now also returns `.km` (previously only `.min`/`.exact`) so this
  reuses the same routed-vs-estimated branch the long-drive badge already relies on rather than
  recomputing it. `calculateRoute()` now calls `renderTripOverview()` on success (it previously
  only refreshed the route list and active day's stats) so this total updates the moment a day
  is calculated, not just on the next full re-render (day/trip switch).
  A "📑 Duplicate trip" button (trip-file panel, next to backup/restore) makes a full copy of
  the active trip — every plan variant, custom place, comment, packing item, and budget line —
  to experiment on (try a different stop order, a what-if extra day) without risking the
  original. `duplicateTrip()` doesn't reimplement any of that: it calls the existing
  `buildTripBackup()`, wraps the result as an in-memory `File` (a `Blob` with a name, same
  shape `restoreTripBackup` already expects from a picked file), and hands it to
  `restoreTripBackup` exactly as if it had come from "📥 Restore backup" — same validation,
  same "always creates a new trip, never overwrites" behavior, same local/remote dual-driver
  path. The copy is named "<original> (copy)" and, since `restoreTripBackup` already switches
  to whatever it just created, duplicating lands you directly on the new copy.
- `aws/handler.mjs` — Lambda handler. Serves `index.html` at `GET /`, proxies
  `POST /route` to OpenRouteService using `process.env.ORS_API_KEY`, resolves shortened
  Google Maps links via `POST /resolve-maps-link` (host-allowlisted to Google's own
  shorteners, so it can only ever follow a Google-issued redirect), and handles
  `GET /tickets` + `POST /tickets` for feature requests. One function, one Function URL,
  no API Gateway.
- `aws/validate.mjs` — sanitizing validation for ticket fields (subject/description):
  any printable characters accepted, control chars stripped, length limits enforced.
  XSS is handled at render time (`escapeHtml` in index.html on every ticket field) and
  storage is DynamoDB/JSON (no SQL), so there's nothing to whitelist. This is the real
  gate; `index.html` mirrors the required/length checks client-side for instant feedback
  only, never trust that alone.
- Tickets live in `aws/store.mjs` alongside users/trips (DynamoDB `trip-planner-app-tickets`
  on Lambda, `data/tickets.json` locally). Submitting requires a signed-in session — the
  submitter email comes from the session cookie, never the request body, and is stripped
  from all public responses. The old `aws/tickets-db.mjs` (node:sqlite) is gone.
- `aws/sw.js` — service worker for offline app-shell + map-tile caching, registered from
  `index.html` (`navigator.serviceWorker.register('/sw.js')`, fire-and-forget). Network-first
  for the shell (this page plus Leaflet's CDN CSS/JS) so an online visit always runs the
  live app — same reasoning as `index.html`'s `Cache-Control: no-store` below, which the
  service worker deliberately doesn't undermine; its cache is only a fallback for when
  there's genuinely no network, which matters given how much of this app's own feature set
  (printable itinerary, GPX export, this) exists because Norwegian-fjord-style road trips
  regularly have no signal. Cache-first for OSM tile requests (`{s}.tile.openstreetmap.org`)
  so map areas already viewed while online stay visible offline — the actual point of this
  feature. `aws/manifest.webmanifest` + `aws/icon.svg` (a plain teal pin, first icon this
  app has ever had) make it installable ("Add to Home Screen"). All three live directly in
  `aws/` (unlike `index.html`, there's no root-level copy to sync) and are served by
  `aws/handler.mjs` at `/sw.js`, `/manifest.webmanifest`, `/icon.svg` — see `deploy.sh` for
  the zip step. Bump the cache-name constants in `sw.js` if the caching strategy itself
  ever needs old cached entries invalidated.
- `dev-server.mjs` — runs `aws/handler.mjs` locally over plain HTTP (`node --env-file=.env
  dev-server.mjs`), so the real proxy and tickets routes can be tested before deploying.
  Copies root `index.html` into `aws/index.html` at startup (mirroring what `deploy.sh`
  does before zipping) — **must be restarted** after editing `index.html` or any `aws/*.mjs`
  file, since it reads them into memory once at startup.
- `aws/deploy.sh` — idempotent: creates the IAM role + Lambda + Function URL on first
  run, updates code/config on subsequent runs. Requires `ORS_API_KEY` env var set before
  running; never put the key in a file. `FUNCTION_NAME`/`ROLE_NAME` and each DynamoDB
  table name (`USERS_TABLE`, `TRIPS_TABLE`, `VARIANTS_TABLE`, `SHARES_TABLE`,
  `TICKETS_TABLE`) are all env-overridable — that's what lets the beta stack (below)
  reuse this same script against a different function + its own tables.
- `aws/iam-policy.json` — scoped-down policy for whoever deploys (not admin creds).
  DynamoDB/CloudFront/Logs actions are wildcarded to the `trip-planner-app*` prefix, so
  a new same-prefix stack (beta) is covered automatically; only Lambda actions are
  scoped to exact function-name ARNs and need a new line added per Lambda function.
- `.github/workflows/deploy.yml` — same deploy, triggered on push to `master`, secrets
  pulled from GitHub Actions repo secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`, `ORS_API_KEY`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`,
  `ADMIN_TOKEN`, `BEDROCK_MODEL_ID`).
- `.github/workflows/deploy-beta.yml` — same idea, triggered on push to `beta`, deploys
  a second, fully parallel stack: Lambda `trip-planner-app-beta`, its own Function URL,
  its own DynamoDB tables (`trip-planner-app-beta-*`), sharing mainline's IAM role and
  every other secret (session/admin/AI config is intentionally shared — only the
  function name, table names, and `SYNC_SOURCE_PREFIX` differ). Exists so feature work
  can be pushed to `beta` and deployed for real testing without ever touching the
  master pipeline or production data — see "Beta deployment" below.
- `worker/` — an earlier, parallel deploy path using Cloudflare Workers instead of
  Lambda. Kept for reference; not the primary path anymore. If both exist, AWS is current.

## Beta deployment
A second, fully parallel deployment for experimenting without risk to production.
Workflow: branch off `master` onto `beta` (or rebase/merge `master` into an existing
`beta`), push — `deploy-beta.yml` deploys it independently. Master's pipeline never
touches beta's resources or vice versa; the only thing intentionally shared is
config (secrets) and the IAM role, not data.
- **Data isolation**: beta has its own DynamoDB tables, empty on first deploy. A
  "🔄 Sync from mainline" button in the backoffice (only rendered when
  `GET /auth/config` reports `syncAvailable: true`, i.e. only on beta — gated by the
  `SYNC_SOURCE_PREFIX` env var deploy-beta.yml sets and mainline never does) calls
  `POST /api/admin/sync-from-mainline` (admin-only, `aws/handler.mjs` →
  `syncAllFromMainline` in `aws/store.mjs`). It's a one-way mirror: Scans every
  mainline table and every beta table, deletes whatever's beta-only, and writes a raw
  copy of every mainline item — so beta ends up an exact copy of production, not a
  merge. Items are copied as raw DynamoDB attribute maps, bypassing the typed
  encode/decode helpers, since source and destination share the same schema.
- **One-time manual setup this depends on** (none of it is scriptable with the
  deployer's current AWS permissions or from outside the AWS/Google consoles):
  1. Re-apply the updated `aws/iam-policy.json` to the `norway-route-app-deployer`
     IAM user (adds the `trip-planner-app-beta` Lambda ARN — DynamoDB/CloudFront/Logs
     already cover it via existing wildcards). Whoever has IAM-admin access needs to
     do this; the deployer can't grant itself permissions.
  2. Create a CloudFront distribution in front of beta's Function URL, same as
     mainline's (`docs/auth-design.md`) — this is manual for mainline too, deploy.sh
     doesn't automate it.
  3. Add that CloudFront domain to the Google Cloud OAuth client's authorized
     JavaScript origins, alongside mainline's. Until this is done, Google Sign-In (and
     therefore the backoffice, sync button, and sharing) won't work on beta — the
     signed-out KML planner/routing/Maps-import features work regardless.

## Key decisions already made (don't relitigate without reason)
- Routing key must never be client-side or in git — proxy pattern was chosen
  specifically because static hosting (GitHub Pages alone) can't hide a browser-side key.
- Lambda + Function URL was chosen over API Gateway deliberately, to keep this to one
  resource with $0 idle cost for personal-scale traffic.
- OpenRouteService was chosen over Google Maps because it needs no billing account and
  has a workable free tier (2,000 req/day).

## Known open items
- AWS-hosted deployment is live (Lambda + CloudFront, see `docs/auth-design.md` for the
  URLs) — `master` deploys automatically via `.github/workflows/deploy.yml` on every
  push/merge. Don't assume the laptop dev-server is still the live target; it isn't
  unless told otherwise.
- Beta deployment's one-time manual setup (IAM policy reapply, CloudFront, Google OAuth
  origin) may or may not be done yet — check before assuming sign-in works on beta.
- Day 11 (Loen → Ålesund → Bergen → TLV) is not booked yet, but see the candidate
  reference itinerary noted under "Trip facts worth knowing" above.
- The KML has Eidfjord and DolceVidda at *nearly* identical (but distinct)
  coordinates, so the importer keeps them as two places — probably one real-world
  stop. Now surfaced (not auto-resolved — merging is a data-destructive decision the
  app shouldn't make silently): `computeNearDuplicates` flags any two places within
  ~50m of each other and the master list shows a ⚠️ badge with the other place's name
  and distance on hover, so the user can decide whether to drop one manually.

## If asked to deploy
Production (master) and beta both deploy automatically via GitHub Actions on push —
merging a PR to `master` or pushing to `beta` is the normal deploy path (confirm with
the user before merging/pushing, same as any other shared-state action). Running
`./aws/deploy.sh` by hand is only for local/manual use outside CI: confirm `ORS_API_KEY`
is set in the environment first (don't ask the user to paste it into chat — have them
`export` it locally). It's safe to re-run either way.
