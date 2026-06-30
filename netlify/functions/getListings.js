// netlify/functions/getListings.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const ODATA_BASE = "https://api.bridgedataoutput.com/api/v2/OData/rae";

function escapeODataString(v) {
  return String(v || "").replace(/'/g, "''");
}

function looksLikeMLS(raw) {
  const m = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
  return /^[A-Z]\d{6,10}$/.test(m);
}

async function bridgeFetch(url, apiKey) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY } = process.env;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30",
  };

  try {
    const qsp = event?.queryStringParameters || {};
    const limit = Math.max(1, Math.min(200, parseInt(qsp.limit || "50", 10) || 50));
    const offset = Math.max(0, parseInt(qsp.offset || "0", 10) || 0);
    const q = String(qsp.q || "").trim();

    let filter = "IDXParticipationYN eq true";

    if (q) {
      const safe = escapeODataString(q);

      if (looksLikeMLS(q)) {
        const mls = q.toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
        filter = `(ListingId eq '${mls}' or ListingKey eq '${mls}') and IDXParticipationYN eq true`;
      } else {
        filter =
          `IDXParticipationYN eq true and (` +
          `contains(tolower(City),'${safe.toLowerCase()}') or ` +
          `contains(tolower(UnparsedAddress),'${safe.toLowerCase()}') or ` +
          `contains(tolower(PostalCode),'${safe.toLowerCase()}') or ` +
          `contains(tolower(MLSAreaMajor),'${safe.toLowerCase()}') or ` +
          `contains(tolower(ListOfficeName),'${safe.toLowerCase()}') or ` +
          `contains(tolower(ListAgentFullName),'${safe.toLowerCase()}')` +
          `)`;
      }
    }

    const url =
      `${ODATA_BASE}/Property` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$orderby=BridgeModificationTimestamp desc` +
      `&$top=${limit}` +
      `&$skip=${offset}` +
      `&$count=true`;

    const { ok, status, json } = await bridgeFetch(url, BRIDGE_API_KEY);

    if (!ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          bundle: [],
          total: 0,
          totalMatches: 0,
          error: `Bridge OData error ${status}`,
          details: json,
        }),
      };
    }

    const bundle = Array.isArray(json.value) ? json.value : [];
    const total = typeof json["@odata.count"] === "number" ? json["@odata.count"] : bundle.length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        bundle,
        total,
        totalMatches: total,
        isCapped: false,
        scanned: bundle.length,
        scanCap: 1500,
        q,
        limit,
        offset,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=10" },
      body: JSON.stringify({
        bundle: [],
        total: 0,
        totalMatches: 0,
        isCapped: false,
        scanned: 0,
        scanCap: 0,
        error: error.message,
      }),
    };
  }
};
