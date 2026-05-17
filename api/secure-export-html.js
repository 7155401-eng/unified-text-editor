import { handleSecureExportHtmlRequest } from "../server/secure_export_html.js";
import { getUserFromRequest } from "../worker/session.js";

function toWebRequest(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "localhost";
  const url = `${protocol}://${host}${req.url || "/api/secure-export-html"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value != null) headers.set(key, String(value));
  }
  const chunks = [];
  return new Promise((resolve, reject) => {
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      resolve(new Request(url, {
        method: req.method || "GET",
        headers,
        body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
  });
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export default async function handler(req, res) {
  try {
    const request = await toWebRequest(req);
    const response = await handleSecureExportHtmlRequest(request, process.env || {}, { getUserFromRequest });
    await sendWebResponse(res, response);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "secure_export_failed" }));
  }
}
