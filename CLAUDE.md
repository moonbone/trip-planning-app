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
  route start/end). Places are deduped by name+coords across folders.
  Calls `PROXY_URL` (currently `/route`, relative — assumes same-origin hosting) for
  routing, falls back to public OSRM demo servers if the proxy fails. Below 860px width, the 3-column layout collapses to a
  single column switched via a bottom tab bar (Places / Route / Summary); Leaflet needs
  `map.invalidateSize()` after its container is unhidden, which `setMobileSection` calls.
  A header toggle switches the whole page between this planner view and the feature-request
  tickets view (`#ticketsView`).
- `aws/handler.mjs` — Lambda handler. Serves `index.html` at `GET /`, proxies
  `POST /route` to OpenRouteService using `process.env.ORS_API_KEY`, and handles
  `GET /tickets` + `POST /tickets` for feature requests. One function, one Function URL,
  no API Gateway.
- `aws/validate.mjs` — whitelist validation for ticket fields (subject/description/email):
  English letters, digits, space, and `. , - @` only, nothing else. This is the real gate;
  `index.html` mirrors the same regexes client-side for instant feedback only, never trust
  that alone.
- `aws/tickets-db.mjs` — SQLite storage for tickets via Node's built-in `node:sqlite`
  (no npm dependency). DB file defaults to `data/tickets.db` (gitignored), overridable via
  `TICKETS_DB_PATH`. **Needs Node 22.5+** — not available on the `nodejs20.x` Lambda
  runtime, which is why `aws/deploy.sh` now targets `nodejs22.x`. Even so, this is
  local/laptop-hosting-only for now: Lambda's filesystem is read-only outside `/tmp`, and
  `/tmp` is ephemeral per-instance, so tickets would not reliably persist if actually
  deployed to Lambda. Would need DynamoDB/RDS/EFS for real Lambda persistence.
- `dev-server.mjs` — runs `aws/handler.mjs` locally over plain HTTP (`node --env-file=.env
  dev-server.mjs`), so the real proxy and tickets routes can be tested before deploying.
  Copies root `index.html` into `aws/index.html` at startup (mirroring what `deploy.sh`
  does before zipping) — **must be restarted** after editing `index.html` or any `aws/*.mjs`
  file, since it reads them into memory once at startup.
- `aws/deploy.sh` — idempotent: creates the IAM role + Lambda + Function URL on first
  run, updates code/config on subsequent runs. Requires `ORS_API_KEY` env var set before
  running; never put the key in a file.
- `aws/iam-policy.json` — scoped-down policy for whoever deploys (not admin creds).
- `.github/workflows/deploy.yml` — same deploy, triggered on push to `main`, secrets
  pulled from GitHub Actions repo secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`, `ORS_API_KEY`).
- `worker/` — an earlier, parallel deploy path using Cloudflare Workers instead of
  Lambda. Kept for reference; not the primary path anymore. If both exist, AWS is current.

## Key decisions already made (don't relitigate without reason)
- Routing key must never be client-side or in git — proxy pattern was chosen
  specifically because static hosting (GitHub Pages alone) can't hide a browser-side key.
- Lambda + Function URL was chosen over API Gateway deliberately, to keep this to one
  resource with $0 idle cost for personal-scale traffic.
- OpenRouteService was chosen over Google Maps because it needs no billing account and
  has a workable free tier (2,000 req/day).

## Known open items
- No AWS-hosted deployment yet — `aws/deploy.sh` has not actually been run. The user was
  locked out of their AWS account when this came up; check current status before assuming
  it's still blocked.
- In the meantime, the app is being served directly from the user's laptop via
  `dev-server.mjs` + router port forwarding (not Lambda). Don't assume AWS is the live
  deployment target — ask which is current if it matters.
- Day 11 (Loen → Ålesund → Bergen → TLV) is not booked yet, but see the candidate
  reference itinerary noted under "Trip facts worth knowing" above.
- The KML has Eidfjord and DolceVidda at *nearly* identical (but distinct)
  coordinates, so the importer keeps them as two places — probably one real-world
  stop; not yet resolved.

## If asked to deploy
Confirm `ORS_API_KEY` is set in the environment (don't ask the user to paste it into
chat — have them `export` it locally), then run `./aws/deploy.sh`. It's safe to re-run.
