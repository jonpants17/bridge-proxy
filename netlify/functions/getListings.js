// netlify/functions/getListings.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    const q = event?.queryStringParameters || {};

    // limit: 1–200
    const limitRaw = q.limit;
    const limit = Number.isFinite(parseInt(limitRaw, 10))
      ? Math.max(1, Math.min(200, parseInt(limitRaw, 10)))
      : 50;

    // offset: 0+
    const offsetRaw = q.offset;
    const offset = Number.isFinite(parseInt(offsetRaw, 10))
      ? Math.max(0, parseInt(offsetRaw, 10))
      : 0;

    // IMPORTANT: Use the SAME upstream endpoint your dataset supports
    const params = new URLSearchParams({
      access_token: BRIDGE_API_KEY,
      limit: String(limit),
      offset: String(offset),
    });

    const url = `${BRIDGE_BASE_URL}/listings?${params.toString()}`;
    console.log("FETCHING FROM:", url);

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await r.json();

    return {
      statusCode: r.ok ? 200 : r.status,
      body: JSON.stringify(data), // keep original payload: bundle, total, etc.
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    };
  } catch (error) {
    console.error("Bridge proxy error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    };
  }
};
