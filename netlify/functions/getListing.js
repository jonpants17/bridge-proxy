// bridge-proxy/netlify/functions/getListing.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(t));
}

exports.handler = async function (event) {
  const { BRIDGE_API_KEY, BRIDGE_BASE_URL } = process.env;
  const qs = event?.queryStringParameters || {};
  const raw = (qs.id || qs.mls || "").trim();

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    // caching = BIG speed improvement, no behavior change
    "Cache-Control": "public, max-age=60, s-maxage=900",
  };

  if (!raw) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: "Missing id or mls" }),
    };
  }

  const target = String(raw).trim();

  const toArray = (data) =>
    Array.isArray(data?.bundle)
      ? data.bundle
      : Array.isArray(data?.value)
      ? data.value
      : Array.isArray(data?.listings)
      ? data.listings
      : [];

  const matches = (l) => {
    const a = String(l?.ListingKey || "").trim();
    const b = String(l?.ListingId || "").trim();
    const c = String(l?.MLSNumber || "").trim();
    return a === target || b === target || c === target;
  };

  try {
    // ---------- FAST TRY: very small request first ----------
    // If featured listings are recent, this often resolves instantly.
    {
      const quickUrl = new URL(`${BRIDGE_BASE_URL}/listings`);
      quickUrl.searchParams.set("access_token", BRIDGE_API_KEY);
      quickUrl.searchParams.set("limit", "20");
      quickUrl.searchParams.set("offset", "0");

      const qr = await fetchWithTimeout(quickUrl.toString(), {
        headers: { Accept: "application/json" },
      }, 12000);

      if (qr.ok) {
        const qdata = await qr.json().catch(() => ({}));
        const qbundle = toArray(qdata);
        const foundQuick = qbundle.find(matches);
        if (foundQuick) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, listing: foundQuick }),
          };
        }
      }
    }

    // ---------- FALLBACK SCAN (capped) ----------
    const limit = 200;
    const maxPagesToScan = 8; // was 40 — this is the real speed fix

    for (let i = 0; i < maxPagesToScan; i++) {
      const offset = i * limit;

      const url = new URL(`${BRIDGE_BASE_URL}/listings`);
      url.searchParams.set("access_token", BRIDGE_API_KEY);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));

      const r = await fetchWithTimeout(url.toString(), {
        headers: { Accept: "application/json" },
      }, 12000);

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          statusCode: r.status,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Upstream error ${r.status}`,
            details: text.slice(0, 500),
          }),
        };
      }

      const data = await r.json().catch(() => ({}));
      const bundle = toArray(data);
      const found = bundle.find(matches);

      if (found) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, listing: found }),
        };
      }

      if (bundle.length < limit) break;
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ success: false, listing: null }),
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
