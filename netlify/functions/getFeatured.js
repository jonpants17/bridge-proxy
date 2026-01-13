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

async function safeJson(res) {
  const t = await res.text().catch(() => "");
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

exports.handler = async function (event) {
  const HEADERS_OK = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control":
      "public, max-age=30, s-maxage=300, stale-while-revalidate=86400",
  };

  const HEADERS_ERR = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  try {
    const qsp = event?.queryStringParameters || {};

    // ids via query string: ?ids=E4467116,E123...
    // OR env var FEATURED_IDS
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

    // ✅ Call your existing getListing function (same logic as the listings page)
    // Use Netlify-provided base URL so it works on deploy previews too.
    const baseUrl =
      process.env.DEPLOY_PRIME_URL ||
      process.env.URL ||
      `https://${event.headers.host}`;

    const getListingEndpoint = `${baseUrl}/.netlify/functions/getListing`;

    async function fetchOne(id) {
      const res = await fetch(`${getListingEndpoint}?id=${encodeURIComponent(id)}`, {
        headers: { Accept: "application/json" },
      });

      const json = (await safeJson(res)) || {};
      const l = json.listing || null;

      if (!l) return null;
      if (!isInternetDisplayable(l)) return null;
      return l;
    }

    // Sequential until we hit limit (fast + stable)
    const listings = [];
    for (const id of ids) {
      if (listings.length >= limit) break;
      const l = await fetchOne(id).catch(() => null);
      if (l) listings.push(l);
    }

    return {
      statusCode: 200,
      headers: HEADERS_OK,
      body: JSON.stringify({
        success: true,
        listings,
        totalMatches: listings.length,
      }),
    };
  } catch (error) {
    console.error("getFeatured error:", error);
    return {
      statusCode: 200,
      headers: HEADERS_ERR,
      body: JSON.stringify({
        success: false,
        listings: [],
        totalMatches: 0,
        error: error.message,
      }),
    };
  }
};
