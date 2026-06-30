const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function () {
  const { BRIDGE_API_KEY } = process.env;

const url =
  "https://api.bridgedataoutput.com/api/v2/OData/rae/Property" +
  "?$filter=ListingId eq 'E4494960'" +
  "&$top=1";

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BRIDGE_API_KEY}`,
        Accept: "application/json",
      },
    });

    const json = await res.json();

    const listing = json.value?.[0];

    if (!listing) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, message: "Listing not found" }, null, 2),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          success: true,

          MLSNumber: listing.MLSNumber,
          ListingId: listing.ListingId,
          ListingKey: listing.ListingKey,

          ListAgentFullName: listing.ListAgentFullName,
          ListAgentFirstName: listing.ListAgentFirstName,
          ListAgentLastName: listing.ListAgentLastName,

          ListAgentKey: listing.ListAgentKey,
          ListAgentMlsId: listing.ListAgentMlsId,

          ListOfficeName: listing.ListOfficeName,
          ListOfficeKey: listing.ListOfficeKey,

          StandardStatus: listing.StandardStatus,
          BridgeModificationTimestamp: listing.BridgeModificationTimestamp
        },
        null,
        2
      ),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify(
        {
          success: false,
          error: err.message,
        },
        null,
        2
      ),
    };
  }
};
