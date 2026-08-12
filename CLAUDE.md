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
  tickets view (`#ticketsView`). Beyond KML places: **custom places** (user-added via map
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
  list at 300 items). An AI "Summarize day" button (signed-in UI, server-gated
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
  A fuel cost estimate (⛽ row above "Drive summary") takes a consumption (L/100km),
  price/liter, and currency label the user types in — one plain `tripplan-fuel-settings`
  localStorage key, deliberately *not* trip-scoped or synced (it's the car, not the trip)
  — and appends "≈ N <currency> fuel" to the active day's drive stats and to both the
  per-day and whole-trip totals in the printable itinerary (`fuelCostText`, reused by both
  call sites). Omitted entirely whenever consumption or price is unset/zero.
  A "🗺️ Export GPX" button (col-left, next to Print itinerary) downloads the whole trip
  as a single `.gpx` file for GPS devices/apps (Garmin, OsmAnd, Google Earth…):
  `buildTripGpx` emits a `<wpt>` per unique stop across every day (deduped like `PLACES`
  already is, overnight stops tagged `<sym>Lodging</sym>`) plus a `<trk>` per day when
  that day's route can be fetched — same sequential per-day fetch-with-fallback as the
  printable itinerary, so a day that can't be routed just loses its track line rather
  than failing the whole export.
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
  still need at least one stop before a route can be calculated.
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
