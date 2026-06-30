const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY } = process.env;
  const mls = (event.queryStringParameters?.mls || "").trim();

  if (!mls) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: "Missing mls parameter",
      }),
    };
  }

  const url =
    `https://api.bridgedataoutput.com/api/v2/OData/rae/Property` +
    `?$filter=(ListingId eq '${mls}')` +
    `&$top=1`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BRIDGE_API_KEY}`,
        Accept: "application/json",
      },
    });

    const text = await response.text();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: err.message,
      }),
    };
  }
};
