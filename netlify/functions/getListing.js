// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};
  const raw = (qs.id || qs.mls || "").trim();

  // ✅ Server-side "data freshness" timestamp (source of truth)
  const fetchedAt = new Date().toISOString();

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Vary": "Origin",
    // ✅ Cache: fast + still well within 24h RECA requirement
    // - browsers: 60s
    // - CDN (Netlify): 15 min
    // - allow serving slightly stale while revalidating (speed win)
    "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=300",
  };

  if (!raw) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Missing id or mls",
        fetchedAt,
      }),
    };
  }

  const target = String(raw).trim();

  const toArray = (data) =>
    Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : Array.isArray(data?.listings)
      ? data.listings
      : [];

  const matches = (l) => {
    const a = String(l?.ListingKey || "").trim();
    const b = String(l?.ListingId || "").trim();
    const c = String(l?.MLSNumber || "").trim();
    return a === target || b === target || c === target;
  };

  try {
    const limit = 200;
    const maxPagesToScan = 40; // keep identical so it won't "miss"

    for (let i = 0; i < maxPagesToScan; i++) {
      const offset = i * limit;

      const url = new URL(`${BRIDGE_BASE_URL}/listings`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));

      const r = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          statusCode: r.status,
          headers,
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
      const found = bundle.find(matches);

      if (found) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            listing: found,
            fetchedAt, // ✅ FEED freshness for the front-end stamp
          }),
        };
      }

      if (bundle.length < limit) break;
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        listing: null,
        fetchedAt,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        fetchedAt,
      }),
    };
  }
};
