// לקוח לשרת Google Apps Script — כל הנחיות הבינה במקום אחד בלבד: בשרת.

// === כתובת ה-Web App מגיעה מ-gas_config.py בריפו (מקור-אמת יחיד) ===
// RAVTEXT_GAS_URL גובר אם הוגדר.
export const DEFAULT_GAS_URL = (
  "https://script.google.com/macros/s/" +
  "AKfycbyvt7yUPa2jNiTtTzKli8R8GmNI_plIeOwwFuTgu733es5mFfhEKcTcInP3yzFnlQQCvw" +
  "/exec"
);

function _log(msg, level = "INFO") {
  try {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    console.log(`[${ts}] [${level}] [gas] ${msg}`);
  } catch (e) {
    /* swallow */
  }
}

// ===== Exceptions =====

export class GasServerError extends Error {
  constructor(errorCode, message = "", balanceAgorot = 0) {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message = message || errorCode;
    this.balance_agorot = balanceAgorot;
  }
}

export class GasNetworkError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "GasNetworkError";
  }
}

export class GasTimeoutError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "GasTimeoutError";
  }
}

export class GasCancelledError extends Error {
  // המשתמש לחץ על "בטל" באמצע פעולה.
  constructor(msg) {
    super(msg);
    this.name = "GasCancelledError";
  }
}

// ===== File-type helpers =====

export const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"]);
export const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"]);
export const PDF_EXTS = new Set([".pdf"]);

function _suffixLower(name) {
  const s = String(name || "");
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i).toLowerCase() : "";
}

function _basename(name) {
  const s = String(name || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function detectFileType(filePathOrName) {
  const ext = _suffixLower(filePathOrName);
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (PDF_EXTS.has(ext)) return "pdf";
  return "unknown";
}

function _mimeForPath(filePathOrName) {
  const ext = _suffixLower(filePathOrName);
  const map = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
    ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".ogg": "audio/ogg", ".flac": "audio/flac",
    ".mp4": "video/mp4", ".mov": "video/quicktime",
    ".pdf": "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

async function _fileToBase64(file) {
  // file הוא File/Blob (או אובייקט {name, mime, blob}). מחזיר base64 ASCII.
  const blob = file instanceof Blob ? file : file.blob;
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===== Client =====

export class GasClient {
  constructor(gasUrl = null, timeout = 600) {
    this.gas_url = gasUrl || DEFAULT_GAS_URL;
    this.timeout = timeout; // seconds
    this._cancelled = false;
    this._abortCtrl = null;
  }

  cancel() {
    // ביטול חיצוני — סוגר את החיבור הפעיל וגורם ל-call לזרוק
    // GasCancelledError. בטוח לקרוא מ-thread אחר.
    this._cancelled = true;
    try {
      if (this._abortCtrl) this._abortCtrl.abort();
    } catch (e) {
      /* swallow */
    }
  }

  async call({
    prompt_type,
    model,
    access_code = null,
    api_key = null,
    files = null,            // [{name, mime, blob}] OR [File]
    text_payload = null,
    ocr_examples = null,     // [{handwriting: File, typed: File}]
    custom_prompt = null,
    torah_mode = true,
    ashkenazi = false,
    retry_on_quota = 2,
    retry_wait_sec = 60,
    status_callback = null,
    engines_used = null,
    preferred_engine = null,
    language_code = null,
  } = {}) {
    const filesData = [];
    if (files && files.length) {
      for (const f of files) {
        const name = f.name || (f.blob && f.blob.name) || "file";
        const mime = f.mime || f.type || _mimeForPath(name);
        const b64 = await _fileToBase64(f);
        filesData.push({
          name: _basename(name),
          type: detectFileType(name),
          mime: mime,
          content_base64: b64,
        });
      }
    }

    const requestBody = {
      prompt_type: prompt_type,
      model: model,
      use_premium: access_code != null,
      torah_mode: torah_mode,
      ashkenazi: ashkenazi,
    };

    if (access_code) {
      requestBody.access_code = access_code;
    } else if (api_key) {
      requestBody.api_key = api_key;
    }

    if (filesData.length) {
      requestBody.files = filesData;
    }
    if (text_payload) {
      requestBody.text = text_payload;
    }
    if (custom_prompt) {
      requestBody.custom_prompt = custom_prompt;
    }
    if (ocr_examples && ocr_examples.length) {
      const examplesData = [];
      for (const ex of ocr_examples) {
        const hw = ex.handwriting;
        const typed = ex.typed;
        const hwName = hw.name || "handwriting";
        const typedName = typed.name || "typed";
        examplesData.push({
          handwriting_name: _basename(hwName),
          handwriting_mime: hw.type || _mimeForPath(hwName),
          handwriting_base64: await _fileToBase64(hw),
          typed_name: _basename(typedName),
          typed_mime: typed.type || _mimeForPath(typedName),
          typed_base64: await _fileToBase64(typed),
        });
      }
      requestBody.ocr_examples = examplesData;
      requestBody.has_examples = true;
    }
    if (engines_used) {
      requestBody.engines_used = Array.from(engines_used);
    }
    if (preferred_engine) {
      requestBody.preferred_engine = preferred_engine;
    }
    if (language_code) {
      requestBody.language_code = language_code;
    }

    if (this._cancelled) {
      throw new GasCancelledError("הפעולה בוטלה לפני שליחה");
    }

    // מסיר את השדות הכבדים מהלוג כדי לא לכתוב megabytes של base64
    try {
      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code"]);
      const logBody = {};
      for (const [k, v] of Object.entries(requestBody)) {
        if (!heavy.has(k)) logBody[k] = v;
      }
      logBody._files_count = (requestBody.files || []).length;
      logBody._text_chars = (requestBody.text || "").length;
      logBody._has_api_key = !!requestBody.api_key;
      logBody._has_access_code = !!requestBody.access_code;
      _log(`POST ${prompt_type} model=${model} body_summary=${JSON.stringify(logBody)}`);
    } catch (e) {
      /* swallow */
    }

    const attemptsLeft = Math.max(1, retry_on_quota + 1);
    let attempt = 0;
    while (true) {
      attempt += 1;
      _log(`attempt ${attempt}/${attemptsLeft}: sending POST...`);
      const t0 = Date.now();
      let response;
      this._abortCtrl = new AbortController();
      const timeoutId = setTimeout(
        () => this._abortCtrl.abort(),
        this.timeout * 1000
      );
      try {
        response = await fetch(this.gas_url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          // GAS web apps require simple content-type to avoid CORS preflight.
          body: JSON.stringify(requestBody),
          signal: this._abortCtrl.signal,
        });
      } catch (e) {
        const elapsed = (Date.now() - t0) / 1000;
        if (e.name === "AbortError") {
          if (this._cancelled) {
            _log(`aborted by user after ${elapsed.toFixed(1)}s`, "ERROR");
            throw new GasCancelledError("הפעולה בוטלה במהלך הקריאה");
          }
          _log(`timeout after ${elapsed.toFixed(1)}s`, "ERROR");
          throw new GasTimeoutError("השרת לא הגיב בזמן");
        }
        _log(
          `unexpected error after ${elapsed.toFixed(1)}s: ${e.name}: ${e.message}`,
          "ERROR"
        );
        if (this._cancelled) {
          throw new GasCancelledError("הפעולה בוטלה");
        }
        throw new GasNetworkError(`שגיאת חיבור: ${e.message}`);
      } finally {
        clearTimeout(timeoutId);
      }

      const elapsed = (Date.now() - t0) / 1000;
      const text = await response.text();
      _log(
        `got HTTP ${response.status} after ${elapsed.toFixed(1)}s, body_chars=${text.length}`
      );

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        _log(`non-JSON response: ${JSON.stringify(text.slice(0, 300))}`, "ERROR");
        throw new GasServerError("server_error", "תשובה לא תקינה מהשרת");
      }

      const err = data.error || "";
      const errLower = (err + " " + (data.message || "")).toLowerCase();
      const isQuota = (
        errLower.includes("rate limit") ||
        errLower.includes("429") ||
        errLower.includes("ai_quota_exceeded") ||
        errLower.includes("resource_exhausted") ||
        errLower.includes("quota")
      );

      if (err) {
        _log(
          `server returned error: ${err} | message=${(data.message || "").slice(0, 200)}`,
          isQuota ? "WARN" : "ERROR"
        );
      }

      if (err && isQuota && attempt < attemptsLeft) {
        // ממתין retry_wait_sec שניות (בודק ביטול כל שנייה) ומנסה שוב
        if (status_callback) {
          try {
            status_callback(
              `חרגת ממכסה זמנית — ממתין ${retry_wait_sec} שניות ` +
              `וננסה שוב (ניסיון ${attempt + 1} מתוך ${attemptsLeft})`
            );
          } catch (e) {
            /* swallow */
          }
        }
        for (let i = 0; i < retry_wait_sec; i++) {
          if (this._cancelled) {
            throw new GasCancelledError("הופסק בזמן המתנה");
          }
          await _sleep(1000);
        }
        continue;
      }

      if (err) {
        throw new GasServerError(
          err,
          data.message || "",
          data.balance_agorot || 0
        );
      }

      return data;
    }
  }
}
