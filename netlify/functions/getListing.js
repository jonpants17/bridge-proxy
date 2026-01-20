// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};
  const target = String((qs.id || qs.mls || "")).trim();

  const headersBase = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!target) {
    return {
      statusCode: 400,
      headers: headersBase,
      body: JSON.stringify({ success: false, error: "Missing id" }),
    };
  }

  // Helper to normalize Bridge response shapes
  const toArray = (data) =>
    Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : Array.isArray(data?.listings)
      ? data.listings
      : [];

  // Try targeted queries first (no paging scans)
  const attempts = [
    // Many datasets support these exact fields:
    { field: "ListingKey", value: target },
    { field: "ListingId", value: target },
    { field: "MLSNumber", value: target },
  ];

  try {
    for (const a of attempts) {
      const url = new URL(`${BRIDGE_BASE_URL}/listings`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);

      // Bridge commonly supports simple filter syntax on "filter"
      // If your dataset uses a different param name, we’ll adjust.
      url.searchParams.set("filter", `${a.field} eq '${a.value.replace(/'/g, "''")}'`);
      url.searchParams.set("limit", "1");

      const r = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        // If filter isn't supported, we'll fall back later
        // but we don't want to hard-fail here.
        continue;
      }

      const data = await r.json();
      const arr = toArray(data);
      const found = arr[0];

      if (found) {
        return {
          statusCode: 200,
          headers: {
            ...headersBase,
            // ✅ Performance: short cache + SWR
            "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
          },
          body: JSON.stringify({ success: true, listing: found }),
        };
      }
    }

    // Fallback (only if filter isn't supported on your dataset):
    // Minimal scan (cap it hard so it can’t be “forever”)
    const limit = 200;
    const maxPagesToScan = 5; // hard cap: 1,000 records scanned max

    for (let i = 0; i < maxPagesToScan; i++) {
      const offset = i * limit;

      const url = new URL(`${BRIDGE_BASE_URL}/listings`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));

      const r = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!r.ok) break;

      const data = await r.json();
      const bundle = toArray(data);

      const found = bundle.find((l) => {
        const a = String(l?.ListingKey || "").trim();
        const b = String(l?.ListingId || "").trim();
        const c = String(l?.MLSNumber || "").trim();
        return a === target || b === target || c === target;
      });

      if (found) {
        return {
          statusCode: 200,
          headers: {
            ...headersBase,
            "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
          },
          body: JSON.stringify({ success: true, listing: found }),
        };
      }

      if (bundle.length < limit) break;
    }

    return {
      statusCode: 404,
      headers: headersBase,
      body: JSON.stringify({ success: false, listing: null }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: headersBase,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
