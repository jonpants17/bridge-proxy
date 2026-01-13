// netlify/functions/getFeatured.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

function isInternetDisplayable(l) {
  const v = String(
    l.InternetDisplayYN ??
      l.InternetEntireListingDisplayYN ??
      l.InternetEntireListingDisplay ??
      ""
  ).toUpperCase();
  return v !== "N" && v !== "0" && v !== "FALSE";
}

function normalizeId(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function addId(map, id, listing) {
  const key = normalizeId(id);
  if (key) map.set(key, listing);
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  // CDN + browser caching (speed win)
  const HEADERS_OK = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    // Browser 30s, Netlify Edge 5 min, allow serving stale while refreshing
    "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=86400",
  };

  try {
    const qsp = event?.queryStringParameters || {};

    // ids can come from query string OR env var FEATURED_IDS
    const rawIds =
      String(qsp.ids || "").trim() || String(process.env.FEATURED_IDS || "").trim();

    const limit = Math.max(1, Math.min(3, parseInt(qsp.limit || "3", 10) || 3));

    const ids = rawIds
      .split(",")
      .map(normalizeId)
      .filter(Boolean)
      .slice(0, 20);

    if (!ids.length) {
      return {
        statusCode: 200,
        headers: HEADERS_OK,
        body: JSON.stringify({ success: true, listings: [], totalMatches: 0 }),
      };
    }

    // Build OData filter for all ids
    const orGroups = ids.map((id) => {
      const safe = id.replace(/'/g, "''");
      return `(ListingKey eq '${safe}' or ListingId eq '${safe}' or MLSNumber eq '${safe}')`;
    });

    const url = new URL(`${BRIDGE_BASE_URL}/Property`);
    url.searchParams.set("access_token", BRIDGE_API_KEY);
    url.searchParams.set("limit", String(Math.max(50, ids.length * 10)));
    url.searchParams.set("$filter", `(${orGroups.join(" or ")})`);

    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const data = await r.json().catch(() => ({}));

    const bundle = Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : [];

    // Map listings by ALL possible IDs so pinned ids always resolve
    const map = new Map();
    for (const l of bundle) {
      if (!isInternetDisplayable(l)) continue;

      addId(map, l.ListingKey, l);
      addId(map, l.ListingId, l);
      addId(map, l.MLSNumber, l);
      addId(map, l.MlsId, l);
      addId(map, l.Id, l);
    }

    // Preserve caller order
    const ordered = ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .slice(0, limit);

    return {
      statusCode: 200,
      headers: HEADERS_OK,
      body: JSON.stringify({
        success: true,
        listings: ordered,
        totalMatches: ordered.length,
      }),
    };
  } catch (error) {
    console.error("getFeatured error:", error);
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ success: false, listings: [], error: error.message }),
    };
  }
};
