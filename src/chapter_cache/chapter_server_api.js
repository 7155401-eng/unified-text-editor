const SERVER_IMPORT_ENDPOINTS = ["/api/word-chapters-import", "/api/word-chapters/import"];
const SERVER_SCAN_ENDPOINTS = ["/api/word-chapters-scan", "/api/word-chapters/scan"];
const SERVER_EXTRACT_ENDPOINTS = ["/api/word-chapters-extract", "/api/word-chapters/extract"];

function canUseServerApi(file) {
  return typeof fetch === "function" && !!file && typeof file.arrayBuffer === "function";
}

async function postDocx(endpoints, file, params = {}) {
  if (!canUseServerApi(file)) return null;

  const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
  const errors = [];

  for (const endpoint of endpointList) {
    const url = new URL(endpoint, window.location.origin);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "content-type": file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "x-file-name": encodeURIComponent(file.name || "document.docx"),
        },
        body: file,
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const message = text || `Server DOCX API ${endpoint} failed with ${response.status}`;
        errors.push(message);
        continue;
      }

      const json = await response.json();
      if (!json?.ok) {
        errors.push(json?.error || `Server DOCX API ${endpoint} returned an error.`);
        continue;
      }

      return json;
    } catch (error) {
      errors.push(error?.message || String(error));
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
