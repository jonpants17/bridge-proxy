// netlify/functions/getListings.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    // Build query: always include token; include limit only if caller provides it (1–200)
    const params = new URLSearchParams({ access_token: BRIDGE_API_KEY });

    const rawLimit = event?.queryStringParameters?.limit;
    if (rawLimit != null && rawLimit !== "") {
      const n = parseInt(String(rawLimit), 10);
      if (Number.isFinite(n)) {
        params.set("limit", String(Math.max(1, Math.min(200, n))));
      }
    }

    const url = `${BRIDGE_BASE_URL}/listings?${params.toString()}`;
    console.log("FETCHING FROM:", url);

    const r = await fetch(url, { headers: { Accept: "application/json" } });
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
