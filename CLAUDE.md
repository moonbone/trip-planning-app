# Norway 2026 Route Planner — context for Claude Code

## What this is
A trip-planning app for a Norway road trip, Aug 14–24 2026 (fly into Bergen, out of
Ålesund). It has a day-by-day place list (from a KML export of the itinerary), lets you
select/reorder stops per day, and calls a routing API to get real driving times.

## Trip facts worth knowing
- Overnights: Thon Hotel Sandven (Norheimsund, Aug14→15) → Kinsarvik Camping
  (Aug15→18) → Hesla Gård Pensjonat, Gol (Aug18→20) → Hotel Alexandra, Loen (Aug20→24).
- Return flight WF459 departs Ålesund Aug24, 19:25, arrives Bergen.
- **Known gap, unresolved:** nothing covers Loen → Ålesund on Aug24, and there's no
  Bergen hotel or onward TLV flight entered anywhere yet. Don't assume this is decided.
- Day 7 (Gol → Loen) is the heaviest driving day (~6hr estimated) — flagged as worth
  double-checking, possibly involves a ferry.

## Architecture
- `index.html` — the whole frontend. Vanilla JS + Leaflet (OSM tiles, no key needed).
  Persists day-plan selections in `localStorage`. Calls `PROXY_URL` (currently `/route`,
  relative — assumes same-origin hosting) for routing, falls back to public OSRM demo
  servers if the proxy fails. Below 860px width, the 3-column layout collapses to a
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
- Day 11 (Loen → Ålesund → Bergen → TLV) is entirely unplanned.
- The KML has Eidfjord and DolceVidda at identical coordinates — probably one place,
  not two; not yet resolved either way in the app data.

## If asked to deploy
Confirm `ORS_API_KEY` is set in the environment (don't ask the user to paste it into
chat — have them `export` it locally), then run `./aws/deploy.sh`. It's safe to re-run.
