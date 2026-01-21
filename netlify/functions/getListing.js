// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

function withTimeout(ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(t) };
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};

  const id = String(qs.id || "").trim();   // ListingKey
  const mls = String(qs.mls || "").trim(); // MLSNumber

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    // Better caching at Netlify edge (safe for listings)
    "Cache-Control": "public, max-age=60, s-maxage=900",
  };

  if (!BRIDGE_API_KEY || !BRIDGE_BASE_URL) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: "Missing BRIDGE env vars" }),
    };
  }

  if (!id && !mls) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: "Missing id or mls" }),
    };
  }

  const fields = [
    "ListingKey","ListingId","MLSNumber",
    "ListPrice","RAE_LP_Price",
    "UnparsedAddress","AddressLine1","City","StateOrProvince","PostalCode","Country",
    "BedroomsTotal","BathroomsTotalInteger","BathroomsFull","BathroomsTotalDecimal",
    "LivingArea","BuildingAreaTotal",
    "PropertySubType","MlsStatus","StandardStatus","Status",
    "PublicRemarks","PrivateOfficeRemarks",
    "SubdivisionName","Neighborhood",
    "ParkingFeatures","ParkingTotal",
    "BasementType","BasementDevelopment","Basement",
    "YearBuilt","Heating","HeatingType","Cooling","CoolingYN","FireplaceYN","FireplaceFeatures",
    "LotSizeArea","LotSizeUnits","ZoningDescription",
    "Appliances","Possession",
    "ListAgentFullName","ListAgentFirstName","ListAgentLastName",
    "ListOfficeName","OfficeName",
    "Latitude","Longitude","GeoLatitude","GeoLongitude","Geo",
    "Media","Photos",
    "PrimaryPhotoURL","PhotoUrl",
    "StatusChangeTimestamp","ModificationTimestamp","OnMarketTimestamp","LastChangeTimestamp","ListingContractDate",
    "DisplayAddressYN","AddressDisplayYN","InternetAddressDisplayYN"
  ].join(",");

  // Prefer ListingKey when present, otherwise MLSNumber
  const isById = Boolean(id);
  const target = isById ? id : mls;

  // Build URL in a way that works for BOTH styles:
  // - Bridge v2 REST style: limit/filter/fields
  // - OData style: $top/$filter/$select
  const url = new URL(`${BRIDGE_BASE_URL}/Property`);
  url.searchParams.set("access_token", BRIDGE_API_KEY);

  // Try REST-style first (your getListings function likely uses this)
  url.searchParams.set("limit", "1");
  url.searchParams.set("fields", fields);

  const restFilter = isById
    ? `ListingKey eq '${target.replace(/'/g, "")}'`
    : `MLSNumber eq '${target.replace(/'/g, "")}'`;
  url.searchParams.set("filter", restFilter);

  // Also set OData equivalents (harmless if ignored, helpful if required)
  url.searchParams.set("$top", "1");
  url.searchParams.set("$select", fields);
  url.searchParams.set("$filter", restFilter);

  try {
    const { signal, done } = withTimeout(12000);

    const r = await fetch(url.toString(), {
      signal,
      headers: { Accept: "application/json" },
    }).finally(done);

    const text = await r.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}

    const arr =
      Array.isArray(data?.bundle) ? data.bundle :
      Array.isArray(data?.value) ? data.value :
      Array.isArray(data?.listings) ? data.listings :
      [];

    const listing = arr[0] || null;

    if (r.ok && listing) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, listing }),
      };
    }

    // No fallback scan — that’s what causes 30s loads.
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        listing: null,
        error: "Listing not found with provided id/mls",
        debug: { used: isById ? "ListingKey" : "MLSNumber" }
      }),
    };
  } catch (error) {
    const isAbort = String(error?.name || "").toLowerCase().includes("abort");
    return {
      statusCode: isAbort ? 504 : 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: isAbort ? "Upstream timeout" : error.message,
      }),
    };
  }
};
