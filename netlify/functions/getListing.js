// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};
  const raw = (qs.id || qs.mls || "").trim();

  if (!raw) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: false, error: "Missing id" }),
    };
  }

  const id = raw.replace(/'/g, "''");

  try {
    const url = new URL(`${BRIDGE_BASE_URL}/Property`);
    url.searchParams.set("access_token", BRIDGE_API_KEY);
    url.searchParams.set("limit", "1");
    url.searchParams.set(
      "$filter",
      `(ListingKey eq '${id}' or ListingId eq '${id}' or MLSNumber eq '${id}')`
    );

    const r = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    const data = await r.json();

    const bundle = Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : [];

    const listing = bundle[0] || null;

    return {
      statusCode: listing ? 200 : 404,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: !!listing, listing }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
