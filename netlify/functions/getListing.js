// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const ODATA_BASE = "https://api.bridgedataoutput.com/api/v2/OData/rae";

function escapeODataString(v) {
  return String(v || "").replace(/'/g, "''");
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY } = process.env;
  const qs = event?.queryStringParameters || {};
  const id = String(qs.id || "").trim();
  const mls = String(qs.mls || "").trim();

  const fetchedAt = new Date().toISOString();

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Vary": "Origin",
    "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=300",
  };

  if (!id && !mls) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: "Missing id or mls", fetchedAt }),
    };
  }

  try {
    const filters = [];

    if (id) {
      const safeId = escapeODataString(id);
      filters.push(`ListingKey eq '${safeId}'`);
      filters.push(`ListingId eq '${safeId}'`);
    }

    if (mls) {
      const safeMls = escapeODataString(mls.toUpperCase().replace(/[^A-Z0-9]/g, ""));
      filters.push(`ListingId eq '${safeMls}'`);
    }

    const url =
      `${ODATA_BASE}/Property` +
      `?$filter=(${filters.join(" or ")})` +
      `&$top=1`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BRIDGE_API_KEY}`,
        Accept: "application/json",
      },
    });

    const data = await r.json().catch(() => ({}));
    const listing = Array.isArray(data?.value) ? data.value[0] : null;

    return {
      statusCode: listing ? 200 : 404,
      headers,
      body: JSON.stringify({
        success: !!listing,
        listing,
        fetchedAt,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message, fetchedAt }),
    };
  }
};
