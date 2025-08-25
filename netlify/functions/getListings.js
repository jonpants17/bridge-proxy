// netlify/functions/getListings.js
exports.handler = async function () {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;

  const debug = {
    baseUrl: BRIDGE_BASE_URL || null,
    tokenPresent: !!BRIDGE_API_KEY,
    tokenLen: BRIDGE_API_KEY ? BRIDGE_API_KEY.length : 0,
    tokenTail: BRIDGE_API_KEY ? BRIDGE_API_KEY.slice(-4) : null,
    sampleUrl: BRIDGE_BASE_URL && BRIDGE_API_KEY
      ? `${BRIDGE_BASE_URL}/Property?access_token=${BRIDGE_API_KEY}`
      : null,
  };

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, debug }),
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  };
};
