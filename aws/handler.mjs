// Norway Route Planner — AWS Lambda handler
//
// Serves the static app (GET /) and proxies routing requests (POST /route)
// to OpenRouteService using process.env.ORS_API_KEY, which is set as a Lambda
// environment variable at deploy time and never appears in this file or in git.
//
// Deployed behind a Lambda Function URL (no API Gateway needed). See deploy.sh.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateTicket, validateStatus } from './validate.mjs';
import { createTicket, listTickets, updateTicketStatus, isAvailable as ticketsAvailable, STATUSES } from './tickets-db.mjs';
import {
  verifyGoogleCredential, createSessionToken, sessionFromEvent,
  sessionSetCookie, sessionClearCookie, isAdminEmail,
} from './auth.mjs';
import {
  upsertUser, getUser, listUsers, newStoreId, VersionConflictError,
  createTrip, getTrip, listTripsForOwner, deleteTrip,
  listVariants, getVariant, putVariant, deleteVariant,
  listSharesForTrip, listSharesForEmail, putShare, deleteShare,
} from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// deploy.sh copies the repo's index.html next to this file before zipping,
// so this read works both locally and in the deployed package.
const INDEX_HTML = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Trip location data never touches the server: the browser parses a
// user-uploaded KML client-side and keeps it in localStorage.

// no-store: this app is under active development and this handler serves
// its own JS inline in the HTML, so a stale cached copy silently keeps
// running old client code (browsers, mobile Safari especially, can cache
// GET responses with no validator quite aggressively).
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
  const rawPath = event.rawPath ?? event.path ?? '/';

  if (method === 'GET' && (rawPath === '/' || rawPath === '/index.html')) {
    return { statusCode: 200, headers: HTML_HEADERS, body: INDEX_HTML };
  }

  if (rawPath === '/route') {
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders() };
    }
    if (method === 'POST') {
      return handleRoute(event);
    }
  }

  if (method === 'GET' && rawPath === '/auth/config') {
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS, ...corsHeaders() },
      body: JSON.stringify({
        googleClientId: process.env.GOOGLE_CLIENT_ID || null,
        devAuth: process.env.AUTH_DEV_FAKE === '1',
      }),
    };
  }

  if (method === 'POST' && rawPath === '/auth/google') {
    return handleGoogleLogin(event);
  }

  if (method === 'POST' && rawPath === '/auth/logout') {
    return {
      statusCode: 200,
      cookies: [sessionClearCookie()],
      headers: { ...JSON_HEADERS, ...corsHeaders() },
      body: JSON.stringify({ ok: true }),
    };
  }

  if (method === 'GET' && rawPath === '/me') {
    const session = sessionFromEvent(event, process.env.SESSION_SECRET);
    if (!session) return jsonError(401, 'Not signed in');
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS, ...corsHeaders() },
      body: JSON.stringify({
        user: { email: session.email, name: session.name },
        isAdmin: isAdminEmail(session.email),
      }),
    };
  }

  if (rawPath.startsWith('/api/trips')) {
    return handleTripsApi(event, method, rawPath);
  }

  if (rawPath.startsWith('/api/admin/')) {
    return handleAdminApi(event, method, rawPath);
  }

  if (rawPath === '/tickets') {
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders() };
    }
    if (method === 'GET') {
      return ticketsAvailable() ? handleListTickets() : ticketsUnavailable();
    }
    if (method === 'POST') {
      return ticketsAvailable() ? handleCreateTicket(event) : ticketsUnavailable();
    }
  }

  const ticketIdMatch = rawPath.match(/^\/tickets\/(\d+)$/);
  if (ticketIdMatch) {
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders() };
    }
    if (method === 'PATCH') {
      return ticketsAvailable() ? handleUpdateTicketStatus(event, Number(ticketIdMatch[1])) : ticketsUnavailable();
    }
  }

  return {
    statusCode: 404,
    headers: { ...JSON_HEADERS, ...corsHeaders() },
    body: JSON.stringify({ error: 'Not found' }),
  };
};

async function handleRoute(event) {
  if (!process.env.ORS_API_KEY) {
    return jsonError(500, 'ORS_API_KEY not configured on this Lambda');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  if (!Array.isArray(body.coordinates) || body.coordinates.length < 2) {
    return jsonError(400, 'Body must include a coordinates array with at least 2 points');
  }

  try {
    const orsRes = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        Authorization: process.env.ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ coordinates: body.coordinates }),
    });
    const text = await orsRes.text();
    return {
      statusCode: orsRes.status,
      headers: { ...JSON_HEADERS, ...corsHeaders() },
      body: text,
    };
  } catch (e) {
    return jsonError(502, 'Upstream request failed: ' + e.message);
  }
}

async function handleGoogleLogin(event) {
  if (!process.env.SESSION_SECRET) {
    return jsonError(503, 'Sign-in is not configured on this server (missing SESSION_SECRET).');
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (!body.credential || typeof body.credential !== 'string') {
    return jsonError(400, 'Missing credential');
  }
  let identity;
  try {
    identity = await verifyGoogleCredential(body.credential, process.env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return jsonError(401, 'Sign-in failed: ' + e.message);
  }
  let user;
  try {
    user = await upsertUser(identity);
  } catch (e) {
    console.error('upsertUser failed', e);
    return jsonError(500, 'Could not save user');
  }
  if (user.disabled) {
    return jsonError(403, 'This account is disabled.');
  }
  return {
    statusCode: 200,
    cookies: [sessionSetCookie(createSessionToken(user, process.env.SESSION_SECRET))],
    headers: { ...JSON_HEADERS, ...corsHeaders() },
    body: JSON.stringify({
      user: { email: user.email, name: user.name },
      isAdmin: isAdminEmail(user.email),
    }),
  };
}

// ---- Trips API (auth-and-sharing phase 3) ----
// Owner-only for now; shares/roles arrive in phase 4. Writes to variants
// use optimistic locking: the client sends the version it read, a stale
// version gets a 409 with the current one.

const MAX_KML_BYTES = 1024 * 1024;
const MAX_NAME_LEN = 200;

// Sharing roles (phase 4): viewer < editor < co-owner < owner. Editors
// change plans/variants; co-owners also manage shares; only the owner
// deletes the trip. Shares are keyed by (trip, lowercased email) — an
// invite to an address that hasn't logged in yet simply starts working
// on their first login (pending-invite semantics for free).
const ROLE_RANK = { viewer: 1, editor: 2, 'co-owner': 3, owner: 4 };
const SHAREABLE_ROLES = ['viewer', 'editor', 'co-owner'];

async function tripRole(session, trip) {
  if (trip.owner_sub === session.sub) return 'owner';
  const shares = await listSharesForTrip(trip.trip_id);
  const share = shares.find((s) => s.email === (session.email || '').toLowerCase());
  return share ? share.role : null;
}

function ok(body, statusCode = 200) {
  return { statusCode, headers: { ...JSON_HEADERS, ...corsHeaders() }, body: JSON.stringify(body) };
}

async function handleTripsApi(event, method, rawPath) {
  const session = sessionFromEvent(event, process.env.SESSION_SECRET);
  if (!session) return jsonError(401, 'Sign in to sync trips');

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }
  }

  const parts = rawPath.split('/').filter(Boolean); // ['api','trips',id?,'variants'?,vid?]
  const tripId = parts[2];
  const variantId = parts[4];

  try {
    // /api/trips
    if (!tripId) {
      if (method === 'GET') {
        const owned = (await listTripsForOwner(session.sub)).map((t) => ({
          trip_id: t.trip_id, name: t.name, filename: t.filename,
          created_at: t.created_at, role: 'owner',
        }));
        const shared = [];
        for (const s of await listSharesForEmail(session.email || '')) {
          const t = await getTrip(s.trip_id);
          if (t) {
            shared.push({
              trip_id: t.trip_id, name: t.name, filename: t.filename,
              created_at: t.created_at, role: s.role,
            });
          }
        }
        return ok([...owned, ...shared]);
      }
      if (method === 'POST') {
        const { name, filename, kml_source } = body;
        if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LEN) {
          return jsonError(400, 'Invalid trip name');
        }
        if (typeof kml_source !== 'string' || !kml_source.trim()
            || Buffer.byteLength(kml_source, 'utf8') > MAX_KML_BYTES) {
          return jsonError(400, 'Invalid or too large KML source (max 1 MB)');
        }
        const trip = await createTrip({
          trip_id: newStoreId(),
          owner_sub: session.sub,
          name: name.trim(),
          filename: String(filename || '').slice(0, MAX_NAME_LEN),
          kml_source,
          created_at: new Date().toISOString(),
        });
        const variant = await putVariant(trip.trip_id, {
          variant_id: newStoreId(), name: 'Main', plans: null, dayMeta: {},
        }, null);
        return ok({ trip: { ...trip, kml_source: undefined }, variant }, 201);
      }
      return jsonError(405, 'Method not allowed');
    }

    // everything below needs the trip and at least viewer access
    const trip = await getTrip(tripId);
    const role = trip ? await tripRole(session, trip) : null;
    if (!role) return jsonError(404, 'Trip not found');

    // /api/trips/:id
    if (parts.length === 3) {
      if (method === 'GET') {
        return ok({ trip, variants: await listVariants(tripId), role });
      }
      if (method === 'DELETE') {
        if (role !== 'owner') return jsonError(403, 'Only the owner can delete a trip');
        await deleteTrip(tripId);
        return ok({ ok: true });
      }
      return jsonError(405, 'Method not allowed');
    }

    // /api/trips/:id/shares[/:email] — co-owner and up
    if (parts[3] === 'shares') {
      if (ROLE_RANK[role] < ROLE_RANK['co-owner']) return jsonError(403, 'Not allowed');
      if (!parts[4] && method === 'GET') return ok(await listSharesForTrip(tripId));
      if (!parts[4] && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, 'Invalid email');
        if (!SHAREABLE_ROLES.includes(body.role)) return jsonError(400, 'Role must be viewer, editor, or co-owner');
        if (email === (session.email || '').toLowerCase()) return jsonError(400, 'That is you');
        return ok(await putShare({
          trip_id: tripId, email, role: body.role,
          invited_by: session.email, created_at: new Date().toISOString(),
        }), 201);
      }
      if (parts[4] && method === 'DELETE') {
        await deleteShare(tripId, decodeURIComponent(parts[4]));
        return ok({ ok: true });
      }
      return jsonError(405, 'Method not allowed');
    }

    // /api/trips/:id/variants[/:vid] — writes need editor and up
    if (parts[3] !== 'variants') return jsonError(404, 'Not found');
    if (method !== 'GET' && ROLE_RANK[role] < ROLE_RANK.editor) {
      return jsonError(403, 'View-only access');
    }

    if (!variantId && method === 'POST') {
      const { name, plans, dayMeta } = body;
      if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LEN) {
        return jsonError(400, 'Invalid variant name');
      }
      const variant = await putVariant(tripId, {
        variant_id: newStoreId(), name: name.trim(),
        plans: plans ?? null, dayMeta: dayMeta ?? {},
      }, null);
      return ok(variant, 201);
    }

    if (variantId && method === 'PUT') {
      const existing = await getVariant(tripId, variantId);
      if (!existing) return jsonError(404, 'Variant not found');
      if (!Number.isInteger(body.version)) return jsonError(400, 'Missing version');
      const name = typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, MAX_NAME_LEN) : existing.name;
      const variant = await putVariant(tripId, {
        variant_id: variantId, name,
        plans: body.plans ?? existing.plans,
        dayMeta: body.dayMeta ?? existing.dayMeta,
      }, body.version);
      return ok(variant);
    }

    if (variantId && method === 'DELETE') {
      const variants = await listVariants(tripId);
      if (variants.length < 2) return jsonError(400, 'A trip needs at least one variant');
      await deleteVariant(tripId, variantId);
      return ok({ ok: true });
    }

    return jsonError(405, 'Method not allowed');
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return ok({ error: 'Version conflict', currentVersion: e.currentVersion }, 409);
    }
    console.error('trips api error', e);
    return jsonError(500, 'Internal error');
  }
}

// ---- Admin API (auth-and-sharing phase 5) ----
// Backoffice for accounts matching ADMIN_EMAILS. v1 supports disabling
// accounts (blocks future logins; existing sessions age out within the
// 30-day cookie TTL) — deletion with trip cascade/transfer comes later.

async function handleAdminApi(event, method, rawPath) {
  const session = sessionFromEvent(event, process.env.SESSION_SECRET);
  if (!session || !isAdminEmail(session.email)) return jsonError(403, 'Admins only');

  const parts = rawPath.split('/').filter(Boolean); // ['api','admin','users',sub?]
  if (parts[2] === 'users') {
    if (!parts[3] && method === 'GET') return ok(await listUsers());
    if (parts[3] && method === 'PATCH') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return jsonError(400, 'Invalid JSON body');
      }
      const user = await getUser(decodeURIComponent(parts[3]));
      if (!user) return jsonError(404, 'User not found');
      if (body.disabled && isAdminEmail(user.email)) return jsonError(400, 'Cannot disable an admin');
      user.disabled = !!body.disabled;
      return ok(await upsertUser(user));
    }
  }
  return jsonError(404, 'Not found');
}

function handleListTickets() {
  // Public listing: submitter emails are private, never expose them here.
  const tickets = listTickets().map(({ email, ...pub }) => pub);
  return {
    statusCode: 200,
    headers: { ...JSON_HEADERS, ...corsHeaders() },
    body: JSON.stringify(tickets),
  };
}

function handleCreateTicket(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { valid, errors, value } = validateTicket(body);
  if (!valid) {
    return {
      statusCode: 400,
      headers: { ...JSON_HEADERS, ...corsHeaders() },
      body: JSON.stringify({ errors }),
    };
  }

  const ticket = createTicket(value);
  return {
    statusCode: 201,
    headers: { ...JSON_HEADERS, ...corsHeaders() },
    body: JSON.stringify(ticket),
  };
}

function handleUpdateTicketStatus(event, id) {
  // Interim admin gate until real session auth (auth-and-sharing phase 2):
  // requires the x-admin-token header to match ADMIN_TOKEN. With the env
  // var unset, status updates are simply disabled.
  const adminToken = process.env.ADMIN_TOKEN;
  const given = event.headers?.['x-admin-token'] ?? event.headers?.['X-Admin-Token'];
  const session = sessionFromEvent(event, process.env.SESSION_SECRET);
  const isAdminSession = session && isAdminEmail(session.email);
  if (!isAdminSession && (!adminToken || given !== adminToken)) {
    return jsonError(403, 'Forbidden');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { valid, errors } = validateStatus(body.status, STATUSES);
  if (!valid) {
    return {
      statusCode: 400,
      headers: { ...JSON_HEADERS, ...corsHeaders() },
      body: JSON.stringify({ errors }),
    };
  }

  const ticket = updateTicketStatus(id, body.status);
  if (!ticket) {
    return jsonError(404, 'Ticket not found');
  }
  return {
    statusCode: 200,
    headers: { ...JSON_HEADERS, ...corsHeaders() },
    body: JSON.stringify(ticket),
  };
}

function ticketsUnavailable() {
  return jsonError(503, 'Feature requests are not available on this deployment.');
}

function jsonError(statusCode, message) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...corsHeaders() },
    body: JSON.stringify({ error: message }),
  };
}

function corsHeaders() {
  // Same-origin by default (Lambda serves both the page and /route), so this
  // mainly matters if you ever call /route from a different origin.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
