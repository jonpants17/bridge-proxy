// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};

  const id = String(qs.id || "").trim();   // ListingKey
  const mls = String(qs.mls || "").trim(); // MLSNumber
  const allowScan = String(qs.scan || "").trim() === "1"; // 👈 opt-in fallback scan

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    // better edge cache
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

  const toArray = (data) =>
    Array.isArray(data?.bundle) ? data.bundle :
    Array.isArray(data?.value) ? data.value :
    Array.isArray(data?.listings) ? data.listings :
    [];

  // Keep fields tight (huge speed win)
  const fields = [
    "ListingKey","ListingId","MLSNumber",
    "ListPrice","RAE_LP_Price",
    "UnparsedAddress","AddressLine1","City","StateOrProvince","PostalCode",
    "BedroomsTotal","BathroomsTotalInteger","BathroomsFull","BathroomsTotalDecimal",
    "LivingArea","BuildingAreaTotal",
    "MlsStatus","StandardStatus","Status",
    "PublicRemarks","PrivateOfficeRemarks",
    "SubdivisionName","Neighborhood",
    "Latitude","Longitude","GeoLatitude","GeoLongitude","Geo",
    "Media","Photos","PrimaryPhotoURL","PhotoUrl",
    "StatusChangeTimestamp","ModificationTimestamp","OnMarketTimestamp","LastChangeTimestamp","ListingContractDate",
    "DisplayAddressYN","AddressDisplayYN","InternetAddressDisplayYN",
    "ListAgentFullName","ListAgentFirstName","ListAgentLastName",
    "ListOfficeName","OfficeName"
  ].join(",");

  const isById = Boolean(id);
  const target = (isById ? id : mls).replace(/'/g, ""); // escape '

  // IMPORTANT: different Bridge bases expect different param styles.
  const looksOData = /\/odata\//i.test(BRIDGE_BASE_URL);

  try {
    // =============== FAST PATH (NO SCAN) ===============
    const url = new URL(`${BRIDGE_BASE_URL}/Property`);
    url.searchParams.set("access_token", BRIDGE_API_KEY);

    if (looksOData) {
      // OData style
      url.searchParams.set("$top", "1");
      url.searchParams.set("$select", fields);
      url.searchParams.set("$filter", isById
        ? `ListingKey eq '${target}'`
        : `MLSNumber eq '${target}'`
      );
    } else {
      // REST style (what your getListings likely uses)
      url.searchParams.set("limit", "1");
      url.searchParams.set("fields", fields);
      url.searchParams.set("filter", isById
        ? `ListingKey eq '${target}'`
        : `MLSNumber eq '${target}'`
      );
    }

    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const data = await r.json().catch(() => ({}));
    const arr = toArray(data);
    const listing = arr[0];

    if (r.ok && listing) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, listing }),
      };
    }

    // If fast path failed, DO NOT auto-scan (that’s your 30s killer)
    if (!allowScan) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          listing: null,
          error: "Not found via direct lookup. (scan disabled)",
          debug: { looksOData, used: isById ? "ListingKey" : "MLSNumber" }
        }),
      };
    }

    // =============== OPTIONAL FALLBACK SCAN (ONLY IF scan=1) ===============
    // Keep it small so it can’t explode load time.
    const limit = 200;
    const maxPagesToScan = 5; // 👈 was 40 (that’s the 30s)

    const matches = (l) => {
      const a = String(l?.ListingKey || "").trim();
      const b = String(l?.ListingId || "").trim();
      const c = String(l?.MLSNumber || "").trim();
      return a === target || b === target || c === target;
    };

    for (let i = 0; i < maxPagesToScan; i++) {
      const offset = i * limit;

      const scanUrl = new URL(`${BRIDGE_BASE_URL}/Property`);
      scanUrl.searchParams.set("access_token", BRIDGE_API_KEY);

      if (looksOData) {
        scanUrl.searchParams.set("$top", String(limit));
        scanUrl.searchParams.set("$skip", String(offset));
        scanUrl.searchParams.set("$select", fields);
      } else {
        scanUrl.searchParams.set("limit", String(limit));
        scanUrl.searchParams.set("offset", String(offset));
        scanUrl.searchParams.set("fields", fields);
      }

      const sr = await fetch(scanUrl.toString(), { headers: { Accept: "application/json" } });
      const sdata = await sr.json().catch(() => ({}));
      const bundle = toArray(sdata);
      const found = bundle.find(matches);

      if (found) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, listing: found, debug: { scanned: true } }),
        };
      }

      if (bundle.length < limit) break;
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ success: false, listing: null, error: "Not found (scan=1)" }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
