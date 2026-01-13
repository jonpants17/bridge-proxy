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

function normalizeText(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/\s+/g, "") // remove spaces (postal codes)
    .replace(/[^a-z0-9]/g, "");
}

function matchesQuery(listing, q) {
  if (!q) return true;

  const raw = String(q).trim().toLowerCase();
  const tokens = raw
    .split(/\s+/)
    .map((t) => normalizeText(t))
    .filter(Boolean);

  // also include the "no spaces" version (important for postal codes)
  const joined = normalizeText(raw);
  if (joined && !tokens.includes(joined)) tokens.push(joined);

  if (!tokens.length) return true;

  const haystack = [
    listing.City,
    listing.CountyOrParish,
    listing.Municipality,
    listing.SubdivisionName,
    listing.StateOrProvince, // if you want to remove this later, safe to delete
    listing.PostalCode,
    listing.UnparsedAddress,
    listing.AddressLine1,
    listing.StreetNumber,
    listing.StreetName,
    listing.MLSNumber,
    listing.ListingId,
    listing.ListingKey,
    listing.ListOfficeName,
    listing.ListAgentFullName,
  ]
    .filter(Boolean)
    .map(normalizeText)
    .join(" ");

  return tokens.every((t) => haystack.includes(t));
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  const COMMON_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30",
  };

  try {
    const qsp = event?.queryStringParameters || {};

    const limit = Math.max(
      1,
      Math.min(200, parseInt(qsp.limit || "50", 10) || 50)
    );
    const offset = Math.max(0, parseInt(qsp.offset || "0", 10) || 0);

    const q = String(qsp.q || "").trim();

    const MAX_SCAN = Math.max(
      200,
      Math.min(5000, parseInt(process.env.MAX_SCAN || "1500", 10) || 1500)
    );

    // =========================================================
    // 1) No search term → fast proxy (Bridge paging)
    //    Try "newest first" but fall back if Bridge rejects sort.
    // =========================================================
    if (!q) {
      const baseParams = {
        access_token: BRIDGE_API_KEY,
        limit: String(limit),
        offset: String(offset),
      };

      const sortAttempts = [
        // Attempt 1: OData-style (often rejected on some Bridge endpoints)
        (p) => p.set("$orderby", "ListDate desc"),

        // Attempt 2: Bridge-style sorting (often supported)
        (p) => {
          p.set("sortBy", "ListDate");
          p.set("sortOrder", "DESC");
        },

        // Attempt 3: safer "last modified" style
        (p) => {
          p.set("sortBy", "ModificationTimestamp");
          p.set("sortOrder", "DESC");
        },

        // Attempt 4: no sort at all
        (_p) => {},
      ];

      let last = null;

      for (const applySort of sortAttempts) {
        const params = new URLSearchParams(baseParams);
        applySort(params);

        const url = `${BRIDGE_BASE_URL}/listings?${params.toString()}`;
        last = await fetchJson(url);

        if (last.ok) {
          return {
            statusCode: 200,
            body: JSON.stringify(last.data),
            headers: COMMON_HEADERS,
          };
        }
      }

      // If all failed, keep UI stable
      return {
        statusCode: 200,
        body: JSON.stringify({
          bundle: [],
          total: 0,
          error: `Upstream error ${last?.status || "unknown"} (sorting attempt failed)`,
        }),
        headers: COMMON_HEADERS,
      };
    }

    // =========================================================
    // 2) MLS-like query → /Property (ALWAYS 200 with bundle:[])
    // =========================================================
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
          scanCap: MAX_SCAN,
          q: mls,
          limit,
          offset,
        }),
        headers: COMMON_HEADERS,
      };
    }

    // =========================================================
    // 3) General search → scan & filter server-side
    // =========================================================
    const CHUNK = 200;

    let scanned = 0;
    let rawOffset = 0;
    let totalFeed = null;

    const matches = [];
    let totalMatches = 0;

    const needUpTo = offset + limit;

    while (scanned < MAX_SCAN) {
      const params = new URLSearchParams({
        access_token: BRIDGE_API_KEY,
        limit: String(CHUNK),
        offset: String(rawOffset),
      });

      const url = `${BRIDGE_BASE_URL}/listings?${params.toString()}`;
      const { data } = await fetchJson(url);

      const bundle = Array.isArray(data?.bundle) ? data.bundle : [];
      if (totalFeed == null && typeof data?.total === "number") totalFeed = data.total;

      if (!bundle.length) break;

      scanned += bundle.length;

      for (const l of bundle) {
        if (!isInternetDisplayable(l)) continue;
        if (!matchesQuery(l, q)) continue;

        totalMatches += 1;
        if (matches.length < needUpTo) matches.push(l);
      }

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
      statusCode: 200,
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
