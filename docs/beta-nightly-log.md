# Beta nightly log

A running log of what each scheduled nightly session built on `beta`, so
future runs don't duplicate or contradict prior work. Newest entry first.

## 2026-08-22

`beta` was at cae984f going in (last night's five: tab scroll/keyboard nav,
stale-route nudge, jump-to-today, move-to-day, print-remaining). Fetched
the real feature-request backlog from mainline (`GET /tickets`): of 13
tickets, **zero were actionable** — every one is already `done` or
`in_beta` from prior nights (the three most recent, `mt17lonuj2k12b`
"Auto open current day", `mswuwmi5itojje` "Search function", and
`msw6fddzu25mte` "Search function confirmation", were all marked
`in_beta` by the last few sessions). **No mainline ticket was implemented
or marked `in_beta` tonight** — nothing was left to take. All six changes
below are own-initiative picks, each committed and pushed separately,
each verified against the local dev-server with Playwright (fresh
chromium, stubbed `window.L`, stubbed every external API this sandbox
can't reach from a browser — the approach every prior night has used).

A loose theme emerged: the app had been *fetching* a lot of weather it
wasn't really *using*. Four of tonight's six changes close that gap.

1. **ATMs and banks in the nearby-amenities lookup.** Same shape as the
   pharmacy/hospital and EV-charging additions from earlier nights: OSM's
   `amenity=atm`/`bank` tags slot straight into the existing Overpass
   query with no special-casing beyond an icon each. Cash is still the
   practical fallback in plenty of places a road trip passes through.

2. **A rain badge on the day tabs, and a rainy-day count in the trip
   overview.** The whole-trip weather strip already fetched a forecast
   for every day in horizon, but spotting a wet day still meant reading
   the strip carefully and mapping chips back to tabs. A 🌧️ badge now
   sits on the tab itself, beside the long-drive and ferry badges it
   mirrors, firing at `RAIN_WARN_MM` (5mm) — enough to be a day worth
   planning around, not a passing drizzle. `rainBadgeHtml` deliberately
   never fetches: it only reads what `weatherCache` already holds, so it
   stays a cheap synchronous lookup like the two badges beside it rather
   than becoming a third weather call path.

3. **Climate normals beyond the forecast horizon.** Flagged in the
   2026-08-20 entry's "decided not to do" as genuinely useful but needing
   room to build properly — tonight had it. Open-Meteo's forecast only
   reaches ~16 days, so a trip planned months ahead showed a completely
   blank weather panel and strip for nearly all of it, which is exactly
   when someone is deciding what to pack and which days to keep flexible.
   Days past the horizon now fall back to an average of the same calendar
   date (±2 days) over the last 3 years from
   `archive-api.open-meteo.com` — a different endpoint on the same free,
   keyless service, so no new config or GitHub secret. Presented as
   clearly *not* a forecast: a "~" prefix, italic text, a dashed chip,
   and an explicit "avg of the past N years" label. Deliberately
   future-only (a past day has nothing left to plan for) and in-app only
   — the printable itinerary and ICS export already have a settled "no
   forecast available" story for these days, and widening that felt like
   a separate decision. Confirmed the archive API's real response shape
   with a live call from this shell before trusting the parsing, and the
   real Bergen October values (≈12°/8°C, wet) came back closely matching
   the stub the tests use.

4. **A daylight warning when a day finishes after sunset.** The app
   already had both halves of this and had never put them together:
   sunset comes back on the forecast it already fetches, and the drive
   summary already computes the day's end time. Finishing the last
   stretch in the dark on unfamiliar mountain or coastal roads is a real
   concern, and at northern latitudes the daylight window swings by hours
   across a season, so a plan that was comfortable in June isn't in
   September. Shows in the active day's drive summary and in the
   printable itinerary through one shared plain-text helper
   (`daylightOverrunText`), matching how `weatherSummaryText`/
   `fuelCostText` are already shared across those two surfaces. Costs no
   extra API call. Also factored the cached-forecast lookup introduced in
   (2) into `cachedForecast()`, now shared by both.

5. **Fixed a rough edge introduced by (2), before it could bite.** The
   rain badge landed with an unconditional `renderTabs()` once the
   weather strip's fetches finish. `renderTabs()` rebuilds every tab
   element from scratch — so that call dropped keyboard focus out of the
   tab bar if someone was arrowing between days while fetches were still
   in flight (undoing last night's own tab-accessibility work), and
   re-ran the active tab's `scrollIntoView()` even on trips where no day
   is rainy and nothing about the tabs had changed. Now it diffs the
   rendered badge strings across the fetches, returns early when they
   match, and restores focus into the tab bar when it does rebuild.

6. **The weather strip's day chips switch to that day.** The strip's
   whole purpose is spotting a day worth looking at, but the chips were
   inert `<div>`s, so the next move was hunting for the matching tab by
   hand. They're real `<button>`s now (`weatherChipHtml`), which also
   makes them keyboard- and screen-reader-operable for free — the same
   reasoning that made the day tabs focusable last night.

**44 checks total across six throwaway Playwright scripts, all passing**,
with the full set re-run after every later change to catch cross-feature
regressions. Coverage worth noting: the rain badge's positive *and*
negative day; the climate fallback's beyond-horizon, in-horizon, and
already-past branches (a fully-past trip must trigger **zero** API calls
of either kind — asserted directly); the daylight warning driven through
both an early sunset (warning shown, names the time) and a late one (no
warning, timeline otherwise intact); and for (5), an explicit assertion
that a dry trip calls `renderTabs` exactly **once** while a wet trip
calls it exactly **twice**, with keyboard focus surviving in both cases.
Also screenshotted the new UI in both light and dark mode — the climate
chip's dashed border, the rain badges, and the nearby modal's new
opening-hours sub-line all read correctly in both.

Two process notes for future nights, both re-learned the hard way:
- **The dev-server gotcha from CLAUDE.md bit again, and silently.** A
  restart failed with `EADDRINUSE` because the old process was still
  holding 8787, so a test run "passed" against stale markup and then
  "failed" 4 checks on the next run with no code change in between. The
  earlier apparent success was the false one. Always confirm the new
  server actually bound (or grep the *served* HTML for a new symbol)
  rather than assuming a restart worked.
- `pkill -f dev-server.mjs` **kills its own shell**, because the pattern
  appears in the shell's own `/proc` cmdline. Cost three dead commands
  before it was obvious. There's now a
  `scratchpad/restart-dev.sh` helper that matches exact cmdlines and
  skips `$$`; a future night may want to keep something like it around.

**Decided not to do, and why:**
- **Wiring climate normals into the printable itinerary and ICS export.**
  Those already degrade cleanly to "no forecast" for out-of-horizon days,
  and pushing a 3-year average into a printed itinerary — where it's
  furthest from the "not a live forecast" caveat that makes it honest —
  is a different judgment call than showing it on screen. Left as a
  deliberate, revisitable choice rather than an oversight.
- **Parsing OSM `opening_hours` into an "Open now" verdict** when adding
  it to the nearby results (which *was* added, shown verbatim). Doing it
  correctly needs public-holiday calendars and timezone handling this app
  has no business carrying, and a subtly wrong "Open now" is worse than
  the raw string a traveler can read for themselves.
- **A trip-wide "days ending after dark" rollup** to go with the per-day
  daylight warning. The warning needs a day's *computed end time*, which
  only exists once that day has actually been routed — so a trip-wide
  count would be blank or misleading for most days on most trips. Same
  reasoning that kept last night's stale-route indicator per-day.
- **Live-verifying the Overpass `opening_hours` tag against the real
  API.** The public instance was returning 503s all session (the
  flakiness CLAUDE.md already documents); backed off after two attempts
  rather than hammering it. No real risk either way — `out` already
  returns the full tag map (that's how the existing code reads
  `tags.name`/`tags.amenity`), so this reads one more standard key off an
  object the code already consumes, with no query change.

## 2026-08-21

`beta` was at 03a6ce9 going in (synced with master after the prior 6-night
batch was promoted to production). Fetched the real feature-request backlog
from mainline (`GET /tickets`): of 13 tickets, one was open (`new`) — the
rest are already `done` or `in_beta` from prior nights.

1. **Ticket `mt17lonuj2k12b` — "Auto open current day."** The user's report:
   on load, the current day is auto-selected (that logic — `initialDay()` —
   already existed from an earlier "Navigate button" ticket), but the tabs
   row scrolls horizontally and the newly-active tab could land off-screen
   with nothing to show it was even selected. `renderTabs()` now calls
   `scrollIntoView({block:'nearest', inline:'nearest'})` on the active tab
   after every render. While in there, closed a real accessibility gap this
   surfaced: day tabs were plain unfocusable `<div>`s with only a click
   handler, unlike every other interactive control in this app. Added
   `role="tablist"`/`role="tab"`/`aria-selected`, made the active tab
   Tab-focusable, and wired Enter/Space to activate plus Left/Right/Home/End
   to move focus+selection between days. Marked `in_beta` on mainline after
   pushing.

Then three own-initiative picks, each committed and pushed separately, each
verified against the local dev-server with Playwright (fresh chromium,
stubbed `window.L` for the CDN-less sandbox, stubbed `fetch` for external
hosts where a real network call would otherwise hang instead of failing
fast — same approach every prior night has used, documented further down
this file):

2. **Stale-route nudge.** `renderStats()` showed the exact same "Select 2+
   stops and calculate to see times" message whether a day had never been
   routed, or had been routed and then edited (a stop moved/removed/added
   since). The second case is easy to miss — the calculated times just
   silently vanish with no hint the plan moved on. Now says "Stops changed
   since the last calculation — press Calculate driving times to update"
   specifically for that case, using the same `lastRoute.day`/`lastRoute.ids`
   staleness check the panel already relied on, just distinguishing which
   branch produced it.

3. **"Jump to today" button.** The trip overview panel already shows "Day N
   of M — today" via `tripCountdownLine()` when today falls within the trip,
   but that only helps while you're still on today's tab — `initialDay()`
   only runs once, on page load. Navigate away to plan a different day (very
   likely mid-trip, which is exactly the situation for the user's own trip
   right now) and there was no quick way back short of a reload. A small
   button next to that line now jumps straight back, shown only when today
   isn't the active day.

4. **Move a stop to a different day.** Previously the only way to shift a
   stop from one day's plan to another was to remove it and re-find/re-add
   it from the master list under its original day — real friction for a
   genuinely common mid-trip adjustment. Each route-item row now has a small
   "→ day" `<select>` listing every other day in the trip; picking one moves
   the stop there in one action. Hotel anchors are untouched since wake/sleep
   hotel ids come from `DAY_HOTELS` (computed once from the KML's overnight
   flags), not from a stop's position in `plans[]`, so the move always lands
   the stop correctly — just before the target day's sleep hotel. Reuses the
   existing `showUndoToast` pattern (this app's established convention for
   single-click plan-mutating actions) rather than a confirm dialog.

5. **Print only remaining days, on a trip already underway.** The printable
   itinerary always built every day in the trip, including days already
   behind you — genuinely wasted weight for a feature whose whole point is
   being useful with no signal partway through a trip. `printTripItinerary()`
   now checks for a real past/future split (≥1 day already before today,
   ≥1 day still today-or-later) and, only then, asks once via `confirm()`
   whether to print just the remaining days. A trip with no dates, one not
   yet started, or one already fully over skips the prompt and prints
   everything, unchanged from before. `buildDayItinerary()` already tags
   each day with its own day number/date, so `renderPrintableItinerary()`
   needed no changes — it was already agnostic to which subset of days it's
   handed.

All five changes verified end-to-end against the local dev-server with a
hand-built 12-day test KML dated around the real current date (so "today"
falls on day 11 of 12) plus a second, fully-future test KML for the
no-regression case: 12 tabs render and the active one scrolls into view on
both click and full page reload; keyboard End/ArrowLeft move focus and
selection correctly between tabs; seeding a `lastRoute` then mutating the
day's plan switches the stats panel from the calculated view to the new
stale message; the "Jump to today" button appears/disappears correctly and
returns to the right tab; moving a stop between days updates both days'
`plans[]`, renders in the right position on the target day, and undoes
cleanly back to the exact original state; and the print-remaining-days
prompt reports the correct past/remaining counts, both `confirm()` branches
produce the right day subset, and a fully-future trip skips the prompt
entirely. Spot-checked the live beta URL after pushing — all four new
CSS/JS hooks (`role="tablist"`, `.today-jump-btn`, `.move-day-select`, plus
the stale-route copy) are present in the served HTML.

**Decided not to do, and why:**
- **A dedicated "days needing a route recalculated" indicator in the trip
  overview panel**, alongside the existing per-day stale-route nudge. The
  per-day message already surfaces this the moment you're looking at that
  day; a trip-wide rollup would be a second place tracking the same state
  and felt like scope creep for tonight rather than a clearly-needed
  addition — a candidate to revisit if it turns out to matter in practice.
- **Auto-scrolling to today's day whenever it becomes "today" while the app
  is already open** (i.e. at midnight, mid-session) — a real edge case, but
  vanishingly rare for anyone actually using this app at midnight on a
  moving trip, and "Jump to today" already covers the actual need (getting
  back quickly) without guessing at when to trigger an automatic jump the
  user didn't ask for.

## 2026-08-20

`beta` was at 1cd2d7d going in (last night's five features: live position,
weather in exports, budget currency/CSV, nearby amenities). Fetched the real
feature-request backlog from mainline (`GET /tickets`): of 12 tickets, zero
were actionable — everything is already `done` or `in_beta` from prior
nights. No mainline ticket work tonight; all four changes below are
own-initiative picks. Each committed and pushed separately, each verified
against the local dev-server with Playwright (fresh chromium, stubbed
`window.L`, stubbed Open-Meteo/Overpass — same approach every prior night has
used) before pushing:

1. **An mpg fuel-consumption unit, alongside L/100km.** Flagged twice in
   prior sessions' "decided not to do" notes as a genuinely different unit
   system from the km/mi distance toggle, not just a display conversion —
   tonight scoped it properly. A small toggle above the fuel-settings row
   (`#fuelUnitToggle`) switches what the consumption/price fields mean
   (L/100km + price/L, or US mpg + price/gallon); the `unit` lives on the
   same `tripplan-fuel-settings` object rather than a separate key, since
   it's meaningless without the two numbers next to it. Switching units
   deliberately doesn't clear or convert the typed numbers — placeholders
   change to make clear they need re-entering. Centralized the actual cost
   math in one `fuelCost()` helper shared by every display string
   (`fuelCostText`) and the whole-trip budget suggestion
   (`estimatedFuelCost`), which previously each had their own copy of the
   L/100km formula — so the two unit branches can't drift apart between
   them. Verified: default unit, toggle switching (placeholders, persisted
   values not cleared), reload persistence, and the cost math itself for
   both units (100km at 8 L/100km/20-per-L → 160; 100km at 30mpg/3.5-per-gal
   → ≈7.25) plus the null-when-unset case — 6 checks, screenshotted in both
   light and dark.

2. **EV charging stations in the nearby-amenities lookup.** Same reasoning
   as last night's pharmacy/hospital addition: OSM's `amenity=charging_station`
   tag slots straight into the existing Overpass query with no
   special-casing, and it's a real gap for anyone road-tripping in an EV.
   Verified with a stubbed Overpass response mixing a named charging station,
   a pharmacy, and an unnamed charging station (correctly filtered out) —
   confirmed the query string requests the new type and the modal renders it
   with the right icon.

3. **Split the trip budget total between N travelers.** A "Split between"
   row right under the existing currency-conversion row divides the running
   total by a traveler count and shows "≈ N per person" — same
   personal-display-preference, non-trip-scoped-localStorage pattern as the
   currency conversion above it (`tripplan-budget-travelers`), since how
   many people are splitting a trip's costs isn't really trip data any more
   than which currency you want the total shown in is. Hidden at the
   default of 1 traveler or an empty budget, same as the conversion line
   hides when nothing's configured. Verified: empty-budget and
   single-traveler no-op states, the split math itself (1500 ÷ 3 = 500),
   and persistence across closing/reopening the modal — 5 checks,
   screenshotted.

4. **Max wind speed in the day weather forecast panel.** Genuinely relevant
   context for mountain passes and ferry crossings, not just
   temperature/precipitation — Open-Meteo's `windspeed_10m_max` was one more
   field on the same daily forecast call already being made (no new API
   call or key). Reused the km/mi distance-unit toggle for display via a new
   `formatSpeedKmh()` (the km-to-mile ratio converts km/h to mph exactly the
   same way it converts km to miles, so this just reuses `KM_TO_MI` rather
   than a separate constant). Kept HTML-only in the single-day panel, same
   as sunrise/sunset — not added to the terse plain-text summary the
   exports and trip-wide weather strip reuse, matching that existing
   precedent. Verified with a stubbed Open-Meteo response: correct km/h
   figure, and correct mph conversion after toggling the distance unit — 2
   checks, screenshotted.

18 checks total across the four features, all passing, plus a final
integration pass loading a two-day KML fixture and exercising all four
features together in one session (mpg toggle, nearby-with-EV-in-the-query,
budget split, day-switch weather) with zero console/page errors. Confirmed
all four commits deployed successfully via `deploy-beta.yml`.

**Decided not to do, and why:**
- **A fifth feature.** Four independent, individually-tested changes felt
  like the right scope for tonight — the mpg toggle in particular deserved
  care given it was explicitly flagged twice before as needing more than a
  quick pass.
- **Climate-normal weather for days beyond Open-Meteo's ~16-day forecast
  horizon** (averaging past years' data for the same calendar date via the
  archive API). Considered as a bigger fourth/fifth feature — genuinely
  useful for trips planned months ahead — but multiple archive-API calls per
  out-of-horizon day (one per year averaged) is real complexity for a first
  pass; left for a future session with room to build and test it properly
  rather than rushing a partial version in.
- **Extending wind speed to the printable itinerary/ICS export.** Kept
  consistent with the existing sunrise/sunset precedent (HTML-only, not in
  the plain-text summary the exports share) rather than special-casing just
  the new field into a wider surface.

## 2026-08-19

`beta` was at 147d0cb going in (last night's five features: search bias,
countdown/ferry, native share, km/mi toggle, weather strip — plus a merge
bringing the `in_beta` ticket status back in from `master`). Fetched the
real feature-request backlog from mainline (`GET /tickets`): of 12 tickets,
zero were actionable — everything is already `done` or `in_beta` (the two
most recent, `mswuwmi5itojje` "Search function" and `msw6fddzu25mte`
"Search function confirmation", were marked `in_beta` by the last two
nights' sessions). No mainline ticket work tonight; all five changes below
are own-initiative picks. Each committed and pushed separately, each
verified against the local dev-server with Playwright (fresh chromium,
stubbed `window.L`, stubbed every external API this sandbox can't reach
from a browser — same approach every prior night has used) before pushing,
then spot-checked against the live beta URL after the final push:

1. **Live distance/ETA to the next stop from an actual GPS fix.** The day
   timeline already had a *planned* "driving to X, arriving ~HH:MM" banner,
   but nothing compared that plan to where you actually are — useful on a
   real road trip when you're running early/late or took a detour.
   `lastPos` (already tracked via `watchLocation()` for the "you are here"
   map marker and the existing Google Maps nav buttons — geolocation
   support turned out to already be wired up from an earlier ticket, not
   something to build from scratch) now also feeds a `liveNextStopLine()`
   under the now-banner: straight-line distance/ETA via the same haversine
   + flat-speed estimate the long-drive tab badges already use, so it costs
   no extra routing API call. Targets whichever stop the plan says is
   "next" in all three now-banner states (before start → first stop, at a
   stop → the following stop, driving → the current leg's destination).
   Omitted entirely without a valid fix. Verified against a two-day KML
   fixture with a mocked geolocation position and a fixed clock, driven
   through all four banner states plus the no-permission case — 12 checks.

2. **Weather forecast in the printable itinerary and ICS calendar export.**
   The in-app weather panel and trip-wide strip (added two nights ago) only
   ever showed up on screen. `buildDayItinerary()` — the shared per-day
   data source for both exports — now fetches the same forecast
   `renderWeather()` would, reusing `fetchWeather()`'s existing cache (no
   new API calls beyond what a same-session in-app visit already makes).
   Pulled `weatherSummaryText()` and `weatherWithinHorizon()` out as shared
   helpers so the in-app panel, the trip strip, and both exports render/gate
   identically instead of three near-copies of the same formatting and
   date-window logic. Verified both exports show a stubbed forecast
   correctly (printable HTML, the downloaded ICS file's `DESCRIPTION`), and
   confirmed no regression in the in-app panel/strip after the refactor —
   4 checks.

3. **Live currency conversion for the trip budget total.** Budget items are
   logged in whatever currency the fuel settings say (e.g. NOK for a Norway
   trip), but international travelers often want their home currency too.
   An optional "Show total in" code input in the budget modal converts via
   `api.frankfurter.dev` (free, keyless, CORS-enabled — same trust model as
   Nominatim/Open-Meteo/Overpass already used client-side elsewhere),
   cached per base/target pair for the session. Both currencies need to
   look like a 3-letter ISO code — the fuel-currency field has never been
   validated as one, so a non-code value shows guidance instead of a doomed
   request, and a failed lookup degrades to a plain message rather than
   breaking the always-correct-regardless total. The chosen target currency
   is a personal display preference, not trip data — one plain
   `tripplan-budget-convert-currency` localStorage key, restored on reopen,
   matching the fuel settings' own non-trip-scoped pattern. Verified via a
   stubbed frankfurter.dev response: happy path, invalid fuel currency,
   failing/unknown target, and the empty/same-as-base no-op cases — 9 checks.

4. **Pharmacy and hospital added to the nearby-amenities lookup.** The
   existing "🔎 nearby" button (fuel/food/parking/restrooms/supermarkets
   around a stop, via Overpass) was a natural fit for "where's the nearest
   pharmacy or hospital" too — OSM's own `amenity=pharmacy`/`hospital` tags
   slotted straight into the existing query regex with no special-casing.
   Small, but genuinely useful mid-road-trip. Verified with a stubbed
   Overpass response mixing new and existing amenity types — both render
   with correct icons alongside each other, and the query string includes
   both new types.

5. **CSV export for the budget tracker.** No way existed to get logged
   costs out of the app except reading them off the modal — useful to drop
   into a spreadsheet for an expense report or to split costs with travel
   companions. A "⬇️ CSV" button in the budget modal header
   (`exportBudgetCsv`/`buildBudgetCsv`) downloads every item as a CSV file,
   same client-side blob-download pattern GPX/ICS/backup export already
   use. `csvField()` quotes a label/category only when it actually needs it
   (comma, quote, newline) rather than assuming costs are always
   comma-safe. Verified the empty-budget case (friendly message, no broken
   download), a real export with a comma-containing and an
   embedded-quote-containing label (correct escaping round-tripped through
   the downloaded file), and — since this one touched the modal header
   layout — a screenshot confirming the new button doesn't crowd the
   existing × close button.

37 checks total across the five features, all passing. Confirmed all five commits deployed
successfully via `deploy-beta.yml`, and confirmed the live beta URL serves
each feature's new element IDs/function names (`budgetCsvBtn`, `pharmacy`,
`liveNextStopLine`, `weatherSummaryText`) after the final push.

**Decided not to do, and why:**
- **Deduplicating the GPX/ICS/backup export's repeated 6-line
  blob-download block** into a shared helper when adding the budget CSV
  export (a fourth near-identical copy). Would have touched three already-
  deployed, working export paths purely for DRY — kept the new CSV export
  self-contained instead, to keep tonight's diff minimal and the risk of
  regressing something already live at zero.
- **A full mpg fuel-consumption unit.** Still flagged from two nights ago
  as a genuinely different convention from L/100km, not just a display
  conversion — still out of scope for a session already carrying five
  other changes.
- **A dedicated "emergency info" feature** (embassy contacts, country-
  specific emergency numbers) instead of just adding pharmacy/hospital to
  the existing nearby-amenities lookup. Hardcoded per-country data would
  cut against this app's KML-driven, nothing-hardcoded design — the
  amenity-lookup extension gets most of the real value with none of that.

## 2026-08-18

`beta` was at ad02de1 going in (last night's four features: search confirm,
reorder buttons, fuel-budget link, nearby amenities). Fetched the real
feature-request backlog from mainline (`GET /tickets`): of 12 tickets, one
was actionable (`mswuwmi5itojje`, "Search function", `new`) — everything
else already `done` or `in_beta`. A notably productive session — five
commits, each tested and pushed separately, each deploy confirmed green via
`deploy-beta.yml` before moving on:

1. **Mainline ticket `mswuwmi5itojje` ("Search function").** The user's
   report: searching for a supermarket chain name while in Norway returned
   branches from the UK and Hungary — the "🔍 Search" flow's Nominatim call
   had no locality bias at all. `searchAnchorPoint()` now resolves to the
   active day's overnight hotel (falling back to that day's wake hotel,
   then its last real stop, then any place in the trip — literally "current
   end of day's hotel" per the ticket), and `nominatimSearchBiased` tries a
   `viewbox`/`bounded=1` Nominatim search around it first (`viewboxAround`,
   ~1.5° of latitude widened in longitude by `1/cos(lat)` so the box stays
   roughly square in real distance this far north), falling back to a plain
   unbounded search only when nothing turns up nearby — so a place
   genuinely outside today's area still resolves. **Marked `in_beta`** on
   mainline once pushed and confirmed live. Left `geocodeAddress` (the
   Maps-link import's title fallback) unbiased and unchanged, per the
   existing reasoning that path already has an exact redirect URL behind it.

2. **Trip countdown banner + a per-day ferry flag.** Two small, independent
   additions bundled into one commit since both touch the same small area
   (trip overview panel / day tabs) and were developed together. The trip
   overview now opens with "trip starts in N days" / "day N of M — today" /
   "trip ended N days ago" (`tripCountdownLine`) — a quick answer to "how
   close is this trip" without doing date math by hand. A "⛴ Ferry"
   checkbox next to each day's start-time input flags a day as including a
   ferry crossing — deliberately manual, not inferred (detecting "this road
   segment is a ferry" would need road-type data OpenRouteService doesn't
   expose here) — with a badge on the day tab, a reminder line in the drive
   summary and printable itinerary, and a count in the trip overview,
   mirroring the long-driving-day warning's existing pattern. Motivated
   directly by CLAUDE.md's own flagged concern that Day 7 of the user's
   trip "possibly involves a ferry" — this handles that day and any other
   road trip with a ferry leg, without hardcoding anything trip-specific.

3. **Native share sheet for "📋 Copy day plan".** The button's whole point
   is getting today's plan to travel companions — `navigator.share` (where
   supported, mostly phones) now offers the native share sheet
   (WhatsApp/SMS/Email/etc.) in one tap instead of "copy, switch app,
   paste". Falls straight through to the existing clipboard-copy behavior
   on desktop (where `navigator.share` mostly isn't implemented) or on any
   share failure; a cancelled share sheet (`AbortError`) is left alone
   rather than falling back to clipboard, matching how a cancelled native
   share normally behaves.

4. **A km/mi distance-unit toggle.** Flagged twice in this log before as "a
   full session's own scope" — genuinely useful for a general-purpose (not
   Norway-specific) planner, but distance text was scattered across roughly
   ten display sites. Tonight had the headroom to do it properly.
   `formatDistanceKm(km, decimals?)` is now the single place a km number
   ever gets rounded and unit-suffixed for display — every internal
   calculation (routing, fuel cost, haversine, near-duplicate detection,
   the map's route-arrow spacing) stays in km always, so this is purely a
   display layer. Wired into the drive summary, trip overview, route-list
   leg info, the optimize-order confirm dialog, the printable itinerary,
   the ICS export, and the copy-day-plan text. `buildDayItinerary`'s
   `distanceKm`/`legKm` fields now hold raw km numbers instead of
   pre-rounded strings specifically so every consumer can format per the
   active unit rather than being locked into whatever was baked in at
   build time. Deliberately scoped down from "full unit system": the
   fuel-consumption field stays L/100km always (mpg is a genuinely
   different convention, not just a display conversion), and sub-1km
   distances (near-duplicate badge, close-range nearby-amenities results)
   stay in meters regardless of the toggle, since nobody thinks in
   fractional miles at that scale.

5. **A whole-trip weather strip.** The existing weather panel only ever
   showed the active day's forecast — useful, but spotting a rainy stretch
   meant clicking through every day one at a time. `renderTripWeatherStrip`
   adds a compact per-day chip row (icon + high/low) above it for every day
   within Open-Meteo's ~16-day horizon. Reuses `fetchWeather`'s exact same
   call/cache as the single-day panel (no duplicate fetching either way),
   sequential rather than parallel fetches to stay polite to a keyless
   public API. Each chip's reference point is that day's *starting*
   location (`getRouteIds(day)[0]`, the previous night's hotel) — same
   convention the single-day panel already uses, so e.g. day 2's forecast
   reflects where day 2 begins that morning, not day 2's own destination. A
   day whose fetch fails is silently omitted rather than shown broken.

All five verified locally against the file-based dev-server
(`AUTH_DEV_FAKE=1`) with Playwright, each in its own throwaway test script:
the search-bias fix against a two-day KML fixture (anchor resolution, a
stubbed Nominatim confirming the anchored box is actually sent and actually
filters results, the anchor moving with the active day, and the
anchored-empty→unbounded-fallback path — 6 checks); the countdown banner
and ferry flag together (a pinned browser clock so "today" is deterministic
regardless of when the test runs, all three countdown branches, the ferry
badge/checkbox/count round-tripping through real clicks and re-renders — 10
checks, plus 1 more for the future-trip countdown branch specifically);
native share across three real scenarios — share available, share
unavailable (clipboard fallback), and a cancelled share sheet not falling
back — 8 checks; the units toggle against a stubbed OpenRouteService
response with a hand-computable 42km/26mi conversion, exercised through the
real toggle-button click (not direct state mutation), surviving a page
reload, and round-tripping back to km with no drift, plus separate checks
for the printable itinerary, ICS export, and `formatDistanceKm`'s edge
cases (null/NaN/zero) — 24 checks total; the weather strip against a
four-day fixture with one stubbed forecast failure, confirming the failed
day is omitted without breaking the others, the active-day chip highlight,
and that switching to an already-fetched day doesn't re-hit the API — 9
checks. 57 checks total, all passing. Caught one real test-authoring
mistake along the way (not an app bug): the weather-strip test initially
assumed each day's forecast reflects *that day's own* destination, and
failed until re-checked against `getRouteIds(day)[0]`'s actual semantics
(the day's *starting* point) — the app's behavior was correct and
consistent with the pre-existing single-day panel throughout; the test's
mental model was wrong. Re-ran the full existing test suite (all prior
nights' throwaway scripts still on disk) after the final change to confirm
no cross-feature regressions — 61 checks, all passing. Confirmed all five
commits deployed successfully via `deploy-beta.yml`, and spot-checked the
live beta HTML for new element IDs/function names (`unitsToggle`,
`dayFerryInput`, `formatDistanceKm`, `searchAnchorPoint`, `navigator.share`)
after pushing.

**Decided not to do, and why:**
- **A full mpg fuel-consumption unit** to go with the km/mi toggle. A
  genuinely different convention from L/100km, not just a display
  conversion — bigger scope than a distance-display toggle; left for a
  future session if it's wanted.
- **Converting the near-duplicate-place badge or close-range
  nearby-amenities results to miles.** Both operate at sub-1km scale
  (~50m and up to 1.5km respectively) where nobody thinks in fractional
  miles — left in meters regardless of the unit toggle.

## 2026-08-17

`beta` was at 3d51e7a going in (last night's four features: optimize order,
undo toast, trip driving total, duplicate trip) — one commit ahead of the
last promotion to `master` (five nights of nightly work were merged to
production via PR #7 earlier). Fetched the real feature-request backlog
from mainline (`GET /tickets`): of 11 tickets, one was actionable
(`msw6fddzu25mte`, "Search function confirmation", `new`) — everything
else already `done`. Four changes tonight, each committed and pushed
separately, each verified against the local dev-server with Playwright
(a fresh chromium + stubbed `window.L` + stubbed external APIs, per prior
nights' approach) before pushing, then spot-checked against the live beta
URL after each deploy:

1. **Mainline ticket `msw6fddzu25mte` ("Search function confirmation").**
   `searchPlaceByName` used to geocode a typed name/address and save
   Nominatim's single top match straight away — no way to see what was
   about to be added, or to pick between similarly-named places. Now asks
   Nominatim for up to 5 matches (`geocodeCandidates`) and opens a confirm
   modal (`openSearchResultsModal`) before saving anything: a clickable
   list when there's more than one candidate, and for whichever is
   selected — always, even for a single match, since the ticket asked for
   confirmation as the core behavior, not just a picker — a small Leaflet
   preview map, the full address, an editable name field, and a
   best-effort photo pulled from Wikipedia's public REST summary API when
   OSM tagged the place with a `wikipedia` tag. **Marked `in_beta` on
   mainline** once pushed and confirmed live. Left the Maps-link import's
   own geocoding fallback (`geocodeAddress`) untouched — that path already
   has an exact redirect URL behind it before it ever needs to geocode a
   bare title, so it doesn't have the same "which one did you mean"
   problem this ticket was about.

2. **▲/▼ buttons to reorder a day's stops, alongside drag-and-drop.**
   Reordering was drag-only — fine with a mouse, unreachable by keyboard
   and fiddly on touch. Added real `<button>` elements per row
   (`moveStopInDay`) that swap a stop with its neighbor, always
   recomputing `dayStops()` fresh rather than trusting a closured index so
   a stale click can't swap the wrong pair. Reuses `commitDragOrder`'s
   existing "write the filtered stop list straight back to `plans[day]`"
   contract, so the two reordering paths can't drift apart.

3. **Estimated fuel cost as a one-click budget line.** The fuel settings
   (⛽) already computed a whole-trip cost estimate for the trip overview
   panel, but the budget tracker had no way to know about it short of the
   user re-typing the number by hand — an easy way for the budget total to
   silently miss its largest line. The budget modal now shows that
   estimate with an "add to budget" action that writes a `Transport`-
   category line item under a fixed label, so a later change (a route
   recalculated, fuel settings edited) offers "update the logged estimate"
   instead of piling up duplicates.

4. **Nearby fuel/food/parking/restroom lookup per stop, via Overpass.**
   The biggest piece tonight, and a new external dependency: every
   route-item row (stops and pinned hotels) got a 🔎 button that queries
   Overpass (OSM's public, keyless, CORS-enabled query API — same no-auth
   trust model as Nominatim/Open-Meteo already used elsewhere) for named
   fuel, restaurant, cafe, fast food, parking, restroom, and supermarket
   nodes within 1.5km. Results sort nearest-first, cap at 15, and each has
   a "+ Add" that drops it into the day as a custom place with its exact
   OSM coordinates. Confirmed the query/response shape once against the
   live API (real data back from central Bergen) before building the
   parsing logic against it — but the public instance turned out
   noticeably flakier than Nominatim under repeated quick requests (hit a
   406 and a 504 retrying from this shell later in the session), so the
   modal's error path got real attention: a failed or slow lookup shows an
   inline message rather than affecting anything else on the page, and
   that path is covered by an explicit Playwright test (a stubbed 503),
   not just reasoned about.

All four verified locally against the file-based dev-server
(`AUTH_DEV_FAKE=1`) with Playwright, each in its own throwaway test script
(candidate picker + photo/map preview + validation + Escape-to-close for
the search confirm modal, 17 checks; up/down boundary behavior + reload
persistence + hotel rows correctly excluded for the reorder buttons, 9
checks; add/update/already-logged/remove-brings-back-the-offer for the
budget-fuel link, 11 checks; query scoping + unnamed-node filtering +
nearest-first sort + m/km distance formatting + add-to-day + the Overpass
failure and empty-result paths + Escape for the nearby lookup, 16 checks)
— 53 checks total, all passing, with each new feature's test re-run after
every later change tonight to catch cross-feature regressions before
pushing (none surfaced). Also re-learned the dev-server gotcha from
CLAUDE.md the hard way once: it copies `index.html` into memory at
startup, so a Playwright run against edits made after the server was
already up silently tested stale markup (buttons "not found" with no
console error) until the server was restarted — no code issue, just a
reminder for future nights to restart after every edit, not just once
per session. Confirmed all four commits deployed successfully via
`deploy-beta.yml` and spot-checked the live beta HTML for each feature's
new element IDs (`searchResultsModal`, `reorder-btns`, `budgetFuelSuggestion`,
`nearby-btn`) after the last push.

**Decided not to do, and why:**
- **A fifth feature.** One ticket plus three independent features — one of
  them (Overpass) a genuinely new external dependency that deserved a real
  look at its failure modes rather than being rushed to fit in a fifth —
  felt like the right scope for tonight.
- **A dedicated mobile screenshot pass for the new 🔎 button.** Route-item
  rows already absorb varying button counts via `.name{flex:1}` with
  every button `flex-shrink:0`, the same layout that already coexists with
  the nav button, stay-input, reorder buttons, and remove button on the
  same row — one more 22×22 icon button is a marginal addition to an
  already-proven layout, not the kind of first-time color-role audit the
  dark-mode work needed a full screenshot pass for.
- **A category filter or radius control on the nearby-amenities modal.**
  A fixed 1.5km / 7-type search covers the realistic "I'm about to leave
  this stop, what's nearby" case without adding UI just to configure a
  lookup most people will run as-is; can revisit if real usage shows the
  fixed radius is wrong for some places.

## 2026-08-16

`beta` was at d0534da going in — one commit ahead of the last nightly log
entry (56535ae): an interactive same-day session (not a nightly run, no log
entry, hence not otherwise mentioned here) had already landed "Navigate
per-item from current location, not the previous stop in the list" earlier
that evening. Fetched the real feature-request backlog from mainline
(`GET /tickets`): of 10 tickets, none were `new`/`in_progress` — the one
actionable ticket from a few nights ago (`mst440x8g0duze`, "Dates") is
already `in_beta`, and everything else is `done`. No mainline work to do
tonight, so all four changes below are this session's own picks. Each
committed and pushed separately, each verified against the local
dev-server with Playwright before pushing:

1. **"🔀 Optimize order" — reorder a day's stops for a shorter route.**
   Every stop so far has been ordered by hand (drag-and-drop, or whatever
   order Google My Maps happened to export). With a dozen KML-derived
   places this easily zig-zags without anyone noticing. `optimizeDayOrder`
   runs a nearest-neighbor construction plus 2-opt refinement over
   straight-line (`haversineKm`) distance — client-side only, no routing-
   API calls (scoring every candidate ordering against OpenRouteService
   would mean one request per candidate). The pinned wake/sleep hotel(s)
   anchor the path and are never among the reordered stops; loop days
   (same hotel both nights) anchor both ends to the same place. Framed
   explicitly as a heuristic starting point in its confirm dialog (shows
   the straight-line before/after distance), not a claim of true
   optimality — nudges the user to recalculate real driving times
   afterward. A day that's already optimal, or has fewer than two
   reorderable stops, gets an explanatory alert instead of the confirm.

2. **"Removed X · Undo" toast for the day's quick-remove actions.**
   Unchecking a place in the master list, or hitting the route list's ×
   button, is a single accidental click with no confirmation (correctly
   so — they're common, low-stakes actions and a confirm dialog on every
   one would be worse) but previously the only way back was re-finding the
   place in the master list. `showUndoToast` (bottom-center, auto-hides
   after 6s) re-splices the removed place back at its exact original
   index. The custom-place *permanent* delete already confirms before
   deleting, so it's deliberately left without a toast — doesn't need
   both safety nets. A second removal before undoing the first replaces
   the toast rather than stacking; only the most recent removal is
   undoable, matching a single-slot Ctrl+Z.

3. **Whole-trip driving total in the trip overview panel.** The overview
   showed day/place/overnight counts and flagged long driving days
   individually, but never totalled the trip's actual driving — a
   reasonable thing to want to know before committing to a multi-day
   route. Sums `dayDriveEstimate` (already used per-day for the long-drive
   badge) across every day: exact for any day matching the last-calculated
   route, straight-line-estimated otherwise, "≈"-prefixed with an
   "N/M days calculated exactly" note whenever some days are still
   estimates. `dayDriveEstimate` now also returns `.km` alongside its
   existing `.min`/`.exact`, so this reuses the exact same
   routed-vs-estimated branch rather than duplicating it.

   Caught and fixed one real gap while testing, before it reached `beta`:
   `calculateRoute()` only ever refreshed the route list and the active
   day's stats panel, never the trip overview — so this new total went
   stale (kept showing the pre-calculation estimate) right after
   calculating a day, until some unrelated action forced a full
   re-render. Now `calculateRoute()` also calls `renderTripOverview()` on
   success.

4. **"📑 Duplicate trip."** Trying an alternate stop order or an extra
   what-if day meant either mutating the only copy of a trip, or a
   backup-file-then-restore round-trip through the filesystem for what
   should be one click. `duplicateTrip()` doesn't reimplement any backup/
   restore logic: it calls the existing `buildTripBackup()`, wraps the
   result as an in-memory `File`, and hands it to `restoreTripBackup`
   exactly as if it had been picked from disk via "📥 Restore backup" —
   same validation, same "always creates new, never overwrites"
   guarantee, same local/remote dual-driver path. Named "<original>
   (copy)"; since restore already switches to whatever it just created,
   duplicating lands you directly on the new copy.

All four verified locally against the file-based dev-server
(`AUTH_DEV_FAKE=1`) with Playwright. The known sandbox limitation from
every prior night (no outbound browser access to the Leaflet CDN, so
`renderMapMarkers` throws on `L is not defined`) applied again, and this
time actually mattered for testing, not just as background noise: since
`calculateRoute()`/`activateCurrentTrip()` call `renderAll()` — which
calls `renderMapMarkers()` — any *unhandled* exception there aborts the
rest of that call chain, silently skipping code that runs after it (this
session's own `showUndoToast()` calls, for instance, sit after
`renderAll()` inside their click handlers). Worked around this properly,
not just around it, by stubbing a minimal `window.L` (`map`, `tileLayer`,
`layerGroup`, `marker`, `polyline`, `geoJSON`, `divIcon`, `icon`,
`latLngBounds`) via `page.addInitScript` before navigation, so the real
render path runs to completion and every downstream effect (toasts,
`renderTripOverview()` calls, DOM state) could be tested for real instead
of inferred. This also caught the `calculateRoute()`/trip-overview
staleness bug above — invisible without a working map stub, since
`calculateRoute()` never got far enough to reach the totals-affecting code
without one. Optimize-order was verified against hand-built zig-zag
coordinate sets (confirmed the algorithm actually shortens the path, that
a second click on an already-optimal day is a no-op, and both the loop-day
and no-anchor edge cases anchor correctly); the undo toast against single
and rapid-double removals from both the route list and the master list,
plus the 6s auto-hide timer; the trip-overview total against a stubbed
`/route` response distinguishing the exact-vs-estimated branch; duplicate
trip against a full round-trip including a custom place and a packing
item, plus confirming cancel is a true no-op. Confirmed all four commits
deployed successfully via `deploy-beta.yml`.

**Mainline tickets:** none open/actionable — nothing to mark `in_beta`
tonight.

**Decided not to do, and why:**
- **A km/mi + L/100km↔mpg units toggle.** Genuinely useful for a
  general-purpose (not Norway-specific) trip planner, but "km" is baked
  into ~60 places across the file (distance displays, fuel math, GPX/ICS/
  print text) and fuel efficiency has two incompatible conventions
  (L/100km vs. mpg) to get right, not just a display-unit swap. Doing it
  properly is a full session's own scope, not a fourth item alongside
  three others.
- **Nearby POI search (gas stations, restaurants) via the free/keyless
  Overpass API.** Same trust model as Nominatim/Open-Meteo already used
  here, and plausible for a future night, but needs its own result-list
  UI and add-as-custom-place flow — more surface than felt right to add
  as a fourth thing alongside tonight's other three.

## 2026-08-15

`beta` was at 8fcdb2e going in (last night's four features: now indicator,
sunrise/sunset, offline PWA support). Fetched the real feature-request
backlog from mainline (`GET /tickets`) — of 10 tickets, only one was
actionable (`new`/`in_progress`); everything else was already `done`. Three
changes tonight, each committed and pushed separately, each verified
against the local dev-server (Playwright, `AUTH_DEV_FAKE=1`) before pushing:

1. **Mainline ticket `mst440x8g0duze` ("Dates" — "Please add dates to each
   day").** `DAY_DATES` was already parsed from every KML upload but only
   ever reached the user as a raw `YYYY-MM-DD` string in one export path
   (copy-day-plan) — the primary day tabs, what someone actually looks at
   to navigate the trip, showed only "Day N" with no date at all. Added a
   shared `formatDayDate()` helper (e.g. "Sun, Aug 16") and wired it into
   the tab bar (a new small `.tab-date` sub-line under each tab), the route
   panel's day label, and the printable itinerary header, replacing the
   raw ISO string there too. **Marked `in_beta` on mainline** via the
   admin-token PATCH once pushed and confirmed live.

2. **Add a custom place by searching its name/address.** The two existing
   ways to add a custom place (map click, paste a Google Maps link) both
   assume you already have a location in hand. A new "🔍 Search" button
   next to "📍 From Maps" reuses `geocodeAddress()`/Nominatim — the same
   helper the Maps-link import already falls back to when a share link
   carries a place name but no coordinates — so this was mostly new UI
   wiring around an existing, previously-tested code path, not new
   geocoding logic.

3. **Whole-trip calendar (`.ics`) export.** Every export so far (print,
   GPX, backup) targets a specific tool; nothing put the trip on an actual
   phone calendar. "📅 Export calendar" (next to GPX export) downloads one
   `VEVENT` per day, spanning that day's planned start time to its computed
   end time, reusing `buildDayItinerary()` — the same per-day
   fetch-with-fallback GPX/print already use, so an unrouted day falls back
   to a rough 4h default duration instead of breaking the export. Uses
   floating local time (no `TZID`/`Z` on `DTSTART`/`DTEND`) rather than a
   full `VTIMEZONE` block — simplest thing that reads correctly on a phone
   calendar while the traveler's device is set to the trip's own timezone.

   Caught and fixed one real bug during testing, before it ever reached
   `beta`: naively picking "the first stop flagged `overnight`" mislabeled
   a day's destination as the *previous* night's hotel, since that hotel is
   pinned as the day's first stop and carries the same `overnight` flag
   (both the night-before and tonight's hotel are flagged `overnight` on
   the place object — only *which end of the stop list* they sit at tells
   you which is which). A hand-written two-day KML fixture (Norheimsund →
   Kinsarvik-style overnight pattern) reproduced it immediately: day 2's
   event was titled "drive to Hotel One" (last night's hotel) instead of
   "drive to Hotel Two" (tonight's). Fixed by using the day's *last* stop
   specifically, per `parseKmlTrip`'s contract that a folder's last
   placemark is that night's accommodation.

All three verified locally against the file-based dev-server with
Playwright: the day-date formatting across all three surfaces (tab,
route label, printable itinerary) against a two-day KML fixture; the
search-by-name flow's success path (stubbed Nominatim response, confirmed
the custom place lands in `customPlaces` with correct coordinates and gets
added to the active day) and its "no match" error path; and the ICS
export's routed path (stubbed OSRM response — real place names, real
per-leg distances/durations), its unrouted fallback path (aborted the
OSRM calls to force the default-duration branch), and its RFC 5545
escaping/line-folding (a place name with commas, semicolons, and a literal
backslash; a description long enough to force multi-line folding) —
downloaded files were read back off disk and inspected directly rather
than just eyeballing the generated string in-page. The known sandbox
limitation from prior nights (no outbound network from the *browser*
process to external hosts — Leaflet CDN, OSRM demo servers, Nominatim —
though `curl`/Node fetch from this shell do have proxy access) applied
here too: routing/geocoding calls in these tests were stubbed via
Playwright's `page.route()`, same approach prior nights used for the
weather feature. Confirmed all three commits deployed successfully via
`deploy-beta.yml`, and spot-checked the live beta HTML afterward for each
feature's new element IDs/function names (`tab-date`, `searchPlaceBtn`,
`exportIcsBtn`, `formatDayDate` all present).

**Decided not to do, and why:**
- **A fourth feature.** Three well-tested, independent changes — one of
  them (the ICS export) needing real care around a KML-semantics edge case
  that a shallower pass would have shipped wrong — felt like the right
  scope for tonight.
- **A full `VTIMEZONE` block in the ICS export**, instead of floating
  local time. Correct in principle, but meaningfully more complexity (VTZ
  definitions, DST rules) for a case — a traveler's phone is generally set
  to wherever they currently are — where floating time already does the
  right thing in every mainstream calendar app.
- **Per-day (as opposed to whole-trip) `.ics` export.** Considered as a
  companion to "Copy day plan," but the whole-trip file already contains
  every day as a separate event, and most calendar apps let you import a
  multi-event file and ignore the ones you don't want — a second export
  button for a subset of the same data felt like more surface than the
  benefit justified.

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
