// netlify/functions/getFeatured.js

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

function normalizeId(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isInternetDisplayable(l) {
  const v = String(
    l.InternetDisplayYN ??
      l.InternetEntireListingDisplayYN ??
      l.InternetEntireListingDisplay ??
      ""
  ).toUpperCase();
  return v !== "N" && v !== "0" && v !== "FALSE";
}

async function safeJson(res) {
  const t = await res.text().catch(() => "");
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// MLS pattern like E4467116 (letter + 6-10 digits)
function looksLikeMLS(raw) {
  return /^[A-Z]\d{6,10}$/i.test(String(raw || "").trim());
}

exports.handler = async function (event) {
  const COMMON_HEADERS_OK = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control":
      "public, max-age=30, s-maxage=300, stale-while-revalidate=86400",
  };

  const COMMON_HEADERS_ERR = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  try {
    const qsp = event?.queryStringParameters || {};

    // ?ids=E4467116,E123...
    // OR env FEATURED_IDS
    const rawIds =
      String(qsp.ids || "").trim() ||
      String(process.env.FEATURED_IDS || "").trim();

    const limit = Math.max(1, Math.min(3, parseInt(qsp.limit || "3", 10) || 3));

    const ids = rawIds
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, 20);

    if (!ids.length) {
      return {
        statusCode: 200,
        headers: COMMON_HEADERS_OK,
        body: JSON.stringify({ success: true, listings: [], totalMatches: 0 }),
      };
    }

    // ✅ Call the existing getListing function
    const baseUrl =
      process.env.DEPLOY_PRIME_URL ||
      process.env.URL ||
      `https://${event.headers.host}`;

    const ENDPOINT_DETAIL = `${baseUrl}/.netlify/functions/getListing`;

    async function fetchOne(raw) {
      const token = String(raw || "").trim();
      if (!token) return null;

      // ✅ If it's MLS, call getListing?mls=...
      // ✅ Otherwise call getListing?id=... (ListingKey / ListingId style)
      const qs = looksLikeMLS(token)
        ? `mls=${encodeURIComponent(token)}`
        : `id=${encodeURIComponent(normalizeId(token))}`;

      const res = await fetch(`${ENDPOINT_DETAIL}?${qs}`, {
        headers: { Accept: "application/json" },
      });

      const json = (await safeJson(res)) || {};
      const l = json?.listing || null;

      if (!l) return null;
      if (!isInternetDisplayable(l)) return null;
      return l;
    }

    // ✅ Optimization for your current setup:
    // If you only have ONE featured MLS, don't fetch 20.
    // Still safe for future multiple featured items.
    const candidates = ids.slice(0, Math.min(20, limit));

    const results = await Promise.all(
      candidates.map((x) => fetchOne(x).catch(() => null))
    );

    const listings = results.filter(Boolean).slice(0, limit);

    return {
      statusCode: 200,
      headers: COMMON_HEADERS_OK,
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
      headers: COMMON_HEADERS_ERR,
      body: JSON.stringify({
        success: false,
        listings: [],
        totalMatches: 0,
        error: error.message,
      }),
    };
  }
};
