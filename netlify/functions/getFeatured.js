// netlify/functions/getFeatured.js

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const ODATA_BASE = "https://api.bridgedataoutput.com/api/v2/OData/rae";

const CAITLYN_AGENT_KEY = "0522a4120745c4d8ed95045061a1f165";
const MAXWELL_OFFICE_KEY = "8f49787f3d74882c79e028e7e1c69139";

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
    const primaryUrl =
      `${ODATA_BASE}/Property` +
      `?$filter=(ListAgentKey eq '${CAITLYN_AGENT_KEY}' and IDXParticipationYN eq true)` +
      `&$orderby=BridgeModificationTimestamp desc` +
      `&$top=1`;

    const officeUrl =
      `${ODATA_BASE}/Property` +
      `?$filter=(ListOfficeKey eq '${MAXWELL_OFFICE_KEY}' and IDXParticipationYN eq true)` +
      `&$orderby=BridgeModificationTimestamp desc` +
      `&$top=6`;

    const [primaryResults, officeResults] = await Promise.all([
      bridgeFetch(primaryUrl, BRIDGE_API_KEY),
      bridgeFetch(officeUrl, BRIDGE_API_KEY),
    ]);

    const primary = primaryResults.find(isDisplayable) || null;

    const listings = officeResults
      .filter(isDisplayable)
      .filter((l) => !primary || l.ListingKey !== primary.ListingKey)
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
