// netlify/functions/getListings.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    const q = new URLSearchParams({ access_token: BRIDGE_API_KEY });

    // only set limit if caller provided one
    const rawLimit = event.queryStringParameters?.limit;
    if (rawLimit != null && rawLimit !== "") {
      const n = parseInt(String(rawLimit), 10);
      if (Number.isFinite(n)) {
        q.set("limit", String(Math.max(1, Math.min(50, n))));
      }
    }

    const url = `${BRIDGE_BASE_URL}/Property?${q.toString()}`;
    console.log("FETCHING FROM:", url);

    const r = await fetch(url);
    const data = await r.json();

    return {
      statusCode: r.ok ? 200 : r.status,
      body: JSON.stringify(data),
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
