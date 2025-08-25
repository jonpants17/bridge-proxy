const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event, context) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL, BRIDGE_DATASET } = process.env;

const url = `${BRIDGE_BASE_URL}/listings?access_token=${BRIDGE_API_KEY}&limit=10`;

  console.log("FETCHING FROM:", url);

  try {
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
    console.error("FETCH ERROR:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
