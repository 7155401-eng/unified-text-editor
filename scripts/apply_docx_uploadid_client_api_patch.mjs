import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'src/chapter_cache/chapter_server_api.js';

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, value) {
  writeFileSync(path, value, 'utf8');
}

function must(src, search, replacement, label) {
  if (!src.includes(search)) throw new Error(`[docx-uploadid-client-api] Missing anchor: ${label}`);
  return src.replace(search, replacement);
}

const apiBlock = `
const SERVER_UPLOAD_ONLY_ENDPOINTS = ["/api/word-chapters-upload", "/api/word-chapters/upload"];
const SERVER_SCAN_UPLOADED_ENDPOINTS = ["/api/word-chapters-scan-upload", "/api/word-chapters/scan-upload"];
const SERVER_EXTRACT_UPLOADED_ENDPOINTS = ["/api/word-chapters-extract-upload", "/api/word-chapters/extract-upload"];
const SERVER_FULL_UPLOADED_ENDPOINTS = ["/api/word-chapters-full-upload", "/api/word-chapters/full-upload"];
const SERVER_DELETE_UPLOAD_ENDPOINTS = ["/api/word-chapters-delete-upload", "/api/word-chapters/delete-upload"];

async function postJsonToFirstEndpoint(endpoints, params = {}) {
  const urls = endpointUrls(endpoints).map((url) => appendParams(url, params));
  const errors = [];

  if (!urls.length) throw new Error("DOCX API base is not configured.");

  for (const url of urls) {
    const id = requestId();
    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        mode: "cors",
        headers: {
          "x-docx-request-id": id,
        },
      });

      const text = await readText(response);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (error) {
        throw new Error("Server returned non-JSON DOCX response | status=" + response.status + " | body=" + snippet(text));
      }

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || ("DOCX API failed with status " + response.status));
      }

      return json;
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  throw new Error(errors.filter(Boolean).join("\\n") || "DOCX API failed.");
}

export async function uploadWordChapterFileOnly(file, callbacks = {}) {
  if (!canUseServerApi(file)) return null;
  if (typeof XMLHttpRequest === "undefined") {
    throw new Error("Upload progress requires XMLHttpRequest.");
  }

  const urls = endpointUrls(SERVER_UPLOAD_ONLY_ENDPOINTS);
  if (!urls.length) throw new Error("DOCX API base is not configured.");

  callbacks?.onBodyStart?.({
    fileName: file?.name || null,
    fileSize: file?.size || null,
  });

  const body = await docxBody(file);

  callbacks?.onBodyReady?.({
    fileName: file?.name || null,
    fileSize: file?.size || null,
    bodyBytes: body?.byteLength || null,
  });

  const errors = [];
  for (const url of urls) {
    try {
      return await postDocxWithUploadProgress(url, body, file, callbacks);
    } catch (error) {
      errors.push(error?.message || String(error));
      logDocxApi("warn", { event: "docx_upload_only_failed", url, error: error?.message || String(error) });
    }
  }

  throw new Error(errors.filter(Boolean).join("\\n") || "DOCX upload failed.");
}

export async function scanUploadedWordChapters(uploadId) {
  return postJsonToFirstEndpoint(SERVER_SCAN_UPLOADED_ENDPOINTS, { uploadId });
}

export async function extractUploadedWordChapter(uploadId, { level, index }) {
  return postJsonToFirstEndpoint(SERVER_EXTRACT_UPLOADED_ENDPOINTS, { uploadId, level, index });
}

export async function extractUploadedWordFull(uploadId) {
  return postJsonToFirstEndpoint(SERVER_FULL_UPLOADED_ENDPOINTS, { uploadId });
}

export async function deleteUploadedWordChapterFile(uploadId) {
  return postJsonToFirstEndpoint(SERVER_DELETE_UPLOAD_ENDPOINTS, { uploadId });
}

`;

let src = read(TARGET);

if (!src.includes('SERVER_UPLOAD_ONLY_ENDPOINTS')) {
  src = must(
    src,
    'export async function importWordChaptersOnServer(file) {',
    `${apiBlock}export async function importWordChaptersOnServer(file) {`,
    'insert uploadId client API helpers'
  );
}

src = src.replace(
  'serverDocumentId: serverScan.serverDocumentId || serverScan.fileHash || null,',
  'serverDocumentId: serverScan.uploadId || serverScan.serverDocumentId || serverScan.fileHash || null,'
);
src = src.replace(
  'fileHash: serverScan.fileHash || serverScan.serverDocumentId || null,',
  'uploadId: serverScan.uploadId || null,\n    fileHash: serverScan.fileHash || serverScan.serverDocumentId || null,'
);

write(TARGET, src);
