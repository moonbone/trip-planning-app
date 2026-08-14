# Beta nightly log

A running log of what each scheduled nightly session built on `beta`, so
future runs don't duplicate or contradict prior work. Newest entry first.

## 2026-08-14

`beta` was at 8c49821 going in (last night's four features: long-driving-day
warning, budget tracker, backup/restore, weather forecast). Today is
literally the first day of the user's own trip (per CLAUDE.md's "Trip facts
worth knowing"), which shaped tonight's picks. Three changes, each committed
and pushed separately, each verified against the local dev-server before
pushing:

1. **Live "now" indicator on today's day timeline.** The app had plenty of
   *planned* clock times (drive summary, timeline rows) but nothing that
   answered "where should I be right now" mid-trip. When the active day's
   date is today and a route is calculated, the drive summary now shows a
   banner (`nowBanner`) derived from the exact same start→drive→stay
   segments the timeline rows already render, compared against the current
   wall clock: before departure, at a stop until its planned departure time,
   driving with an ETA, or done for the day. Refreshes every 60s via
   `setInterval(renderStats, 60000)` so it advances without the user
   touching anything — `renderStats` is pure display with no inputs/
   listeners inside it, so re-running it on a timer is safe.

2. **Sunrise/sunset in the weather panel.** Small, low-risk extension of
   last night's Open-Meteo weather call — added `sunrise,sunset` to the
   `daily` params already being requested and rendered them alongside
   temp/precip. Genuinely useful for pacing a long driving day given how
   much Norway's day length swings in August.

3. **Offline app-shell + map-tile caching via a service worker.** The
   biggest piece tonight. Several of this app's own existing features exist
   specifically because Norwegian-fjord-style road trips regularly have no
   signal (printable itinerary, GPX export, both from earlier nights) — but
   nothing made the *app itself* work with no network at all. `aws/sw.js` is
   network-first for the shell (this page + Leaflet's CDN CSS/JS) so an
   online visit always runs the live app — deliberately not undermining
   `index.html`'s existing `Cache-Control: no-store` (there specifically so
   a stale cached copy never silently keeps running old client code); the
   service worker's cache is only a fallback for when there's genuinely no
   network. Cache-first for OSM tile requests
   (`{s}.tile.openstreetmap.org`), so map areas already viewed while online
   stay visible offline — the actual point of the feature. Also added
   `aws/manifest.webmanifest` + `aws/icon.svg` (a plain teal pin — the
   app's first icon ever) so it's installable via "Add to Home Screen".
   Registered fire-and-forget from `index.html`; served by
   `aws/handler.mjs` at `/sw.js`, `/manifest.webmanifest`, `/icon.svg`
   (all three live directly in `aws/`, no root-level copy needed, unlike
   `index.html`); `deploy.sh` zips them in alongside the rest.

All three verified locally against the file-based dev-server
(`AUTH_DEV_FAKE=1`) with Playwright. The "now" banner was driven through
all six of its states (before start, at each of two stops, driving between
them, and day-complete) using `page.clock.setFixedTime` against a synthetic
routed day, with a stubbed `/route` response. The weather sunrise/sunset
extension was checked against a stubbed Open-Meteo response. The service
worker got the most scrutiny given how easy SW caching is to get subtly
wrong: registered and activated correctly in a real browser; the shell got
runtime-cached on the first *controlled* navigation (the very first, pre-
registration load is never SW-controlled, by spec); and — rather than
trusting Playwright's `context.setOffline()` emulation, which turned out to
let a first pass silently succeed for the wrong reason — the dev server was
actually killed (`SIGKILL`, not emulated) before reloading, confirming the
shell really does come from the SW's cache with zero live server involved.
A separate pass proved the opposite direction matters too: mutated
`index.html` on disk while the server stayed up (simulating a live
redeploy) and confirmed the *next* online reload picks up the change
immediately, not a stale cached copy — network-first genuinely wins while
online. Playwright's `page.route()` turned out not to intercept requests a
service worker issues internally from its own `fetch()` calls (only page/
document-initiated requests) — confirmed by a stub that Chromium never
actually hit — so the tile cache-first path, the "leave non-shell/non-tile
GET requests alone" guard, and the navigation fallback logic were instead
unit-tested by running `sw.js`'s real, unmodified source against a minimal
mocked `self`/`caches`/`fetch` environment in plain Node, which caught all
five of the same behaviors that mattered. Confirmed all three commits
deployed successfully via `deploy-beta.yml`, and did a handful of read-only
GETs against the live beta URL afterward — `/`, `/sw.js`,
`/manifest.webmanifest`, `/icon.svg` — confirming correct status codes,
content types, and that the served HTML actually contains the manifest
link and SW registration call.

**Decided not to do, and why:**
- **A fourth feature.** Three well-tested, independent changes — one of
  them a genuinely substantial one (the service worker) that deserved full
  attention to its failure modes rather than being rushed to make room for
  a fourth — felt like the right scope for tonight rather than padding for
  its own sake.
- **Precaching every visible map tile proactively, instead of only the
  tiles actually viewed.** Precaching would need to know the trip's route
  geometry and a tile-pyramid computation ahead of time — real complexity
  for a benefit (offline tiles for areas never actually looked at) the user
  is unlikely to need. Cache-as-you-go covers the realistic case: you look
  at the map while you still have signal, then it's still there later.
- **A `Service-Worker-Allowed` header or a non-root SW scope.** `/sw.js` is
  already served from the origin root, which gives it root scope by
  default — no extra header needed, and a narrower scope would be pure
  complexity for no benefit on a single-page app.
- **Live-testing the SW against a real, unstubbed OSM tile server or the
  Leaflet CDN.** Same known sandbox limitation prior nights hit (no
  outbound access to those hosts from here) — briefly tried routing around
  it via a `/etc/hosts` override for `a.tile.openstreetmap.org` pointed at
  a local stub server, decided that was a heavier and more invasive change
  to the sandbox than the coverage gain justified, reverted it, and used
  the mocked-environment unit test instead.

## 2026-08-13

`beta` was at da3f49f going in (prior night's four features: packing
checklist, fuel cost estimate, GPX export, dark mode). Picked four
independent changes tonight, each committed and pushed separately, each
verified against the local dev-server before pushing:

1. **Long-driving-day warning.** CLAUDE.md's "Known open items" has flagged
   Day 7 of the user's own trip (Gol → Loen, ~6h estimated) as "worth
   double-checking" for a while, but nothing in the app called out heavy
   driving days generically. A day at or above 4.5h of driving (the common
   "keep it under ~4.5h" road-trip planning guidance) now gets a ⚠️ badge
   on its tab, a warning line in the active day's drive summary, a count in
   the trip overview panel, and a note in the printable itinerary. Tab
   badges use a straight-line-distance/50kmh estimate (`dayDriveEstimate`)
   so every day can be flagged without routing all of them up front —
   deliberately a rough overestimate for winding/mountain roads — and
   switch to the exact figure once a day's route is actually calculated.

2. **Trip budget/cost tracker.** Fuel cost (added two nights ago) was the
   only cost estimate in the app — nothing captured accommodation,
   activities, or other trip spending. A 💰 button next to packing opens a
   modal for a flat `{id, category, label, amount}` cost list per trip (not
   per variant, same reasoning as packing), with a running total. Follows
   packing's exact dual-driver pattern: `tripplan-budget:<id>` locally, or
   a `budgetItems` field via `PUT /api/trips/:id/budget` signed in
   (editor+, whole-array replace, sanitized/capped at 300 items, amounts
   clamped to `[0, 1e8]`, empty-label items dropped). Reuses the fuel
   settings' currency label for display rather than adding a second
   currency field.

3. **Trip backup/restore as a JSON file.** Everything about a trip beyond
   the KML itself — plan variants, custom places, imported place info,
   comments, packing list, budget — lives only in this app's storage;
   clearing local storage or losing account access loses all of it, with
   no way to reconstruct it even by re-uploading the original KML. "💾
   Backup trip" downloads one JSON file with the KML source plus every
   plan variant (not just the active one) and all trip-scoped data above.
   "📥 Restore backup" always creates a **new** trip from that file (never
   overwrites), pushing the data through the same create-trip/create-
   variant/PUT-enrichment/PUT-packing/PUT-budget/POST-comment endpoints the
   UI itself uses, then reloading from `loadRemoteIndex()` as the source of
   truth for the new trip's index entry rather than hand-building it.

4. **Weather forecast for the active day.** A forecast line between the
   trip overview and drive summary panels shows high/low temp,
   precipitation, and a condition icon for the active day's first stop —
   genuinely timely given the user's own trip starts tomorrow. Calls
   Open-Meteo directly from the browser (free, keyless, CORS-enabled for
   client-side use, same trust model as the Nominatim geocoding already
   used elsewhere in this app), so no new server config or secret was
   needed. Its forecast horizon is ~16 days, so days already past or too
   far out just render nothing. A request-token guard discards a slow
   response that resolves after the user has switched days; results are
   cached in memory per `lat,lon,date` for the session.

All four verified locally against the file-based dev-server
(`AUTH_DEV_FAKE=1`) with Playwright: the long-driving-day badge against a
hand-written KML with an intentionally far-flung stop; the budget tracker's
add/remove/persist/reload cycle in both the signed-out (localStorage) and
signed-in (DynamoDB-file) paths, plus server-side validation (403 for a
viewer-role share, 400 for a non-array or >300-item payload, and
sanitization — trim, control-char strip, negative-amount clamp,
over-cap clamp, empty-label drop); the backup/restore round-trip
end-to-end in both storage modes (packing/budget/comments/multiple
variants all came back correctly) plus graceful rejection of a malformed
or non-JSON file; and the weather panel's date-window boundary (KML dates
in 2020 and 2030 correctly triggered zero API calls) and request-token
race guard (a deliberately slow stale response was confirmed discarded in
favor of the actively-selected day's data). The weather feature's live
Open-Meteo call itself couldn't be exercised inside a Playwright browser in
this sandbox (no outbound network from the browser process here, unlike
`curl`/Node fetch, which do have proxy access) — same known sandbox
limitation prior nights hit with the Leaflet CDN. Verified the API
call/response-parsing logic separately via a direct Node fetch (real
response, correctly parsed) and the full render pipeline via a stubbed
`fetch` response in-browser, so the only untested leg is the live network
hop itself, which is unrelated to sandbox-vs-production code paths.

**Decided not to do, and why:**
- **Auto-splitting a long driving day across two days.** Flagging is
  useful; auto-rearranging someone's itinerary based on a heuristic drive
  estimate is a destructive, opinionated action better left to the user,
  matching last-night's stance on not auto-merging near-duplicate places.
- **A dedicated currency field for the budget tracker.** Reused the fuel
  settings' currency label instead — asking for currency twice for two
  cost-related features in the same trip felt redundant, and "the car's
  currency" and "the trip's currency" are the same thing in practice.
- **Restoring comment authorship/timestamps verbatim on remote restore.**
  Comments are POST-per-item only (no bulk endpoint), and the server
  already stamps author/timestamp from the session — re-posting as the
  restoring user is correct behavior, not a compromise; the original
  metadata is preserved as-is on the *local*-mode restore path, where
  comments are just copied into localStorage rather than re-posted.

## 2026-08-12

`beta` was at a5eb87a...885a605 going in (last night's three features: printable
itinerary + copy-day-plan, places search filter + near-duplicate badge, trip
overview panel). Picked four independent changes tonight, each committed and
pushed separately, each verified against the local dev-server before pushing:

1. **Packing checklist.** A 🎒 button next to trip comments opens a modal with
   a flat, trip-scoped `{id, text, checked}` list — deliberately not per
   variant, since what to pack doesn't depend on the route plan. Follows the
   `enrichment` field's pattern (whole-array PUT, not comments' per-item CRUD,
   since packing items don't need author tracking): local
   `tripplan-packing:<id>` key signed out, `PUT /api/trips/:id/packing`
   (editor+, sanitized/truncated/capped at 300 items) signed in. This is the
   packing checklist last night's session explicitly punted on as needing
   "more surface than felt right" — turned out to need no new DynamoDB table,
   just one more field on the existing trip record, so it fit fine tonight.

   While wiring up its load path, found and fixed a real bug: the page's
   *initial* load (a plain reload, not a trip switch) had its own duplicated
   copy of `activateCurrentTrip()`'s trip-loading logic that never loaded
   `enrichment`/`comments` (or now packing) at all — so a signed-in-or-not
   user's comments and imported place info silently vanished on every plain
   page reload until they switched trips away and back. Fixed by having
   startup call the same `activateCurrentTrip()` function instead of
   duplicating it; this also surfaced (and fixed) a second bug from the same
   root cause — enrichment matching ran *before* the newly-loaded trip's
   enrichment was assigned, so imported place photos/descriptions could be
   stale for one render after switching trips.

2. **Fuel cost estimate.** A small ⛽ settings row above "Drive summary"
   (consumption L/100km, price/liter, currency label) — one plain, *not*
   trip-scoped or synced `tripplan-fuel-settings` localStorage key, since
   it's a property of the car, not the trip. Appends "≈ N <currency> fuel" to
   the active day's stats line and to both per-day and whole-trip totals in
   the printable itinerary, reusing distances already fetched there rather
   than making new routing calls. Omitted entirely until both fields are
   filled in.

3. **Whole-trip GPX export.** A "🗺️ Export GPX" button next to Print
   itinerary downloads a single `.gpx` file for GPS devices/apps (Garmin,
   OsmAnd, Google Earth…): a waypoint per unique stop across every day
   (overnight stops tagged Lodging), plus a track per day when that day's
   route can be fetched — same sequential per-day fetch-with-fallback as the
   printable itinerary, so an unroutable day just loses its track line
   instead of failing the whole export. Verified place names with `&`, `<`,
   `>`, `"`, `'` produce well-formed, correctly-escaped XML.

4. **Dark mode.** A 🌙/☀️ header toggle — system preference by default,
   explicit choice (`tripplan-theme` in localStorage) wins either way,
   applied before first paint by a tiny inline script at the top of `<head>`
   so there's no flash of the wrong theme. This is the item last night's
   session explicitly flagged as "a good candidate for a future session with
   more headroom to review carefully" — tonight had that headroom, and the
   audit turned out smaller than feared: the app already routes almost every
   color through CSS custom properties (`--bg`/`--panel`/`--ink`/`--accent*`/
   `--border*`), proven out by the existing `body.beta-env` purple override,
   so the dark palette was mostly just new values for those.

   Two things needed real care, not just a value swap — caught by actually
   looking at rendered screenshots (stubbed `window.L` so Leaflet's absence
   in this sandbox, which has no CDN access, doesn't crash the map init
   before the rest of the page renders), not just reasoning about hex codes:
   - `--accent-light` flips role from "pale wash" to "dark wash" so the
     (now bright) `--accent-dark` text drawn on top of it stays legible in
     both themes.
   - `.calc-btn`'s background used `--accent-dark`, which becomes a *bright
     text* color in dark mode, not a fillable button surface — a first-pass
     screenshot showed the button lose almost all contrast. Fixed by moving
     it to `--accent` instead (deliberately kept close to its light-mode
     value everywhere, since it also serves as a filled badge/button
     background with white text — route-item index circles, status-done,
     the beta badge — in both themes).
   - Screenshots also caught four inputs/textareas (`.dialog-input`,
     `.comments-section textarea`, `.packing-add-row input`,
     `.fuel-settings input`) with no explicit `background`/`color` — a stark
     white box in dark mode, invisible-because-matching in light mode. Now
     themed like every other input in the app.

   The printable itinerary's own popup-window `<style>` was deliberately
   left alone — it's meant for printing/PDF, not on-screen reading in-theme.

All four verified locally against the file-based dev-server
(`AUTH_DEV_FAKE=1`), including the signed-in/remote-DynamoDB path for the
packing checklist (dev-fake-authed as two separate users to confirm a
viewer-role share gets a 403 on write) and API-level validation (rejects a
non-array `packingList`, rejects >300 items, strips control characters,
trims, truncates to 200 chars, drops whitespace-only items). Dark mode was
checked with real screenshots across light/dark × mainline/beta-purple ×
desktop/mobile × three modals × the tickets view, plus the system-preference-
vs-explicit-override interaction in both directions. All four commits
deployed successfully via `deploy-beta.yml`; spot-checked the live beta HTML
for each feature's new element IDs after pushing.

**Decided not to do, and why:**
- **Per-day GPX export as an alternative to whole-trip.** Whole-trip is more
  useful for how people actually use a GPS unit on a road trip (load once,
  not once per day) and was the same amount of work, so didn't build both.
- **WCAG-precise contrast tuning for the dark palette.** Chose values that
  read clearly in the screenshots taken tonight (which is more reliable than
  hand-computing contrast ratios) rather than chasing exact AA numbers for
  every text/background pairing — this is trip-planning chrome, not
  safety-critical software, and the existing light theme was never audited
  to that bar either.

## 2026-08-11

First nightly run against this log format (the file didn't exist yet).
`beta` was at the same commit as `master` (a5eb87a) going in, so this is
effectively the first round of beta-only feature work since the parallel
deployment was set up.

Picked three small, independent, low-risk additions — all client-side
only, no new backend endpoints, no new secrets, nothing that touches the
localStorage/DynamoDB dual-driver pattern:

1. **Printable offline itinerary export + copy-day-plan button.** A
   "🖨️ Print itinerary" button (trip-file panel) opens a new tab and
   builds a full day-by-day itinerary for the whole trip — stops, drive
   times/distances, stay durations, day notes — as a standalone printable
   HTML page (own inline styles, a "Print / Save as PDF" button, no
   dependency on the main app's CSS). It fetches driving times per day
   independently of whatever's cached for the currently active day, and
   degrades gracefully per day if routing fails (shows the stop list
   without clock times rather than failing the whole export). Reasoning:
   road trips through places like the Norwegian fjords often have no
   signal, so having something printable/PDF-able in hand before setting
   off is a real, common need for this kind of app. A "📋 Copy day plan"
   button reuses the existing AI-summary text renderer but isn't gated
   behind sign-in, since sharing today's plan over text/WhatsApp shouldn't
   require an account.

   Caught and fixed one real bug during testing (before it ever reached
   `beta`): the per-leg drive time in the printable view was off by one —
   each "↓ drive Xmin" row was showing the time of the *previous* leg
   instead of the leg it was actually labeling. Found by stubbing the
   routing fetch in a Playwright test and eyeballing the rendered times
   against the stub; fixed by keying each leg row off the *next* stop's
   recorded arrival leg instead of the current stop's.

2. **Places search filter + near-duplicate warning badge.** A filter box
   above the master places list narrows it by name (pinned start/end
   hotel rows for the active day stay visible regardless — they're
   structural context, not search results). Also resolves the
   long-standing Eidfjord/DolceVidda item from this file's "Known open
   items": rather than guessing which of two near-identical places is
   "the real one" and silently merging them (risky — two genuinely
   distinct nearby places do happen), places within ~50m of each other
   now get a hoverable ⚠️ badge naming the other place and the distance,
   so the user decides whether to drop one. Purely informational, never
   mutates data.

3. **Whole-trip overview panel.** The app only ever showed stats for the
   currently active day (drive time, distance, etc.) — nothing summarized
   the trip as a whole. Added a small panel above the per-day drive
   summary: day count, total places, overnight-stop count, and how many
   days still need at least one stop before they can be routed. Pure
   client-side aggregation of state already in memory, no routing calls.

All three verified locally against the file-based dev-server
(`AUTH_DEV_FAKE=1`) with Playwright — uploaded a hand-written sample KML,
exercised each button/input, and confirmed behavior including the
graceful-degradation path (stubbed a failing/unavailable routing API).
Also confirmed via a throwaway git worktree at the pre-session commit that
an unrelated `L is not defined` / Leaflet-map error seen during local
testing is a sandbox artifact (no outbound access to the Leaflet CDN in
this environment) and not a regression — it reproduces identically on the
untouched code, and none of tonight's features touch map rendering.
Confirmed all three commits deployed successfully via `deploy-beta.yml`
and spot-checked the live beta HTML for the new element IDs after each
push.

**Decided not to do, and why:**
- **Dark mode.** The app already uses CSS custom properties for theming
  (see the `body.beta-env` override), so it's plausible, but doing it
  properly means auditing every hardcoded color across ~3400 lines plus
  the tickets/admin views and getting it right in one pass without a full
  visual review — didn't want to ship something half-checked. Good
  candidate for a future session with more headroom to review carefully.
- **Packing checklist.** Genuinely useful, but it's a different domain
  than this app's core KML/day/route model, and doing it "right" (synced
  for signed-in users, not just local-only) would mean new backend
  endpoints and DynamoDB schema — more surface than felt right to take on
  and fully test in one session alongside the other three changes.
- **Auto-merging near-duplicate places** (vs. just warning about them):
  deliberately not automated — merging is a data-destructive decision
  (which name survives? which day does it belong to?) that should stay a
  human call, not a heuristic guess.
