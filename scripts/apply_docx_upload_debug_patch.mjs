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
  if (typeof search === 'string') {
    if (!src.includes(search)) throw new Error(`[docx-upload-debug-patch] Missing anchor: ${label}`);
    return src.replace(search, replacement);
  }
  if (!search.test(src)) throw new Error(`[docx-upload-debug-patch] Missing anchor: ${label}`);
  return src.replace(search, replacement);
}

function patchChapterServerApi() {
  let src = read(CHAPTER_API);

  if (!src.includes('function postDocxWithUploadProgress')) {
    const progressBlock = `
function xhrHeadersOf(xhr) {
  const keys = ["content-type", "content-length", "x-docx-api", "x-docx-version", "x-docx-request-id", "cf-ray", "server"];
  const out = {};
  for (const key of keys) {
    try {
      const value = xhr.getResponseHeader(key);
      if (value) out[key] = value;
    } catch {}
  }
  return out;
}

function emitDocxUploadProgress(callbacks, name, payload = {}) {
  try {
    callbacks?.[name]?.(payload);
  } catch (error) {
    console.warn("[docx-api] progress callback failed:", name, error);
  }
  try {
    console.info("[docx-upload]", { event: name, ...payload });
  } catch {}
}

function postDocxWithUploadProgress(url, body, file, callbacks = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const xhrRequestId = requestId();
    const started = performance.now?.() || Date.now();

    xhr.open("POST", url, true);
    xhr.responseType = "text";
    xhr.timeout = callbacks.timeoutMs || 10 * 60 * 1000;

    try { xhr.setRequestHeader("cache-control", "no-store"); } catch {}
    try { xhr.setRequestHeader("x-docx-request-id", xhrRequestId); } catch {}
    try { if (file?.name) xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name)); } catch {}

    emitDocxUploadProgress(callbacks, "onRequestStart", {
      requestId: xhrRequestId,
      url,
      fileName: file?.name || null,
      fileSize: file?.size || body?.byteLength || null,
      bodyBytes: body?.byteLength || null,
    });

    xhr.upload.onloadstart = () => {
      emitDocxUploadProgress(callbacks, "onUploadStart", { requestId: xhrRequestId, url });
    };

    xhr.upload.onprogress = (ev) => {
      const loaded = ev.loaded || 0;
      const total = ev.lengthComputable ? ev.total : (body?.byteLength || file?.size || null);
      emitDocxUploadProgress(callbacks, "onUploadProgress", {
        requestId: xhrRequestId,
        url,
        loaded,
        total,
        percent: total ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : null,
      });
    };

    xhr.upload.onload = () => {
      emitDocxUploadProgress(callbacks, "onUploadDone", {
        requestId: xhrRequestId,
        url,
        elapsedMs: Math.round((performance.now?.() || Date.now()) - started),
        bodyBytes: body?.byteLength || null,
      });
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 2) {
        emitDocxUploadProgress(callbacks, "onServerResponseStart", {
          requestId: xhrRequestId,
          url,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: xhrHeadersOf(xhr),
          elapsedMs: Math.round((performance.now?.() || Date.now()) - started),
        });
      }
    };

    xhr.onload = () => {
      const elapsedMs = Math.round((performance.now?.() || Date.now()) - started);
      const text = xhr.responseText || "";
      let json = null;

      try {
        json = JSON.parse(text);
      } catch (error) {
        reject(new Error(
          "Server returned non-JSON DOCX response | status=" +
          xhr.status +
          " | contentType=" +
          (xhr.getResponseHeader("content-type") || "") +
          " | body=" +
          text.slice(0, 700)
        ));
        return;
      }

      emitDocxUploadProgress(callbacks, "onDone", {
        requestId: xhrRequestId,
        url,
        status: xhr.status,
        elapsedMs,
        serverRequestId: json?.xhrRequestId || xhr.getResponseHeader("x-docx-request-id") || null,
        diagnostics: json?.diagnostics || null,
      });

      if (xhr.status < 200 || xhr.status >= 300 || !json?.ok) {
        reject(new Error(json?.error || ("DOCX API failed with status " + xhr.status)));
        return;
      }

      resolve(json);
    };

    xhr.onerror = () => reject(new Error("DOCX upload network error"));
    xhr.ontimeout = () => reject(new Error("DOCX upload timeout after " + xhr.timeout + "ms"));
    xhr.onabort = () => reject(new Error("DOCX upload aborted"));

    xhr.send(body);
  });
}

export async function importWordChaptersOnServerWithProgress(file, callbacks = {}) {
  if (!canUseServerApi(file)) return null;
  if (typeof XMLHttpRequest === "undefined") return importWordChaptersOnServer(file);

  const urls = endpointUrls(SERVER_IMPORT_ENDPOINTS);
  const bodyStart = performance.now?.() || Date.now();
  emitDocxUploadProgress(callbacks, "onBodyStart", {
    fileName: file?.name || null,
    fileSize: file?.size || null,
  });

  const body = await docxBody(file);
  emitDocxUploadProgress(callbacks, "onBodyReady", {
    fileName: file?.name || null,
    fileSize: file?.size || null,
    bodyBytes: body?.byteLength || null,
    elapsedMs: Math.round((performance.now?.() || Date.now()) - bodyStart),
  });

  if (!urls.length) throw new Error("DOCX API base is not configured.");

  const errors = [];
  for (const url of urls) {
    try {
      return await postDocxWithUploadProgress(url, body, file, callbacks);
    } catch (error) {
      errors.push(error?.message || String(error));
      logDocxApi("warn", { event: "docx_api_xhr_upload_failed", url, error: error?.message || String(error) });
    }
  }

  throw new Error(errors.filter(Boolean).join("\\n") || "Server DOCX API failed.");
}

`;
    src = mustReplace(
      src,
      'export async function importWordChaptersOnServer(file) {',
      `${progressBlock}\nexport async function importWordChaptersOnServer(file) {`,
      'chapter API progress insertion'
    );
  }

  write(CHAPTER_API, src);
}

function patchSplitter() {
  let src = read(SPLITTER);

  if (!src.includes('importWordChaptersOnServerWithProgress')) {
    src = mustReplace(
      src,
      '  importWordChaptersOnServer,\n',
      '  importWordChaptersOnServer,\n  importWordChaptersOnServerWithProgress,\n',
      'splitter import progress function'
    );
  }

  if (!src.includes('onUploadProgress(info)')) {
    const progressCall = `    const scanStartedAt = Date.now();
    loading("מכין את קובץ Word לשליחה...");
    const serverImport = await importWordChaptersOnServerWithProgress(fileObj, {
      onBodyStart() {
        loading("מכין את קובץ Word לשליחה...");
      },
      onBodyReady(info) {
        loading(\`הקובץ מוכן לשליחה: \${fmt(Math.round((info.bodyBytes || info.fileSize || 0) / 1024 / 1024))}MB\`);
      },
      onUploadStart() {
        loading("העלאת הקובץ לשרת התחילה...");
      },
      onUploadProgress(info) {
        if (info.percent != null) {
          loading(\`מעלה לשרת... \${info.percent}%\`);
        } else {
          loading(\`מעלה לשרת... \${fmt(Math.round((info.loaded || 0) / 1024 / 1024))}MB\`);
        }
      },
      onUploadDone(info) {
        loading("ההעלאה לשרת הסתיימה בהצלחה. השרת מתחיל לסרוק כותרות...");
        console.info("[chapter-upload]", {
          event: "upload_done",
          elapsedMs: Date.now() - scanStartedAt,
          requestId: info?.requestId || null,
          fileName: fileObj?.name || null,
          fileSize: fileObj?.size || null,
        });
      },
      onServerResponseStart(info) {
        loading(\`השרת התחיל להחזיר תשובה. status=\${info?.status || ""}\`);
      },
      onDone(info) {
        console.info("[chapter-upload]", {
          event: "server_done",
          elapsedMs: Date.now() - scanStartedAt,
          requestId: info?.requestId || null,
          serverRequestId: info?.serverRequestId || null,
          diagnostics: info?.diagnostics || null,
        });
      },
    });`;

    src = mustReplace(
      src,
      /    loading\("מעלה את קובץ Word לשרת לפני עיבוד\.\.\."\);\n    const serverImport = await importWordChaptersOnServer\(fileObj\);/,
      progressCall,
      'splitter server import progress call'
    );
  }

  write(SPLITTER, src);
}

function patchDocxWorker() {
  let src = read(DOCX_WORKER);

  src = src.replace(
    'const VERSION = "2026-05-26-server-extract";',
    'const VERSION = "2026-05-28-upload-debug";'
  );

  if (!src.includes('const requestStartedAt = Date.now();')) {
    src = mustReplace(
      src,
      '  const url = new URL(request.url);\n\n  log("log", "request_received", {',
      '  const url = new URL(request.url);\n  const requestStartedAt = Date.now();\n\n  log("log", "request_received", {',
      'worker request start timer'
    );
  }

  if (!src.includes('request_body_read_start')) {
    src = mustReplace(
      src,
      `  try {
    const arrayBuffer = await request.arrayBuffer();
    log("log", "request_body_loaded", { requestId: id, path: url.pathname, bytes: arrayBuffer.byteLength });`,
      `  try {
    const bodyReadStartedAt = Date.now();
    log("log", "request_body_read_start", {
      requestId: id,
      path: url.pathname,
      contentLength: request.headers.get("content-length") || "",
      totalMs: Date.now() - requestStartedAt,
    });

    const arrayBuffer = await request.arrayBuffer();
    log("log", "request_body_loaded", {
      requestId: id,
      path: url.pathname,
      bytes: arrayBuffer.byteLength,
      bodyReadMs: Date.now() - bodyReadStartedAt,
      totalMs: Date.now() - requestStartedAt,
    });`,
      'worker request body checkpoint'
    );
  }

  if (!src.includes('docx_zip_load_done')) {
    src = mustReplace(
      src,
      `  log("log", "docx_zip_load_start", { requestId: id, bytes: arrayBuffer.byteLength });

  const zip = await JSZip.loadAsync(arrayBuffer);`,
      `  log("log", "docx_zip_load_start", { requestId: id, bytes: arrayBuffer.byteLength });

  const zipLoadStartedAt = Date.now();
  const zip = await JSZip.loadAsync(arrayBuffer);
  log("log", "docx_zip_load_done", {
    requestId: id,
    bytes: arrayBuffer.byteLength,
    elapsedMs: Date.now() - zipLoadStartedAt,
    totalMs: Date.now() - started,
  });`,
      'worker zip load checkpoint'
    );
  }

  if (!src.includes('docx_xml_loaded')) {
    src = mustReplace(
      src,
      `  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve(""),
  ]);

  const styles = parseStyles(stylesXml || "");
  const bodyXml = documentBodyXml(docXml);
  const { parts, partsMeta, allText } = bodyParts(bodyXml, styles);`,
      `  const xmlLoadStartedAt = Date.now();
  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve(""),
  ]);
  log("log", "docx_xml_loaded", {
    requestId: id,
    elapsedMs: Date.now() - xmlLoadStartedAt,
    totalMs: Date.now() - started,
    docXmlChars: docXml.length,
    stylesXmlChars: (stylesXml || "").length,
  });

  const stylesParseStartedAt = Date.now();
  const styles = parseStyles(stylesXml || "");
  log("log", "docx_styles_parsed", {
    requestId: id,
    elapsedMs: Date.now() - stylesParseStartedAt,
    styleCount: Object.keys(styles || {}).length,
    totalMs: Date.now() - started,
  });

  const bodyExtractStartedAt = Date.now();
  const bodyXml = documentBodyXml(docXml);
  log("log", "docx_body_extracted", {
    requestId: id,
    elapsedMs: Date.now() - bodyExtractStartedAt,
    bodyXmlChars: bodyXml.length,
    totalMs: Date.now() - started,
  });

  const bodyPartsStartedAt = Date.now();
  const { parts, partsMeta, allText } = bodyParts(bodyXml, styles);
  log("log", "docx_body_parts_done", {
    requestId: id,
    elapsedMs: Date.now() - bodyPartsStartedAt,
    parts: parts.length,
    textItems: allText.length,
    totalMs: Date.now() - started,
  });`,
      'worker xml/body checkpoints'
    );
  }

  if (!src.includes('docx_import_done_before_response')) {
    src = mustReplace(
      src,
      `  return {
    ok: true,`,
      `  log("log", "docx_import_done_before_response", {
    requestId: id,
    bytes: arrayBuffer.byteLength,
    parts: parts.length,
    heads1: heads[1]?.length || 0,
    heads2: heads[2]?.length || 0,
    chars: full.length,
    words: countWords(full),
    elapsedMs: Date.now() - started,
  });

  return {
    ok: true,`,
      'worker import before response checkpoint'
    );
  }

  write(DOCX_WORKER, src);
}

patchChapterServerApi();
patchSplitter();
patchDocxWorker();
