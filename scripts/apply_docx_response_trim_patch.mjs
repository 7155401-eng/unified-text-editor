import { readFileSync, writeFileSync } from 'node:fs';

const CHAPTER_API = 'src/chapter_cache/chapter_server_api.js';
const SPLITTER = 'src/document_chapter_splitter.js';
const DOCX_WORKER = 'cloudflare/docx_worker_entry.js';

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, value) {
  writeFileSync(path, value, 'utf8');
}

function mustReplace(src, search, replacement, label) {
  if (!src.includes(search)) {
    throw new Error(`[docx-response-trim-patch] Missing anchor: ${label}`);
  }
  return src.replace(search, replacement);
}

function patchChapterServerApi() {
  let src = read(CHAPTER_API);

  if (!src.includes('"onResponseProgress"')) {
    src = mustReplace(
      src,
      `    xhr.onload = () => {`,
      `    xhr.onprogress = () => {
      const responseChars = xhr.responseText ? xhr.responseText.length : 0;
      emitDocxUploadProgress(callbacks, "onResponseProgress", {
        requestId: xhrRequestId,
        url,
        status: xhr.status,
        responseChars,
        responseMb: Math.round((responseChars / 1024 / 1024) * 10) / 10,
        elapsedMs: Math.round((performance.now?.() || Date.now()) - started),
      });
    };

    xhr.onload = () => {`,
      'response download progress'
    );
  }

  if (!src.includes('"onResponseBodyDone"')) {
    src = mustReplace(
      src,
      `      let json = null;

      try {
        json = JSON.parse(text);
      } catch (error) {`,
      `      let json = null;

      emitDocxUploadProgress(callbacks, "onResponseBodyDone", {
        requestId: xhrRequestId,
        url,
        status: xhr.status,
        responseChars: text.length,
        responseMb: Math.round((text.length / 1024 / 1024) * 10) / 10,
        elapsedMs,
      });

      const parseStarted = performance.now?.() || Date.now();

      try {
        json = JSON.parse(text);
      } catch (error) {`,
      'response body done before JSON.parse'
    );
  }

  if (!src.includes('"onJsonParsed"')) {
    src = mustReplace(
      src,
      `        return;
      }

      emitDocxUploadProgress(callbacks, "onDone", {`,
      `        return;
      }

      emitDocxUploadProgress(callbacks, "onJsonParsed", {
        requestId: xhrRequestId,
        url,
        status: xhr.status,
        parseMs: Math.round((performance.now?.() || Date.now()) - parseStarted),
        keys: json ? Object.keys(json) : [],
        partsMetaLength: Array.isArray(json?.partsMeta) ? json.partsMeta.length : null,
        diagnostics: json?.diagnostics || null,
      });

      emitDocxUploadProgress(callbacks, "onDone", {`,
      'JSON.parse done diagnostics'
    );
  }

  write(CHAPTER_API, src);
}

function patchSplitter() {
  let src = read(SPLITTER);

  if (!src.includes('onResponseProgress(info)')) {
    src = mustReplace(
      src,
      `      onServerResponseStart(info) {
        loading(\`השרת התחיל להחזיר תשובה. status=\${info?.status || ""}\`);
      },
      onDone(info) {`,
      `      onServerResponseStart(info) {
        loading(\`השרת סיים לעבד והתחיל לשלוח את רשימת הכותרות. status=\${info?.status || ""}\`);
      },
      onResponseProgress(info) {
        loading(\`מקבל רשימת כותרות מהשרת... \${fmt(Math.round((info.responseChars || 0) / 1024 / 1024))}MB התקבלו\`);
      },
      onResponseBodyDone(info) {
        loading(\`התקבלה תשובת שרת. מפענח נתונים... \${fmt(Math.round((info.responseChars || 0) / 1024 / 1024))}MB\`);
        console.info("[chapter-upload]", {
          event: "response_body_done",
          elapsedMs: Date.now() - scanStartedAt,
          requestId: info?.requestId || null,
          responseChars: info?.responseChars || 0,
          responseMb: info?.responseMb || null,
        });
      },
      onJsonParsed(info) {
        loading("תשובת השרת פוענחה. בונה רשימת כותרות...");
        console.info("[chapter-upload]", {
          event: "json_parsed",
          elapsedMs: Date.now() - scanStartedAt,
          requestId: info?.requestId || null,
          parseMs: info?.parseMs || null,
          keys: info?.keys || [],
          partsMetaLength: info?.partsMetaLength ?? null,
          diagnostics: info?.diagnostics || null,
        });
      },
      onDone(info) {`,
      'splitter response progress callbacks'
    );
  }

  write(SPLITTER, src);
}

function patchDocxWorker() {
  let src = read(DOCX_WORKER);

  src = src.replace(
    'const VERSION = "2026-05-28-upload-debug";',
    'const VERSION = "2026-05-28-large-response-debug";'
  );

  if (!src.includes('partsMetaOmitted')) {
    src = mustReplace(
      src,
      `    words: countWords(full),
    partsMeta,
    diagnostics,`,
      `    words: countWords(full),
    diagnostics: {
      ...diagnostics,
      partsMetaOmitted: true,
      partsMetaCount: partsMeta.length,
    },`,
      'omit partsMeta from DOCX import response'
    );
  }

  write(DOCX_WORKER, src);
}

patchChapterServerApi();
patchSplitter();
patchDocxWorker();
