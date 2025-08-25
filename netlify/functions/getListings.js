// netlify/functions/getListings.js
exports.handler = async function () {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, msg: "ping from Netlify function" }),
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  };
};
