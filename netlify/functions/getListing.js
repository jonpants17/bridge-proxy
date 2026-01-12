// netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};
  const raw = (qs.id || qs.mls || "").trim();

  if (!raw) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: false, error: "Missing id" }),
    };
  }

  // Normalize like your frontend: uppercase, strip spaces
  const target = String(raw).trim();

  // Helper: extract array
  const toArray = (data) =>
    Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : [];

  // Helper: match id against common fields
  const matches = (l) => {
    const a = String(l?.ListingKey || "").trim();
    const b = String(l?.ListingId || "").trim();
    const c = String(l?.MLSNumber || "").trim();
    return a === target || b === target || c === target;
  };

  try {
    // Scan a few pages (fast + reliable). Increase pages if needed.
    const limit = 200;
    const maxPagesToScan = 10; // 10 * 200 = 2000 listings scanned worst case

    for (let i = 0; i < maxPagesToScan; i++) {
      const offset = i * limit;

      const url = new URL(`${BRIDGE_BASE_URL}/Property`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("sortBy", "ModificationTimestamp");
      url.searchParams.set("sortOrder", "DESC");

      const r = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          statusCode: r.status,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            success: false,
            error: `Upstream error ${r.status}`,
            details: text.slice(0, 300),
          }),
        };
      }

      const data = await r.json();
      const bundle = toArray(data);

      const found = bundle.find(matches);
      if (found) {
        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ success: true, listing: found }),
        };
      }

      // If we got fewer than limit, we've hit the end
      if (bundle.length < limit) break;
    }

    return {
      statusCode: 404,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: false, listing: null }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
