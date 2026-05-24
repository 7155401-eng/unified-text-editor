const SERVER_SCAN_ENDPOINT = "/api/word-chapters/scan";
const SERVER_EXTRACT_ENDPOINT = "/api/word-chapters/extract";

const SERVER_SCAN_TIMEOUT_MS = 8000;
const SERVER_EXTRACT_TIMEOUT_MS = 20000;

function canUseServerApi(file) {
  return typeof fetch === "function" && !!file && typeof file.arrayBuffer === "function";
}

function timeoutForEndpoint(endpoint) {
  return endpoint === SERVER_EXTRACT_ENDPOINT ? SERVER_EXTRACT_TIMEOUT_MS : SERVER_SCAN_TIMEOUT_MS;
}

function createTimeoutSignal(ms) {
  if (typeof AbortController !== "function") {
    return { signal: undefined, cancel: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort(new DOMException("Server DOCX API timeout", "TimeoutError"));
    } catch {
      controller.abort();
    }
  }, ms);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

async function postDocx(endpoint, file, params = {}) {
  if (!canUseServerApi(file)) return null;

  const url = new URL(endpoint, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const timeout = createTimeoutSignal(timeoutForEndpoint(endpoint));

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-file-name": encodeURIComponent(file.name || "document.docx"),
      },
      body: file,
      cache: "no-store",
      signal: timeout.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Server DOCX API failed with ${response.status}`);
    }

    const json = await response.json();
    if (!json?.ok) throw new Error(json?.error || "Server DOCX API returned an error.");
    return json;
  } finally {
    timeout.cancel();
  }
}

export async function tryServerScanWordChapters(file) {
  try {
    return await postDocx(SERVER_SCAN_ENDPOINT, file);
  } catch (error) {
    console.warn("[chapter_server_api] server scan fallback to browser:", error);
    return null;
  }
}

export async function tryServerExtractWordChapter(file, { level, index }) {
  try {
    return await postDocx(SERVER_EXTRACT_ENDPOINT, file, { level, index });
  } catch (error) {
    console.warn("[chapter_server_api] server extract fallback to browser:", error);
    return null;
  }
}

export function normalizeServerScanState(serverScan, file) {
  if (!serverScan?.serverSide) return null;
  return {
    serverSide: true,
    fileName: file?.name || serverScan.fileName || "םבמך Word",
    heads: serverScan.heads || { 1: [], 2: [] },
    h: serverScan.h || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    total: serverScan.total || 0,
    chars: serverScan.chars || 0,
    words: serverScan.words || 0,
    partsMeta: serverScan.partsMeta || [],
  };
}
