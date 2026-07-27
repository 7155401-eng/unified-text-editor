import fs from 'node:fs';

const UI_TAG = 'RAVTEXT_COPYABLE_ERROR_LOG_PATCH_UI';
const GAS_TAG = 'RAVTEXT_COPYABLE_ERROR_LOG_PATCH_GAS';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
function writeIfChanged(path, before, after) {
  if (before === after) {
    console.log(`[copyable-error-log] no changes for ${path}`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[copyable-error-log] patched ${path}`);
}
function assertHas(src, token, path) {
  if (!src.includes(token)) throw new Error(`[copyable-error-log] verification failed in ${path}: missing ${token}`);
}
function replaceOnce(src, needle, replacement, label) {
  if (!src.includes(needle)) throw new Error(`[copyable-error-log] missing anchor: ${label}`);
  return src.replace(needle, replacement);
}

function patchUi() {
  const path = 'src/torah_transcription/torah_transcription_ui.js';
  const before = read(path);
  if (before.includes(UI_TAG)) {
    writeIfChanged(path, before, before);
    return;
  }
  let src = before;

  const oldLogExc = `function logExc(prefix, err) {
  try {
    log(\`\${prefix}\\n\${err && err.stack ? err.stack : err}\`, "ERROR");
  } catch (e) {
    /* swallow */
  }
}
`;
  const newLogExc = `function logExc(prefix, err) {
  try {
    const detail = buildCopyableErrorLog(prefix, err);
    try { window.__ravtextLastErrorLog = detail; } catch (_) {}
    log(detail, "ERROR");
  } catch (e) {
    /* swallow */
  }
}
`;
  src = replaceOnce(src, oldLogExc, newLogExc, 'logExc');

  const oldShow = `function showMessage(title, msg) {
  try {
    window.alert(\`\${title}\\n\\n\${msg}\`);
  } catch (e) {
    /* swallow */
  }
}
`;

  const newShow = `// ${UI_TAG}
function redactErrorText(text) {
  return String(text || "")
    .replace(/(api[_-]?key|access[_-]?code|authorization|x-api-key|xi-api-key)(["'\\\\s:=]+)([^"'\\\\s,}]+)/gi, "$1$2[REDACTED]")
    .replace(/AIza[0-9A-Za-z_\\\\-]{20,}/g, "AIza...[REDACTED]")
    .replace(/sk-[0-9A-Za-z_\\\\-]{12,}/g, "sk-...[REDACTED]");
}

function safeErrorJson(value, depth = 0) {
  if (depth > 3) return "[depth-limit]";
  if (value == null) return value;
  const t = typeof value;
  if (t === "string") return redactErrorText(value.length > 4000 ? value.slice(0, 4000) + "...[truncated]" : value);
  if (t === "number" || t === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => safeErrorJson(v, depth + 1));
  if (t === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) {
      if (/api[_-]?key|access[_-]?code|authorization|password|token|secret/i.test(k)) {
        out[k] = "[REDACTED]";
      } else if (k === "file_blob") {
        out[k] = v ? "[File/Blob present]" : null;
      } else {
        out[k] = safeErrorJson(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function buildCopyableErrorLog(context, err, extra = {}) {
  try {
    const payload = {
      timestamp: new Date().toISOString(),
      context: String(context || "unknown"),
      page: (typeof location !== "undefined" ? location.href : ""),
      user_agent: (typeof navigator !== "undefined" ? navigator.userAgent : ""),
      error_name: err && err.name ? err.name : "",
      error_code: err && err.error_code ? err.error_code : "",
      error_message: err && err.message ? err.message : String(err || ""),
      error_stack: err && err.stack ? String(err.stack) : "",
      error_details: err && err.details ? safeErrorJson(err.details) : null,
      balance_agorot: err && err.balance_agorot != null ? err.balance_agorot : null,
      extra: safeErrorJson(extra),
    };
    return redactErrorText(JSON.stringify(payload, null, 2));
  } catch (e) {
    return redactErrorText(String(context || "") + "\\n" + String(err && err.stack ? err.stack : err));
  }
}

function showMessage(title, msg, details = null) {
  const copyText = details || (typeof window !== "undefined" ? window.__ravtextLastErrorLog : "") || \`\${title}\\n\\n\${msg}\`;
  try {
    const overlay = el("div", {
      style: "position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;direction:rtl;",
    });
    const box = el("div", {
      style: "width:min(760px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:18px;font-family:inherit;color:#111;",
    });
    const titleEl = el("div", { style: "font-weight:800;font-size:20px;margin-bottom:8px;color:#b42318;" }, String(title || "שגיאה"));
    const msgEl = el("div", { style: "white-space:pre-wrap;line-height:1.55;margin-bottom:12px;" }, String(msg || ""));
    const label = el("div", { style: "font-weight:700;margin:12px 0 6px;" }, "לוג מפורט להעתקה:");
    const area = el("textarea", {
      readonly: "readonly",
      style: "width:100%;min-height:210px;direction:ltr;text-align:left;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;border:1px solid #ccd0d5;border-radius:10px;padding:10px;box-sizing:border-box;",
    });
    area.value = String(copyText || "");
    const row = el("div", { style: "display:flex;gap:8px;justify-content:flex-start;margin-top:10px;flex-wrap:wrap;" });
    const copyBtn = el("button", {
      class: "tt-btn tt-btn-primary",
      style: "min-width:auto;",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(area.value);
          copyBtn.textContent = "הועתק";
        } catch (_) {
          area.focus();
          area.select();
          try { document.execCommand("copy"); copyBtn.textContent = "הועתק"; } catch (__) { copyBtn.textContent = "בחר ידנית"; }
        }
      },
    }, "העתק לוג");
    const closeBtn = el("button", {
      class: "tt-btn tt-btn-secondary",
      style: "min-width:auto;",
      onclick: () => overlay.remove(),
    }, "סגור");
    row.appendChild(copyBtn);
    row.appendChild(closeBtn);
    box.appendChild(titleEl);
    box.appendChild(msgEl);
    box.appendChild(label);
    box.appendChild(area);
    box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    try { area.focus(); area.select(); } catch (_) {}
  } catch (e) {
    try { window.alert(\`\${title}\\n\\n\${msg}\\n\\nלוג:\\n\${copyText}\`); } catch (_) {}
  }
}

try {
  window.addEventListener("error", (ev) => {
    window.__ravtextLastErrorLog = buildCopyableErrorLog("window.error", ev.error || ev.message, {
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    window.__ravtextLastErrorLog = buildCopyableErrorLog("unhandledrejection", ev.reason || ev);
  });
} catch (_) {}
`;
  src = replaceOnce(src, oldShow, newShow, 'showMessage');

  src = src.replaceAll(
    `showMessage(fe.title, fe.message);`,
    `showMessage(fe.title, fe.message, buildCopyableErrorLog("AI request failed", e, { friendly: fe, stage: this.currentStep, state: this.appState }));`
  );

  assertHas(src, UI_TAG, path);
  assertHas(src, 'העתק לוג', path);
  assertHas(src, 'buildCopyableErrorLog', path);
  writeIfChanged(path, before, src);
}

function patchGas() {
  const path = 'src/torah_transcription/torah_transcription_gas.js';
  const before = read(path);
  if (before.includes(GAS_TAG)) {
    writeIfChanged(path, before, before);
    return;
  }
  let src = before;
  src = replaceOnce(
    src,
    `export class GasServerError extends Error {
  constructor(errorCode, message = "", balanceAgorot = 0) {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message = message || errorCode;
    this.balance_agorot = balanceAgorot;
  }
}
`,
    `export class GasServerError extends Error {
  constructor(errorCode, message = "", balanceAgorot = 0, details = null) {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message = message || errorCode;
    this.balance_agorot = balanceAgorot;
    this.details = details; // ${GAS_TAG}
  }
}
`,
    'GasServerError constructor'
  );

  src = replaceOnce(
    src,
    `        throw new GasServerError(
          err,
          data.message || "",
          data.balance_agorot || 0
        );
`,
    `        throw new GasServerError(
          err,
          data.message || "",
          data.balance_agorot || 0,
          {
            http_status: response.status,
            response_body: data,
            response_body_chars: text.length,
          }
        );
`,
    'GasServerError throw'
  );

  assertHas(src, GAS_TAG, path);
  assertHas(src, 'response_body_chars', path);
  writeIfChanged(path, before, src);
}

patchUi();
patchGas();
console.log('[copyable-error-log] verification passed');
