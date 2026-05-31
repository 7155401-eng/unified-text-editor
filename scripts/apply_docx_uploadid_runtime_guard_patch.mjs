import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'src/document_chapter_splitter.js';

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, value) {
  writeFileSync(path, value, 'utf8');
}

function must(src, search, replacement, label) {
  if (!src.includes(search)) throw new Error(`[docx-uploadid-runtime-guard] Missing anchor: ${label}`);
  return src.replace(search, replacement);
}

const guard = `
const DOCX_UPLOAD_ONLY_ENDPOINTS_SAFE = ["/api/word-chapters-upload", "/api/word-chapters/upload"];
const DOCX_SCAN_UPLOADED_ENDPOINTS_SAFE = ["/api/word-chapters-scan-upload", "/api/word-chapters/scan-upload"];
const DOCX_EXTRACT_UPLOADED_ENDPOINTS_SAFE = ["/api/word-chapters-extract-upload", "/api/word-chapters/extract-upload"];
const DOCX_FULL_UPLOADED_ENDPOINTS_SAFE = ["/api/word-chapters-full-upload", "/api/word-chapters/full-upload"];
const DOCX_DELETE_UPLOAD_ENDPOINTS_SAFE = ["/api/word-chapters-delete-upload", "/api/word-chapters/delete-upload"];

function docxUploadIdOriginsSafe() {
  const out = [];
  const seen = new Set();
  function add(raw) {
    const value = String(raw || "").trim();
    if (!value) return;
    try {
      const origin = new URL(value, window.location.origin).origin;
      if (!seen.has(origin)) { seen.add(origin); out.push(origin); }
    } catch {}
  }
  try { add(window.__DOCX_API_BASE__); } catch {}
  try { add(import.meta.env?.VITE_DOCX_API_BASE); } catch {}
  try { add(window.location.origin); } catch {}
  return out;
}

function docxUploadIdUrlsSafe(endpoints, params = {}) {
  const urls = [];
  const seen = new Set();
  for (const origin of docxUploadIdOriginsSafe()) {
    for (const endpoint of endpoints) {
      try {
        const url = new URL(endpoint, origin);
        for (const [key, value] of Object.entries(params || {})) {
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
        const text = url.toString();
        if (!seen.has(text)) { seen.add(text); urls.push(text); }
      } catch {}
    }
  }
  return urls;
}

function docxUploadIdRequestIdSafe() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return \`docx-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2, 10)}\`;
}

async function docxPostJsonSafe(endpoints, params = {}) {
  const errors = [];
  for (const url of docxUploadIdUrlsSafe(endpoints, params)) {
    const requestId = docxUploadIdRequestIdSafe();
    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        mode: "cors",
        headers: { "x-docx-request-id": requestId },
      });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch {
        throw new Error("Server returned non-JSON DOCX response | status=" + response.status + " | body=" + String(text || "").slice(0, 500));
      }
      if (!response.ok || !json?.ok) throw new Error(json?.error || ("DOCX API failed with status " + response.status));
      return json;
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }
  throw new Error(errors.filter(Boolean).join("\\n") || "DOCX API failed.");
}

function docxUploadWithProgressSafe(url, body, file, callbacks = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const requestId = docxUploadIdRequestIdSafe();
    xhr.open("POST", url, true);
    xhr.responseType = "text";
    xhr.setRequestHeader("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    xhr.setRequestHeader("x-docx-request-id", requestId);
    try { if (file?.name) xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name)); } catch {}

    xhr.upload.onloadstart = () => callbacks?.onUploadStart?.({ requestId, url });
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : (body?.byteLength || file?.size || null);
      const loaded = event.loaded || 0;
      callbacks?.onUploadProgress?.({
        requestId,
        url,
        loaded,
        total,
        percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : null,
      });
    };

    xhr.onerror = () => reject(new Error("DOCX upload network error."));
    xhr.onabort = () => reject(new Error("DOCX upload aborted."));
    xhr.ontimeout = () => reject(new Error("DOCX upload timed out."));

    xhr.onload = () => {
      let json;
      try { json = JSON.parse(xhr.responseText || "{}"); } catch {
        reject(new Error("Server returned non-JSON DOCX response | status=" + xhr.status + " | body=" + String(xhr.responseText || "").slice(0, 500)));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !json?.ok) {
        reject(new Error(json?.error || ("DOCX upload failed with status " + xhr.status)));
        return;
      }
      callbacks?.onUploadDone?.({ ...json, requestId, url });
      resolve(json);
    };

    xhr.send(body);
  });
}

async function uploadWordChapterFileOnlySafe(file, callbacks = {}) {
  if (typeof uploadWordChapterFileOnly === "function") {
    return uploadWordChapterFileOnly(file, callbacks);
  }
  if (!file?.arrayBuffer) throw new Error("לא נבחר קובץ DOCX תקין.");
  if (typeof XMLHttpRequest === "undefined") throw new Error("Upload progress requires XMLHttpRequest.");

  callbacks?.onBodyStart?.({ fileName: file?.name || null, fileSize: file?.size || null });
  const body = await file.arrayBuffer();
  callbacks?.onBodyReady?.({ fileName: file?.name || null, fileSize: file?.size || null, bodyBytes: body?.byteLength || null });

  const errors = [];
  for (const url of docxUploadIdUrlsSafe(DOCX_UPLOAD_ONLY_ENDPOINTS_SAFE)) {
    try {
      return await docxUploadWithProgressSafe(url, body, file, callbacks);
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }
  throw new Error(errors.filter(Boolean).join("\\n") || "DOCX upload failed.");
}

async function scanUploadedWordChaptersSafe(uploadId) {
  if (typeof scanUploadedWordChapters === "function") return scanUploadedWordChapters(uploadId);
  return docxPostJsonSafe(DOCX_SCAN_UPLOADED_ENDPOINTS_SAFE, { uploadId });
}

async function extractUploadedWordChapterSafe(uploadId, args) {
  if (typeof extractUploadedWordChapter === "function") return extractUploadedWordChapter(uploadId, args);
  return docxPostJsonSafe(DOCX_EXTRACT_UPLOADED_ENDPOINTS_SAFE, { uploadId, level: args?.level, index: args?.index });
}

async function extractUploadedWordFullSafe(uploadId) {
  if (typeof extractUploadedWordFull === "function") return extractUploadedWordFull(uploadId);
  return docxPostJsonSafe(DOCX_FULL_UPLOADED_ENDPOINTS_SAFE, { uploadId, level: 0 });
}

async function deleteUploadedWordChapterFileSafe(uploadId) {
  if (typeof deleteUploadedWordChapterFile === "function") return deleteUploadedWordChapterFile(uploadId);
  return docxPostJsonSafe(DOCX_DELETE_UPLOAD_ENDPOINTS_SAFE, { uploadId });
}

`;

let src = read(TARGET);

if (!src.includes('function uploadWordChapterFileOnlySafe(')) {
  if (src.includes('\nfunction renderPostUploadMenu() {')) {
    src = must(src, '\nfunction renderPostUploadMenu() {', `\n${guard}\nfunction renderPostUploadMenu() {`, 'insert guard before upload menu');
  } else {
    src = must(src, '\nasync function scanFile(fileObj, thisToken) {', `\n${guard}\nasync function scanFile(fileObj, thisToken) {`, 'insert guard before scanFile');
  }
}

src = src.replaceAll('uploadWordChapterFileOnly(fileObj', 'uploadWordChapterFileOnlySafe(fileObj');
src = src.replaceAll('await scanUploadedWordChapters(uploadedDocx.uploadId)', 'await scanUploadedWordChaptersSafe(uploadedDocx.uploadId)');
src = src.replaceAll('await extractUploadedWordFull(uploadedDocx.uploadId)', 'await extractUploadedWordFullSafe(uploadedDocx.uploadId)');
src = src.replaceAll('await deleteUploadedWordChapterFile(uploadedDocx.uploadId)', 'await deleteUploadedWordChapterFileSafe(uploadedDocx.uploadId)');
src = src.replaceAll('await extractUploadedWordChapter(state.uploadId,', 'await extractUploadedWordChapterSafe(state.uploadId,');

src = src.replace(
  `if (state?.serverSide && state?.uploadId) {
      loading(\`מחלץ את הפרק מהקובץ שכבר הועלה: \${chapterIndex + 1}...\`);
      const serverChapter = await extractUploadedWordChapterSafe(state.uploadId, {
        level: selectedLevel,
        index: chapterIndex,
      });
    } else if (state?.serverSide) {
      loading(\`מחלץ את הפרק בצד שרת: \${chapterIndex + 1}...\`);
      const serverChapter = await extractWordChapterOnServer(selectedFile, {
        level: selectedLevel,
        index: chapterIndex,
      });`,
  `if (state?.serverSide) {
      let serverChapter;
      if (state?.uploadId) {
        loading(\`מחלץ את הפרק מהקובץ שכבר הועלה: \${chapterIndex + 1}...\`);
        serverChapter = await extractUploadedWordChapterSafe(state.uploadId, {
          level: selectedLevel,
          index: chapterIndex,
        });
      } else {
        loading(\`מחלץ את הפרק בצד שרת: \${chapterIndex + 1}...\`);
        serverChapter = await extractWordChapterOnServer(selectedFile, {
          level: selectedLevel,
          index: chapterIndex,
        });
      }`
);

write(TARGET, src);
