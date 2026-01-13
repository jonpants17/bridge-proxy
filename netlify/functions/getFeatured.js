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

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  const HEADERS_OK = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    // Fast load: browser + Netlify CDN cache
    "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=86400",
  };

  const HEADERS_ERR = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  try {
    const qsp = event?.queryStringParameters || {};

    // Use ids passed from homepage: ?ids=E4467116,E123...
    // OR fallback to env var FEATURED_IDS="E4467116,E123..."
    const rawIds =
      String(qsp.ids || "").trim() ||
      String(process.env.FEATURED_IDS || "").trim();

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

    // Build OData filter
    const orGroups = ids.map((id) => {
      const safe = id.replace(/'/g, "''");
      return `(ListingKey eq '${safe}' or ListingId eq '${safe}' or MLSNumber eq '${safe}')`;
    });

    const url = new URL(`${BRIDGE_BASE_URL}/Property`);
    url.searchParams.set("access_token", BRIDGE_API_KEY);
    url.searchParams.set("limit", String(Math.max(20, ids.length * 4)));
    url.searchParams.set("$filter", `(${orGroups.join(" or ")})`);

    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const data = await r.json().catch(() => ({}));

    const bundle = Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : [];

    // ✅ Index each listing by ALL IDs so MLS/ListingId/ListingKey all match
    const map = new Map();
    for (const l of bundle) {
      if (!isInternetDisplayable(l)) continue;

      const k1 = normalizeId(l.ListingKey);
      const k2 = normalizeId(l.ListingId);
      const k3 = normalizeId(l.MLSNumber);

      if (k1) map.set(k1, l);
      if (k2) map.set(k2, l);
      if (k3) map.set(k3, l);
    }

    // Preserve FEATURED_IDS order
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
      headers: HEADERS_ERR,
      body: JSON.stringify({ success: false, listings: [], error: error.message }),
    };
  }
};
