// gas_client.py port — verbatim payload structure.
// All AI calls go through Google Apps Script. Per Moshe's rule
// "All AI through GAS" — never call Anthropic/Gemini directly from JS.

export const DEFAULT_GAS_URL = (
  "/api/ai-tools/gas"
);

export class GasServerError extends Error {
  constructor(errorCode, message = "") {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message_text = message;
  }
}
export class GasNetworkError extends Error {
  constructor(m) { super(m); this.name = "GasNetworkError"; }
}
export class GasTimeoutError extends Error {
  constructor(m) { super(m); this.name = "GasTimeoutError"; }
}
export class GasCancelledError extends Error {
  constructor(m) { super(m); this.name = "GasCancelledError"; }
}

function _log(msg, level = "INFO") {
  try {
    console.log(`[${level}] [gas-nikud] ${msg}`);
  } catch (e) { /* noop */ }
}

export class NikudGasClient {
  constructor(opts = {}) {
    this.gasUrl = opts.gasUrl || DEFAULT_GAS_URL;
    this.timeout = opts.timeout || 600 * 1000; // 600s, in ms
    this._cancelled = false;
    this._abort = null;
  }

  cancel() {
    this._cancelled = true;
    try { if (this._abort) this._abort.abort(); } catch (e) { /* noop */ }
  }

  static _providerToModel(provider) {
    if (provider === "gemini") return "gemini-3.1-pro-preview";
    if (provider === "claude") return "claude-opus-4-7";
    throw new Error(`ספק לא ידוע: ${JSON.stringify(provider)}`);
  }

  async judgeWitnesses({
    witnesses,
    torah_mode,
    judge_provider,
    preserve_spelling = false,
    access_code = null,
    api_key = null,
    status_callback = null,
  }) {
    const promptType = torah_mode ? "nikud_judge_torah" : "nikud_judge_regular";
    const modelFull = NikudGasClient._providerToModel(judge_provider);
    const textPayload = witnesses
      .map((w, i) => `--- העתק ${i + 1} ---\n${w}`)
      .join("\n\n");
    const requestBody = {
      prompt_type: promptType,
      model: modelFull,
      text: textPayload,
      preserve_spelling: preserve_spelling,
      use_premium: access_code != null,
    };
    if (access_code) requestBody.access_code = access_code;
    else if (api_key) requestBody.api_key = api_key;
    if (this._cancelled) throw new GasCancelledError("הפעולה בוטלה לפני שליחה");

    _log(
      `POST judge ${promptType} provider=${judge_provider} ` +
      `witnesses=${witnesses.length} chars=${textPayload.length}`
    );

    let response;
    try {
      this._abort = new AbortController();
      const t = setTimeout(() => this._abort.abort(), this.timeout);
      response = await fetch(this.gasUrl, {
        method: "POST",
        body: JSON.stringify(requestBody),
        // Apps Script doesn't permit a custom Content-Type without preflight.
        // Use text/plain; the body is still parsed as JSON server-side.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        signal: this._abort.signal,
      });
      clearTimeout(t);
    } catch (e) {
      if (e && e.name === "AbortError") {
        if (this._cancelled) throw new GasCancelledError("הופסק");
        throw new GasTimeoutError("הדיין: השרת לא הגיב בזמן");
      }
      if (this._cancelled) throw new GasCancelledError("הופסק");
      throw new GasNetworkError(`שגיאה: ${e}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new GasServerError("server_error", "תשובה לא תקינה מהדיין");
    }
    const err = data.error || "";
    if (err) throw new GasServerError(err, data.message || "");
    return data;
  }

  async vocalize({
    text,
    torah_mode,
    provider,
    preserve_spelling = false,
    access_code = null,
    api_key = null,
    retry_on_quota = 2,
    retry_wait_sec = 60,
    status_callback = null,
  }) {
    if (provider !== "gemini" && provider !== "claude") {
      throw new Error(`ספק לא ידוע: ${JSON.stringify(provider)}`);
    }
    const promptType = torah_mode ? "nikud_torah" : "nikud_regular";
    const modelFull = NikudGasClient._providerToModel(provider);
    const requestBody = {
      prompt_type: promptType,
      model: modelFull,
      text: text,
      preserve_spelling: preserve_spelling,
      use_premium: access_code != null,
    };
    if (access_code) requestBody.access_code = access_code;
    else if (api_key) requestBody.api_key = api_key;
    if (this._cancelled) throw new GasCancelledError("הפעולה בוטלה לפני שליחה");

    try {
      const logBody = { ...requestBody };
      delete logBody.text; delete logBody.api_key; delete logBody.access_code;
      logBody._text_chars = (text || "").length;
      logBody._has_api_key = !!requestBody.api_key;
      logBody._has_access_code = !!requestBody.access_code;
      _log(`POST ${promptType} provider=${provider} body_summary=${JSON.stringify(logBody)}`);
    } catch (e) { /* noop */ }

    const attemptsLeft = Math.max(1, retry_on_quota + 1);
    let attempt = 0;
    /* eslint-disable no-constant-condition */
    while (true) {
      attempt += 1;
      _log(`attempt ${attempt}/${attemptsLeft}: sending POST...`);
      const t0 = Date.now();
      let response;
      try {
        this._abort = new AbortController();
        const tHandle = setTimeout(() => this._abort.abort(), this.timeout);
        response = await fetch(this.gasUrl, {
          method: "POST",
          body: JSON.stringify(requestBody),
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          signal: this._abort.signal,
        });
        clearTimeout(tHandle);
      } catch (e) {
        const elapsed = (Date.now() - t0) / 1000;
        if (e && e.name === "AbortError") {
          _log(`timeout after ${elapsed.toFixed(1)}s`, "ERROR");
          if (this._cancelled) throw new GasCancelledError("הפעולה בוטלה במהלך הקריאה");
          throw new GasTimeoutError("השרת לא הגיב בזמן");
        }
        _log(`unexpected error after ${elapsed.toFixed(1)}s: ${e}`, "ERROR");
        if (this._cancelled) throw new GasCancelledError("הפעולה בוטלה");
        throw new GasNetworkError(`שגיאת חיבור: ${e}`);
      }

      const elapsed = (Date.now() - t0) / 1000;
      let bodyText = "";
      try { bodyText = await response.text(); } catch (e) { /* noop */ }
      _log(`got HTTP ${response.status} after ${elapsed.toFixed(1)}s, body_chars=${bodyText.length}`);

      let data;
      try { data = JSON.parse(bodyText); }
      catch (e) {
        _log(`non-JSON response: ${bodyText.slice(0, 300)}`, "ERROR");
        throw new GasServerError("server_error", "תשובה לא תקינה מהשרת");
      }

      const err = data.error || "";
      const errLower = (err + " " + (data.message || "")).toLowerCase();
      const isQuota = (
        errLower.includes("rate limit") ||
        errLower.includes("429") ||
        errLower.includes("quota") ||
        errLower.includes("resource_exhausted")
      );

      if (err && isQuota && attempt < attemptsLeft) {
        if (status_callback) {
          try {
            status_callback(
              `חרגת ממכסה זמנית — ממתין ${retry_wait_sec} שניות וננסה שוב ` +
              `(ניסיון ${attempt + 1}/${attemptsLeft})`
            );
          } catch (e) { /* noop */ }
        }
        for (let i = 0; i < retry_wait_sec; i++) {
          if (this._cancelled) throw new GasCancelledError("הופסק בזמן המתנה");
          await new Promise(r => setTimeout(r, 1000));
        }
        continue;
      }
      if (err) throw new GasServerError(err, data.message || "");
      return data;
    }
  }
}
