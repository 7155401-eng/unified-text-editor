const GAS_URL = "https://script.google.com/macros/s/AKfycbyvt7yUPa2jNiTtTzKli8R8GmNI_plIeOwwFuTgu733es5mFfhEKcTcInP3yzFnlQQCvw/exec";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({
      error: "method_not_allowed",
      message: "Use POST",
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
  try {
    const body = await request.text();
    const upstream = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: "proxy_fetch_failed",
      message: error && error.message ? error.message : String(error),
    }), {
      status: 502,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
}
