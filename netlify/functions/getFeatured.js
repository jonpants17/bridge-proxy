// netlify/functions/getFeatured.js

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const ODATA_BASE = "https://api.bridgedataoutput.com/api/v2/OData/rae";

function safeMLS(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function escapeODataString(v) {
  return String(v || "").replace(/'/g, "''");
}

function isDisplayable(l) {
  return l?.IDXParticipationYN !== false && l?.RAE_L_IdxInclude !== "No";
}

async function bridgeFetch(url, apiKey) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  const json = await res.json().catch(() => ({}));
  return Array.isArray(json.value) ? json.value : [];
}

exports.handler = async function () {
  const { BRIDGE_API_KEY } = process.env;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30, s-maxage=300",
  };

  try {
    const featuredId = safeMLS(process.env.FEATURED_IDS || "E4494960");
    const officeName = "MaxWell Progressive";

    const primaryUrl =
      `${ODATA_BASE}/Property` +
      `?$filter=(ListingId eq '${featuredId}')` +
      `&$top=1`;

    const officeUrl =
      `${ODATA_BASE}/Property` +
      `?$filter=(ListOfficeName eq '${escapeODataString(officeName)}' and IDXParticipationYN eq true)` +
      `&$orderby=BridgeModificationTimestamp desc` +
      `&$top=6`;

    const [primaryResults, officeResults] = await Promise.all([
      bridgeFetch(primaryUrl, BRIDGE_API_KEY),
      bridgeFetch(officeUrl, BRIDGE_API_KEY),
    ]);

    const primary = primaryResults.find(isDisplayable) || null;

    const listings = officeResults
      .filter(isDisplayable)
      .filter((l) => l.ListingId !== featuredId)
      .slice(0, 3);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        primary,
        listings,
        totalMatches: listings.length + (primary ? 1 : 0),
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "no-store" },
      body: JSON.stringify({
        success: false,
        primary: null,
        listings: [],
        totalMatches: 0,
        error: error.message,
      }),
    };
  }
};
