// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

function toArray(data) {
  return Array.isArray(data?.bundle)
    ? data.bundle
    : Array.isArray(data?.value)
    ? data.value
    : Array.isArray(data?.listings)
    ? data.listings
    : [];
}

function normalizeMediaHttps(listing) {
  if (!listing || !Array.isArray(listing.Media)) return listing;
  listing.Media = listing.Media.map((m) => ({
    ...m,
    MediaURL: (m.MediaURL || "").replace(/^http:\/\//i, "https://"),
  }));
  return listing;
}

function looksLikeMls(s) {
  // ex: E4467116
  return /^[A-Z]\d{6,}$/.test(String(s || "").trim().toUpperCase());
}

async function fetchWithTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};
  const id = String(qs.id || "").trim();
  const mls = String(qs.mls || "").trim().toUpperCase();

  // ✅ Server-side "data freshness" timestamp (source of truth)
  const fetchedAt = new Date().toISOString();

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Vary": "Origin",
    // ✅ Cache: browsers 60s, CDN 15 min, serve stale while revalidating
    "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=300",
  };

  if (!id && !mls) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: "Missing id or mls", fetchedAt }),
    };
  }

  try {
    // ------------------------------------------------------------
    // 1) FAST PATH: ListingKey direct (this kills the 8,000-scan)
    // ------------------------------------------------------------
    if (id) {
      const url = new URL(`${BRIDGE_BASE_URL}/listings/${encodeURIComponent(id)}`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);

      const t0 = Date.now();
      const r = await fetchWithTimeout(url.toString(), 12000);
      const bridgeMs = Date.now() - t0;

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        // If id fails but mls exists, fall through to MLS lookup instead of scanning pages
        if (!mls) {
          return {
            statusCode: r.status,
            headers: { ...headers, "Server-Timing": `bridge;dur=${bridgeMs}` },
            body: JSON.stringify({
              success: false,
              error: `Upstream error ${r.status}`,
              details: text.slice(0, 500),
              fetchedAt,
            }),
          };
        }
      } else {
        const data = await r.json();
        const listing = normalizeMediaHttps(data);
        return {
          statusCode: 200,
          headers: { ...headers, "Server-Timing": `bridge;dur=${bridgeMs}` },
          body: JSON.stringify({ success: true, listing, fetchedAt }),
        };
      }
    }

    // ------------------------------------------------------------
    // 2) MLS PATH: one filtered query (no page scanning)
    // ------------------------------------------------------------
    if (mls && looksLikeMls(mls)) {
      // NOTE: Bridge filter syntax can vary by dataset.
      // Your base URL shows /api/v2/rae and you’re using /listings,
      // so we’ll use the common "filter" approach.
      const url = new URL(`${BRIDGE_BASE_URL}/listings`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);
      url.searchParams.set("limit", "1");

      // Most Bridge datasets accept OData-ish filter
      url.searchParams.set("filter", `ListingId eq '${mls}'`);

      const t0 = Date.now();
      const r = await fetchWithTimeout(url.toString(), 12000);
      const bridgeMs = Date.now() - t0;

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          statusCode: r.status,
          headers: { ...headers, "Server-Timing": `bridge;dur=${bridgeMs}` },
          body: JSON.stringify({
            success: false,
            error: `Upstream error ${r.status}`,
            details: text.slice(0, 500),
            fetchedAt,
          }),
        };
      }

      const data = await r.json();
      const bundle = toArray(data);
      const found = bundle[0] ? normalizeMediaHttps(bundle[0]) : null;

      if (!found) {
        return {
          statusCode: 404,
          headers: { ...headers, "Server-Timing": `bridge;dur=${bridgeMs}` },
          body: JSON.stringify({ success: false, listing: null, fetchedAt }),
        };
      }

      return {
        statusCode: 200,
        headers: { ...headers, "Server-Timing": `bridge;dur=${bridgeMs}` },
        body: JSON.stringify({ success: true, listing: found, fetchedAt }),
      };
    }

    // If we got here, we had params but couldn’t use them
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Invalid mls format and id lookup failed",
        fetchedAt,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message, fetchedAt }),
    };
  }
};
