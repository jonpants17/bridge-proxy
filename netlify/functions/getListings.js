// netlify/functions/getListings.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    // allow /getListings?limit=3 (default 10, clamp 1–50)
    const limit = Math.max(
      1,
      Math.min(
        50,
        parseInt((event.queryStringParameters?.limit ?? "10"), 10)
      )
    );

    // Bridge uses the Property endpoint (not /listings)
    const url = `${BRIDGE_BASE_URL}/Property?access_token=${BRIDGE_API_KEY}&limit=${limit}`;

    const response = await fetch(url);
    const data = await response.json();

    return {
      statusCode: 200,
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
