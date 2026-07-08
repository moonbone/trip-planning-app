# Users, auth & sharing — design decisions and roadmap

Status: **decided, not yet built**. Work happens on the `auth-and-sharing` branch.
This doc is the single reference for the effort; update it as decisions change.

## Decided (2026-07-08, interactive session)

| Topic | Decision |
|---|---|
| Auth method | Google Sign-In only (Google Identity Services ID token, verified server-side, exchanged for our own session cookie) |
| Signed-out mode | **Stays fully functional** — current localStorage-only planner, no account needed. Login is opt-in, required only for sync/sharing |
| Share unit | Whole trip, fully shared — all variants are common property of everyone with access |
| Roles | Viewer (read-only) / Editor (edit plans & variants) / Co-owner (also share, rename, manage) — only the owner can delete or transfer the trip |
| Invites | By Google email; pending invites (access granted when that account first logs in). No share links |
| Concurrency | Optimistic locking — writes carry a version; stale writes are rejected and the client shows a reload-and-reapply conflict flow |
| Database | DynamoDB (on-demand; fits single-Lambda, $0 idle, scoped IAM) |
| Public origin | CloudFront distribution with default `*.cloudfront.net` domain (free, stable, valid Google OAuth origin). Origin switchable: laptop via free DDNS hostname (auth testing from phones) ↔ Lambda Function URL (production). Custom domain can be layered on later without rework |
| Admin | `ADMIN_EMAILS` env var — matching Google email gets the backoffice |
| Local-trip migration | On first login in a browser with local trips: **prompt** to import them into the account; declining leaves local data untouched |
| AWS | Account lockout resolved — deployment is unblocked |

## Architecture sketch

- **Auth flow**: GIS button → ID token → `POST /auth/google` verifies signature/audience
  server-side → upsert user → set HttpOnly Secure SameSite session cookie (signed,
  `SESSION_SECRET` env var). `GET /me`, `POST /auth/logout`. CSRF token for mutating
  endpoints.
- **DynamoDB** (single-table or few tables, on-demand):
  - `users`: google_sub (pk), email, name, created_at, disabled
  - `trips`: trip_id (pk), owner_sub, name, filename, kml_source, version, created_at
  - `variants`: trip_id (pk), variant_id (sk), name, plans, dayMeta, version
  - `shares`: trip_id (pk), email (sk), role, status (pending/active), invited_by
  - tickets move from SQLite to DynamoDB and gain a user reference
- **API** (same single Lambda handler): trips/variants/shares CRUD with per-request
  role resolution; version checks on writes (409 on stale); admin endpoints for the
  backoffice; per-user rate limit on `/route`.
- **Frontend**: logged-out → existing localStorage layer untouched; logged-in → same
  storage interface backed by the API (optimistic UI, version tracking), share dialog
  per trip, import-local-trips prompt, backoffice view (view-toggle precedent: tickets
  view). Consider splitting index.html when the backoffice lands.

## Phases

0. **Security fixes needed today, regardless** (small, do first — arguably on master):
   escape place/trip/variant names currently interpolated via innerHTML (stored-XSS
   vector once trips are shared); make `PATCH /tickets/:id` admin-only; stop exposing
   submitter emails on public `GET /tickets`; note `/route` quota abuse (fix properly
   with per-user limits in phase 3).
1. **Deploy the current app**: run `aws/deploy.sh` for real; CloudFront distribution in
   front (origin = Function URL); DDNS hostname for the laptop origin option; verify
   the app works at the cloudfront.net URL.
2. **Auth**: Google Cloud OAuth client (origins: cloudfront.net URL + localhost);
   DynamoDB users table; `/auth/*` + `/me`; session middleware; login UI + signed-out
   mode unchanged; `ADMIN_EMAILS` check.
3. **Server-side trips**: trips/variants tables + CRUD with optimistic locking;
   logged-in storage layer in the frontend; import-local-trips prompt; per-user
   `/route` quota.
4. **Sharing**: shares table, invite/accept/revoke flows, role enforcement on every
   endpoint, share dialog UI, pending-invite handling on first login.
5. **Backoffice**: user list, disable/delete (cascading to owned trips/shares — offer
   ownership transfer), ticket management (status changes move here), basic usage
   stats.

## Known risks / open items

- Storing trips server-side reverses the long-standing "itinerary data never touches
  the server" stance — accepted for sharing; revisit encryption-at-rest if it ever
  matters.
- `node:sqlite` tickets code is replaced by DynamoDB in phase 2/3 — the Node 22
  constraint disappears with it.
- CloudFront origin-switching is manual (console/CLI) — document the two-command swap.
- iam-policy.json needs DynamoDB (+ CloudFront if managed by deploy script) additions.
- New secrets: `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS` → Lambda env +
  GitHub Actions secrets.
