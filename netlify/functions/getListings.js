// netlify/functions/getListings.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function () {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    // Call Bridge without ?limit=  (Bridge defaults to ~10)
    const url = `${BRIDGE_BASE_URL}/Property?access_token=${BRIDGE_API_KEY}`;
    console.log("FETCHING FROM:", url);

    const r = await fetch(url, { headers: { "Accept": "application/json" } });
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
