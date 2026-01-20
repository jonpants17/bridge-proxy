// bridge-proxy/netlify/functions/getListing.js

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};

  const id = String(qs.id || "").trim();   // ListingKey
  const mls = String(qs.mls || "").trim(); // MLSNumber

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    // Optional: small CDN cache (helps repeat visits/refresh)
    "Cache-Control": "public, max-age=60",
  };

  if (!id && !mls) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: "Missing id or mls" }),
    };
  }

  const toArray = (data) =>
    Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : Array.isArray(data?.listings)
      ? data.listings
      : [];

  try {
    // ✅ FAST PATH (works for all listings): query the API for the exact record
    // Pick the most reliable lookup:
    // - If we have ListingKey (id), use it.
    // - Otherwise use MLSNumber.

    const isById = Boolean(id);
    const target = isById ? id : mls;

    // IMPORTANT:
    // This assumes your BRIDGE_BASE_URL points at the OData dataset base
    // e.g. .../api/v2/OData/<dataset>
    // If your base is .../api/v2/rae or .../api/v2/test, you may need to adjust base.
    const url = new URL(`${BRIDGE_BASE_URL}/Property`);
    url.searchParams.set("access_token", BRIDGE_API_KEY);
    url.searchParams.set("$top", "1");

    const filter = isById
      ? `ListingKey eq '${target}'`
      : `MLSNumber eq '${target}'`;

    url.searchParams.set("$filter", filter);

    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });

    if (r.ok) {
      const data = await r.json();
      const arr = toArray(data);
      const listing = arr[0];

      if (listing) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, listing }),
        };
      }
    }

    // 🛟 FALLBACK (keeps compatibility): scan pages (slow)
    // You can remove this later once the fast path is confirmed working.
    const limit = 200;
    const maxPagesToScan = 40;

    const targetAny = target;

    const matches = (l) => {
      const a = String(l?.ListingKey || "").trim();
      const b = String(l?.ListingId || "").trim();
      const c = String(l?.MLSNumber || "").trim();
      return a === targetAny || b === targetAny || c === targetAny;
    };

    for (let i = 0; i < maxPagesToScan; i++) {
      const offset = i * limit;

      const scanUrl = new URL(`${BRIDGE_BASE_URL}/listings`);
      scanUrl.searchParams.set("access_token", BRIDGE_API_KEY);
      scanUrl.searchParams.set("limit", String(limit));
      scanUrl.searchParams.set("offset", String(offset));

      const sr = await fetch(scanUrl.toString(), { headers: { Accept: "application/json" } });

      if (!sr.ok) {
        const text = await sr.text().catch(() => "");
        return {
          statusCode: sr.status,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Upstream error ${sr.status}`,
            details: text.slice(0, 500),
          }),
        };
      }

      const data = await sr.json();
      const bundle = toArray(data);
      const found = bundle.find(matches);

      if (found) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, listing: found }),
        };
      }

      if (bundle.length < limit) break;
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ success: false, listing: null }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
