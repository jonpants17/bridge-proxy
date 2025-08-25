const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  try {
    const limit = Math.max(1, Math.min(50, parseInt(event.queryStringParameters?.limit ?? "10", 10)));
    const url = `${BRIDGE_BASE_URL}/Property?access_token=${BRIDGE_API_KEY}&limit=${limit}`;
    console.log("FETCHING FROM:", url); // <- log exact URL

    const response = await fetch(url);
    const data = await response.json();

    return {
      statusCode: response.ok ? 200 : response.status,
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
