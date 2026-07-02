/**
 * Norway Route Planner — routing proxy
 *
 * Holds the OpenRouteService API key as a Cloudflare secret (env.ORS_API_KEY)
 * so it is never shipped to the browser or committed to git.
 *
 * Deploy:
 *   wrangler secret put ORS_API_KEY      # paste your key when prompted
 *   wrangler deploy
 *
 * Then set PROXY_URL in index.html to this worker's URL + "/route".
 */

const ALLOWED_ORIGIN = "*"; // tighten to your GitHub Pages origin, e.g. "https://yourname.github.io"

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/route" || request.method !== "POST") {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    if (!env.ORS_API_KEY) {
      return new Response(JSON.stringify({ error: "ORS_API_KEY not configured on server" }), {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    if (!body.coordinates || !Array.isArray(body.coordinates) || body.coordinates.length < 2) {
      return new Response(JSON.stringify({ error: "Body must include a coordinates array with at least 2 points" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    try {
      const orsRes = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
        method: "POST",
        headers: {
          Authorization: env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ coordinates: body.coordinates }),
      });

      const text = await orsRes.text();
      return new Response(text, {
        status: orsRes.status,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Upstream request failed: " + e.message }), {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }
  },
};
