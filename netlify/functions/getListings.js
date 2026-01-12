// netlify/functions/getListings.js
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

function looksLikeMLS(raw) {
  const m = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  return /^[A-Z]\d{6,10}$/.test(m);
}

function matchesQuery(listing, q) {
  if (!q) return true;

  const tokens = String(q)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) return true;

  const hay = [
    listing.City,
    listing.SubdivisionName,
    listing.UnparsedAddress,
    listing.AddressLine1,
    listing.StreetNumber,
    listing.StreetName,
    listing.PostalCode,
    listing.StateOrProvince,
    listing.MLSNumber,
    listing.ListingId,
    listing.ListOfficeName,
    listing.ListAgentFullName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return tokens.every((t) => hay.includes(t));
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  // ✅ 30s cache for better speed
  const COMMON_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30",
  };

  try {
    const qsp = event?.queryStringParameters || {};

    // Requested paging from the UI (offset is WITHIN filtered results when q is used)
    const limit = Math.max(
      1,
      Math.min(200, parseInt(qsp.limit || "50", 10) || 50)
    );
    const offset = Math.max(0, parseInt(qsp.offset || "0", 10) || 0);

    // Search text
    const q = String(qsp.q || "").trim();

    // Safety cap: how many raw listings we’ll scan when q is used
    const MAX_SCAN = Math.max(
      200,
      Math.min(5000, parseInt(process.env.MAX_SCAN || "1500", 10) || 1500)
    );

    // 1) No search term → fast proxy (always return 200 so UI never hard-fails)
    if (!q) {
      const params = new URLSearchParams({
        access_token: BRIDGE_API_KEY,
        limit: String(limit),
        offset: String(offset),
      });

      const url = `${BRIDGE_BASE_URL}/listings?${params.toString()}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await r.json().catch(() => ({}));

      return {
        statusCode: 200,
        body: JSON.stringify(data),
        headers: COMMON_HEADERS,
      };
    }

    // 2) MLS-like query → try /Property and ALWAYS return 200 with bundle:[]
    if (looksLikeMLS(q)) {
      const mls = String(q).toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
      const safe = mls.replace(/'/g, "''");

      const url = new URL(`${BRIDGE_BASE_URL}/Property`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);
      url.searchParams.set("limit", "1");
      url.searchParams.set(
        "$filter",
        `(ListingKey eq '${safe}' or ListingId eq '${safe}' or MLSNumber eq '${safe}')`
      );

      let data = null;

      try {
        const r = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        data = await r.json().catch(() => null);
      } catch {
        data = null;
      }

      const bundle = Array.isArray(data?.bundle)
        ? data.bundle
        : Array.isArray(data?.value)
        ? data.value
        : [];

      const listing = bundle[0] ? [bundle[0]] : [];

      return {
        statusCode: 200,
        body: JSON.stringify({
          bundle: listing,
          total: typeof data?.total === "number" ? data.total : 0,
          totalMatches: listing.length,
          isCapped: false,
          scanned: 0,
          q: mls,
          limit,
          offset,
        }),
        headers: COMMON_HEADERS,
      };
    }

    // 3) General search (city/community/address) → scan & filter server-side
    // We scan the feed in chunks of 200 until we’ve collected enough matches
    // to satisfy the requested page: [offset .. offset+limit)
    const CHUNK = 200;

    let scanned = 0;
    let rawOffset = 0;
    let totalFeed = null;

    const matches = []; // only store matches up to offset+limit to reduce memory
    let totalMatches = 0;

    const needUpTo = offset + limit;

    while (scanned < MAX_SCAN) {
      const params = new URLSearchParams({
        access_token: BRIDGE_API_KEY,
        limit: String(CHUNK),
        offset: String(rawOffset),
      });

      const url = `${BRIDGE_BASE_URL}/listings?${params.toString()}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await r.json().catch(() => ({}));

      const bundle = Array.isArray(data?.bundle) ? data.bundle : [];
      if (totalFeed == null && typeof data?.total === "number") totalFeed = data.total;

      // no more data
      if (!bundle.length) break;

      scanned += bundle.length;

      // filter + count
      for (const l of bundle) {
        if (!isInternetDisplayable(l)) continue;
        if (!matchesQuery(l, q)) continue;

        totalMatches += 1;

        // only keep what we need for this page window
        if (matches.length < needUpTo) matches.push(l);
      }

      // if we already have enough matches to fill requested page, stop early
      if (matches.length >= needUpTo) break;

      rawOffset += CHUNK;
    }

    const pageSlice = matches.slice(offset, offset + limit);
    const isCapped = scanned >= MAX_SCAN && matches.length < needUpTo;

    return {
      statusCode: 200,
      body: JSON.stringify({
        bundle: pageSlice,
        total: typeof totalFeed === "number" ? totalFeed : 0,
        totalMatches,
        isCapped,
        scanned,
        scanCap: MAX_SCAN,
        q,
        limit,
        offset,
      }),
      headers: COMMON_HEADERS,
    };
  } catch (error) {
    console.error("Bridge proxy error:", error);
    return {
      statusCode: 200, // ✅ keep UI stable even on errors
      body: JSON.stringify({
        bundle: [],
        total: 0,
        totalMatches: 0,
        isCapped: false,
        scanned: 0,
        scanCap: 0,
        error: error.message,
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=10",
      },
    };
  }
};
