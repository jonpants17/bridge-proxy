// netlify/functions/getListings.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    const q = event?.queryStringParameters || {};

    // Allow caller to control limit (1–200)
    const limitRaw = q.limit;
    const limit = Number.isFinite(parseInt(limitRaw, 10))
      ? Math.max(1, Math.min(200, parseInt(limitRaw, 10)))
      : 50;

    // Optional filters
    const agent = (q.agent || "").toLowerCase().trim();         // e.g. "caitlyn schafers"
    const office = (q.office || "").toLowerCase().trim();       // e.g. "initia"
    const listingId = (q.listingId || "").trim();               // e.g. "E4467116"
    const status = (q.status || "Active").trim();               // default Active

    // Build Bridge URL
    const params = new URLSearchParams({
      access_token: BRIDGE_API_KEY,
      limit: String(limit),
      // If your Bridge endpoint supports sort params here, keep them. If not, harmless.
      sortBy: "ModificationTimestamp",
      sortOrder: "DESC",
    });

    // If your dataset supports these server-side query params, great.
    // If it doesn't, we still filter server-side below.
    if (listingId) params.set("ListingId", listingId);
    if (status) params.set("MlsStatus", status);

    const url = `${BRIDGE_BASE_URL}/listings?${params.toString()}`;
    console.log("FETCHING FROM:", url);

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await r.json();

    // Normalize to an array
    const all = Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.listings)
      ? data.listings
      : Array.isArray(data?.value)
      ? data.value
      : Array.isArray(data)
      ? data
      : [];

    // Helper checks (based on your front-end)
    const isInternetDisplayable = (l) => {
      const v = String(
        l.InternetDisplayYN ??
          l.InternetEntireListingDisplayYN ??
          l.InternetEntireListingDisplay ??
          ""
      ).toUpperCase();
      return v !== "N" && v !== "0" && v !== "FALSE";
    };

    const normalizeStatus = (l) => {
      const raw = String(l.MlsStatus || l.StandardStatus || l.Status || "")
        .trim()
        .toLowerCase();
      if (!raw) return "unknown";
      if (raw.includes("sold")) return "sold";
      if (raw.includes("pending") || raw.includes("contingent")) return "pending";
      if (raw.includes("active")) return "active";
      if (raw === "a" || raw === "act") return "active";
      return "unknown";
    };

    // Server-side filtering (THIS is the key)
    let listings = all
      .filter(isInternetDisplayable)
      .filter((l) => {
        const s = normalizeStatus(l);
        return s !== "sold" && s !== "pending";
      });

    // Filter by ListingId if provided (best for “she has one listing”)
    if (listingId) {
      listings = listings.filter((l) => String(l.ListingId || "").trim() === listingId);
    }

    // Filter by office if provided (e.g. "initia")
    if (office) {
      listings = listings.filter((l) =>
        String(l.ListOfficeName || "").toLowerCase().includes(office)
      );
    }

    // Filter by agent name if provided (e.g. "caitlyn schafers")
    // Note: if Caitlyn is not the ListAgent in MLS, this may return 0 — that’s expected.
    if (agent) {
      const parts = agent.split(/\s+/).filter(Boolean);
      listings = listings.filter((l) => {
        const a = String(l.ListAgentFullName || "").toLowerCase();
        return parts.every((p) => a.includes(p));
      });
    }

    // Return a consistent payload for the front-end
    return {
      statusCode: r.ok ? 200 : r.status,
      body: JSON.stringify({ listings }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    };
  } catch (error) {
    console.error("Bridge proxy error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
      headers: { "Access-Control-Allow-Origin": "*" },
    };
  }
};
