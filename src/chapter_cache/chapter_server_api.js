const SERVER_IMPORT_ENDPOINTS = ["/api/ravtext-docx-import", "/api/word-chapters-import", "/api/word-chapters/import"];
const SERVER_SCAN_ENDPOINTS = ["/api/word-chapters-scan", "/api/word-chapters/scan"];
const SERVER_EXTRACT_ENDPOINTS = ["/api/word-chapters-extract", "/api/word-chapters/extract"];

function canUseServerApi(file) {
  return typeof fetch === "function" && !!file && typeof file.arrayBuffer === "function";
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try { return new URL(raw).origin; } catch { return ""; }
}

function configuredApiBase() {
  const values = [];
  try {
    if (typeof window !== "undefined" && window.__DOCX_API_BASE__) values.push(window.__DOCX_API_BASE__);
  } catch {}
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.VITE_DOCX_API_BASE) {
      values.push(import.meta.env.VITE_DOCX_API_BASE);
    }
  } catch {}
  return values;
}

function apiOrigins() {
  const origins = [];
  const seen = new Set();
  for (const raw of [
    ...configuredApiBase(),
    typeof window !== "undefined" ? window.location?.origin : "",
  ]) {
    const origin = normalizeOrigin(raw);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }
  return origins;
}

function endpointUrls(endpoints) {
  const urls = [];
  const seen = new Set();
  const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
  for (const origin of apiOrigins()) {
    for (const endpoint of endpointList) {
      try {
        const url = new URL(endpoint, origin).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      } catch {}
    }
  }
  return urls;
}

function appendParams(urlString, params = {}) {
  const url = new URL(urlString);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requestId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `docx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function headersOf(response) {
  const keys = ["content-type", "content-length", "allow", "server", "cf-ray", "cf-cache-status", "x-docx-api", "x-docx-version", "x-docx-request-id", "location"];
  const out = {};
  for (const key of keys) {
    try {
      const value = response.headers.get(key);
      if (value) out[key] = value;
    } catch {}
  }
  return out;
}

async function readText(response) {
  try { return await response.text(); } catch (error) { return `[body read failed: ${error?.message || String(error)}]`; }
}

function snippet(text, max = 700) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function isHtml(headers, text) {
  const ct = String(headers?.["content-type"] || "").toLowerCase();
  const start = String(text || "").trim().slice(0, 120).toLowerCase();
  return ct.includes("text/html") || start.startsWith("<!doctype") || start.startsWith("<html");
}

async function probeEndpoint(url, id) {
  const probeUrl = appendParams(url, { __docx_api_probe: Date.now(), requestId: id });
  const started = performance.now?.() || Date.now();
  try {
    const response = await fetch(probeUrl, { method: "GET", cache: "no-store", mode: "cors" });
    const text = await readText(response);
    const headers = headersOf(response);
    return {
      url: probeUrl,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Math.round((performance.now?.() || Date.now()) - started),
      headers,
      bodySnippet: snippet(text),
      htmlLike: isHtml(headers, text),
    };
  } catch (error) {
    return { url: probeUrl, ok: false, failedToFetch: true, error: error?.message || String(error) };
  }
}

function logDocxApi(level, payload) {
  try {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    fn("[docx-api]", payload);
  } catch {}
}

function formatFailure({ url, id, response, headers, text, elapsedMs, probe }) {
  const parts = [
    `Server DOCX API ${url} failed with ${response.status} ${response.statusText || ""}`.trim(),
    `requestId=${id}`,
    `elapsedMs=${elapsedMs}`,
  ];
  if (headers && Object.keys(headers).length) parts.push(`headers=${JSON.stringify(headers)}`);
  const body = snippet(text);
  if (body) parts.push(`body=${body}`);
  if (probe) parts.push(`probe=${JSON.stringify(probe)}`);
  return parts.join(" | ");
}

async function docxBody(file) {
  return file.arrayBuffer();
}

async function postDocx(endpoints, file, params = {}) {
  if (!canUseServerApi(file)) return null;

  const urls = endpointUrls(endpoints).map((url) => appendParams(url, params));
  const errors = [];
  const body = await docxBody(file);

  if (!urls.length) throw new Error("DOCX API base is not configured.");

  for (const url of urls) {
    const id = requestId();
    const started = performance.now?.() || Date.now();

    logDocxApi("info", {
      event: "docx_api_post_start",
      requestId: id,
      url,
      currentOrigin: typeof window !== "undefined" ? window.location?.origin : null,
      configuredApiBase: configuredApiBase(),
      apiOrigins: apiOrigins(),
      fileName: file?.name || null,
      fileSize: file?.size || body?.byteLength || null,
      bodyKind: "ArrayBuffer",
      bodyBytes: body?.byteLength || null,
      note: "No custom headers are sent. If status is 405 and response lacks x-docx-api, Cloudflare Function is probably not matched/deployed.",
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        body,
        cache: "no-store",
        mode: "cors",
      });

      const elapsedMs = Math.round((performance.now?.() || Date.now()) - started);
      const headers = headersOf(response);

      if (!response.ok) {
        const text = await readText(response);
        let probe = null;
        if (response.status === 405 || isHtml(headers, text)) probe = await probeEndpoint(url, id);

        const failure = formatFailure({ url, id, response, headers, text, elapsedMs, probe });
        errors.push(failure);

        logDocxApi("warn", {
          event: "docx_api_post_non_ok",
          requestId: id,
          url,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          headers,
          bodySnippet: snippet(text),
          htmlLike: isHtml(headers, text),
          probe,
          interpretation: probe?.htmlLike
            ? "GET probe returned HTML. This route is being served by the SPA/static host, not by a Cloudflare Pages Function."
            : headers["x-docx-api"]
              ? "The request reached our DOCX function, but the function returned a non-OK status."
              : "The response does not include x-docx-api. The request probably did not reach our Cloudflare Function.",
        });
        continue;
      }

      const text = await readText(response);
      let json;
      try {
        json = JSON.parse(text);
      } catch (parseError) {
        const probe = await probeEndpoint(url, id);
        const message = [
          `Server DOCX API ${url} returned non-JSON response`,
          `requestId=${id}`,
          `status=${response.status}`,
          `headers=${JSON.stringify(headers)}`,
          `body=${snippet(text)}`,
          `probe=${JSON.stringify(probe)}`,
        ].join(" | ");
        errors.push(message);
        logDocxApi("warn", { event: "docx_api_non_json", requestId: id, url, status: response.status, headers, bodySnippet: snippet(text), parseError: parseError?.message || String(parseError), probe });
        continue;
      }

      if (!json?.ok) {
        const message = [json?.error || `Server DOCX API ${url} returned an error.`, `requestId=${id}`, `status=${response.status}`, `headers=${JSON.stringify(headers)}`].join(" | ");
        errors.push(message);
        logDocxApi("warn", { event: "docx_api_json_error", requestId: id, url, status: response.status, headers, json });
        continue;
      }

      logDocxApi("info", {
        event: "docx_api_post_success",
        requestId: id,
        url,
        status: response.status,
        elapsedMs,
        headers,
        total: json?.total ?? null,
        chars: json?.chars ?? null,
        words: json?.words ?? null,
      });

      return json;
    } catch (error) {
      const elapsedMs = Math.round((performance.now?.() || Date.now()) - started);
      const probe = await probeEndpoint(url, id).catch((probeError) => ({ ok: false, probeError: probeError?.message || String(probeError) }));
      const message = [`Server DOCX API ${url} failed: ${error?.message || String(error)}`, `requestId=${id}`, `elapsedMs=${elapsedMs}`, `probe=${JSON.stringify(probe)}`].join(" | ");
      errors.push(message);
      logDocxApi("error", { event: "docx_api_fetch_error", requestId: id, url, elapsedMs, error: error?.message || String(error), probe });
    }
  }

  throw new Error(errors.filter(Boolean).join("\n") || "Server DOCX API failed.");
}

export async function importWordChaptersOnServer(file) {
  return postDocx(SERVER_IMPORT_ENDPOINTS, file);
}

export async function scanWordChaptersOnServer(file) {
  return postDocx(SERVER_SCAN_ENDPOINTS, file);
}

export async function extractWordChapterOnServer(file, { level, index }) {
  return postDocx(SERVER_EXTRACT_ENDPOINTS, file, { level, index });
}

export async function tryServerScanWordChapters(file) {
  try {
    return await scanWordChaptersOnServer(file);
  } catch (error) {
    console.warn("[chapter_server_api] server scan fallback to browser:", error);
    return null;
  }
}

export async function tryServerExtractWordChapter(file, { level, index }) {
  try {
    return await extractWordChapterOnServer(file, { level, index });
  } catch (error) {
    console.warn("[chapter_server_api] server extract fallback to browser:", error);
    return null;
  }
}

export function normalizeServerScanState(serverScan, file) {
  if (!serverScan?.serverSide) return null;
  return {
    serverSide: true,
    serverDocumentId: serverScan.serverDocumentId || serverScan.fileHash || null,
    fileHash: serverScan.fileHash || serverScan.serverDocumentId || null,
    fileName: file?.name || serverScan.fileName || "מסמך Word",
    heads: serverScan.heads || { 1: [], 2: [] },
    h: serverScan.h || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    total: serverScan.total || 0,
    chars: serverScan.chars || 0,
    words: serverScan.words || 0,
  };
}
