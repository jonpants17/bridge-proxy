// netlify/functions/getListings.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    const limit = Math.max(1, Math.min(50, parseInt(event.queryStringParameters?.limit ?? "10", 10)));
    const url = `${BRIDGE_BASE_URL}/Property?access_token=${BRIDGE_API_KEY}&limit=${limit}`;
    console.log("FETCHING FROM:", url);

    const response = await fetch(url);
    const text = await response.text(); // get raw in case of errors
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // Always return 200 so the browser can read the body and show details
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: response.ok,
        status: response.status,
        data,
      }),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    };
  } catch (error) {
    console.error("Bridge proxy error:", error);
    return {
      statusCode: 200, // still 200, but with error info
      body: JSON.stringify({ ok: false, status: 500, error: error.message }),
      headers: { "Access-Control-Allow-Origin": "*" },
    };
  }
};
