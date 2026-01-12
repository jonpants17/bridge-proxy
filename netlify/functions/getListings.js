// netlify/functions/getListings.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    const q = event?.queryStringParameters || {};

    const limit = Math.min(Math.max(parseInt(q.limit || "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q.offset || "0", 10) || 0, 0);

    // user search term (city/community/address)
    const search = (q.q || "").toLowerCase().trim();

    // Build upstream request (IMPORTANT: Property endpoint supports limit/offset in Bridge v2)
    const url = new URL(`${BRIDGE_BASE_URL}/Property`);
    url.searchParams.set("access_token", BRIDGE_API_KEY);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sortBy", "ModificationTimestamp");
    url.searchParams.set("sortOrder", "DESC");

    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const data = await r.json();

    const all = Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : [];

    const total = typeof data?.total === "number" ? data.total : all.length;

    // Helper checks (your existing logic)
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

    // Base filtering
    let bundle = all
      .filter(isInternetDisplayable)
      .filter((l) => {
        const s = normalizeStatus(l);
        return s !== "sold" && s !== "pending";
      });

    // Search filter (client-friendly)
    if (search) {
      bundle = bundle.filter((l) => {
        const hay = [
          l.City,
          l.SubdivisionName,
          l.UnparsedAddress,
          l.AddressLine1,
          l.StreetName,
          l.PostalCode,
          l.StateOrProvince,
          l.ListingId,
          l.MLSNumber,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return hay.includes(search);
      });
    }

    return {
      statusCode: r.ok ? 200 : r.status,
      body: JSON.stringify({ success: true, status: r.status, total, bundle }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    };
  } catch (error) {
    console.error("Bridge proxy error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message }),
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    };
  }
};
