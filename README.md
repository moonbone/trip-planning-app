# Trip Planner

A small app for planning daily driving routes from your own KML data: upload a Google My
Maps export, pick stops per day, reorder them, and get real driving times/distances. Map
is OpenStreetMap via Leaflet; routing is OpenRouteService, called through a server-side
proxy so the API key never reaches the browser or git.

## Structure

```
index.html                    the app itself (static, no build step)
aws/handler.mjs                Lambda handler — serves index.html + proxies POST /route
aws/deploy.sh                  idempotent deploy script (create or update)
aws/iam-policy.json            least-privilege policy for whoever deploys
.github/workflows/deploy.yml   auto-deploy on push to main
worker/                        alternate deploy path (Cloudflare Workers), kept for reference
```

## How it works

One Lambda function, fronted by a public **Function URL** (no API Gateway, no VPC):
- `GET /` → serves `index.html`
- `POST /route` → forwards to OpenRouteService using `ORS_API_KEY`, a Lambda environment
  variable that's set at deploy time and never appears in this repo

Because the page and the API are served from the same origin, there's no CORS setup needed
and no separate hosting service for the frontend.

## Local testing / laptop hosting

Runs the same `aws/handler.mjs` Lambda handler locally, so you can test `POST /route`
against real OpenRouteService before deploying — or use this as the actual deployment,
serving the app straight from your machine (e.g. with a router port-forward):

```bash
cp .env.example .env   # if you haven't already, then fill in your real key
./certs/generate-cert.sh   # once, to enable HTTPS (see below)
node --env-file=.env dev-server.mjs
```

Then open the printed URL. `.env` is gitignored — the key never leaves your machine.

**HTTPS**: if `certs/cert.pem` and `certs/key.pem` exist, the server uses them automatically;
otherwise it falls back to plain HTTP. `certs/generate-cert.sh` creates a self-signed cert
covering `localhost`, `127.0.0.1`, and whatever IPs are baked into its `SAN` (edit the
script or pass `SAN=...` if your local/public IP changes). Since it's self-signed, browsers
show a security warning on first visit — that's expected; there's no way around it short of
a CA-issued cert (e.g. Let's Encrypt), which needs a real domain name. `certs/*.pem` is
gitignored; only the generation script is committed.

## Option A — deploy from your machine

Requires the AWS CLI configured with credentials that can manage Lambda/IAM
(`aws/iam-policy.json` is a scoped-down policy you can attach instead of using admin creds).

```bash
export ORS_API_KEY=your-openrouteservice-key    # never commit this
export AWS_REGION=us-east-1                      # optional, defaults to us-east-1
./aws/deploy.sh
```

It prints your live URL at the end, e.g. `https://abc123.lambda-url.us-east-1.on.aws/`.
Run it again any time you change `index.html` or `aws/handler.mjs` — it updates in place.

Don't have an OpenRouteService key yet? Free, 2,000 requests/day:
https://openrouteservice.org/dev/#/signup

## Option B — deploy via GitHub Actions (push to deploy)

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Secrets and variables → Actions** and add:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION` (e.g. `us-east-1`)
   - `ORS_API_KEY`
3. Push to `main` (or run the workflow manually from the **Actions** tab).

None of these secrets are ever written to any file in the repo — GitHub injects them as
environment variables only during the workflow run.

## First-time setup

```bash
git init
git add .
git commit -m "Trip planner"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## Notes

- Your day-by-day stop selections are saved in the browser's `localStorage` —
  per-device, not synced anywhere.
- If the proxy route is ever unreachable, the app automatically falls back to the free
  public OSRM demo servers, so it keeps working (just less reliably) with zero setup.
- The Function URL is created with `auth-type NONE` (public) since this is a read-mostly
  personal planning tool. If you want to restrict access later, switch to `AWS_IAM` auth
  or put CloudFront + a WAF rule in front of it.
- Nothing in this repo can reveal your ORS key — it lives only as a Lambda environment
  variable (Option A) or a GitHub Actions secret (Option B).
