const DEFAULT_DOCX_API_ORIGIN = "https://unified-text-editor.vercel.app";

const SERVER_IMPORT_ENDPOINTS = ["/api/word-chapters-import", "/api/word-chapters/import"];
const SERVER_SCAN_ENDPOINTS = ["/api/word-chapters-scan", "/api/word-chapters/scan"];
const SERVER_EXTRACT_ENDPOINTS = ["/api/word-chapters-extract", "/api/word-chapters/extract"];

function canUseServerApi(file) {
  return typeof fetch === "function" && !!file && typeof file.arrayBuffer === "function";
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
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
    DEFAULT_DOCX_API_ORIGIN,
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

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function postDocx(endpoints, file, params = {}) {
  if (!canUseServerApi(file)) return null;

  const errors = [];
  const urls = endpointUrls(endpoints).map((url) => appendParams(url, params));

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type":
            file.type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "x-file-name": encodeURIComponent(file.name || "document.docx"),
        },
        body: file,
        cache: "no-store",
        mode: "cors",
      });

      if (!response.ok) {
        const text = await responseText(response);
        errors.push(`Server DOCX API ${url} failed with ${response.status}${text ? ` ${text}` : ""}`);
        continue;
      }

      const json = await response.json();
      if (!json?.ok) {
        errors.push(json?.error || `Server DOCX API ${url} returned an error.`);
        continue;
      }

      return json;
    } catch (error) {
      errors.push(`Server DOCX API ${url} failed: ${error?.message || String(error)}`);
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
    partsMeta: serverScan.partsMeta || [],
  };
}
