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

const __dirname = dirname(fileURLToPath(import.meta.url));
// deploy.sh copies the repo's index.html next to this file before zipping,
// so this read works both locally and in the deployed package.
const INDEX_HTML = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Trip location data (place names/coordinates) is gitignored — it's personal
// itinerary info that shouldn't live in this public repo. Locally it's read
// from ../data/places.json (see data/places.example.json for the shape);
// deploy.sh copies that same file in flat next to this handler before
// zipping, so try both locations. If neither exists (e.g. a fresh clone, or
// a CI-triggered deploy that never had the file), /places degrades to a
// clean 503 instead of crashing the whole Lambda on cold start.
const PLACES_JSON = (() => {
  const candidates = [
    process.env.PLACES_PATH,
    join(__dirname, 'places.json'),
    join(__dirname, '..', 'data', 'places.json'),
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // try next candidate
    }
  }
  return null;
})();

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

  if (method === 'GET' && rawPath === '/places') {
    if (!PLACES_JSON) {
      return jsonError(503, 'Places data not configured on this deployment (missing data/places.json).');
    }
    return { statusCode: 200, headers: { ...JSON_HEADERS, ...corsHeaders() }, body: PLACES_JSON };
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

function handleListTickets() {
  const tickets = listTickets();
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
