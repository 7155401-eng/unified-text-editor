// dicta_client.py port — calls Dicta nakdan (non-LLM, algorithmic, free).
// Verbatim translation. NOTE per Moshe's "All AI through GAS" rule:
// Dicta is *not* an LLM — it is a deterministic trained-model API offered
// by Dicta. The Python original calls it directly; we keep the same
// behavior. If you want to route through GAS, see MIGRATION_NOTES.md.

const DEFAULT_DICTA_URL = "https://nakdan-2-0.loadbalancer.dicta.org.il/api";
const MAX_CHARS_PER_REQUEST = 5000;

function _log(msg, level = "INFO") {
  try { console.log(`[${level}] [dicta] ${msg}`); } catch (e) { /* noop */ }
}

export class DictaServerError extends Error {
  constructor(code, message = "") {
    super(message || code);
    this.name = "DictaServerError";
    this.code = code;
    this.message_text = message;
  }
}
export class DictaNetworkError extends Error {
  constructor(m) { super(m); this.name = "DictaNetworkError"; }
}
export class DictaTimeoutError extends Error {
  constructor(m) { super(m); this.name = "DictaTimeoutError"; }
}
export class DictaCancelledError extends Error {
  constructor(m) { super(m); this.name = "DictaCancelledError"; }
}

export class NikudDictaClient {
  constructor(opts = {}) {
    this.url = opts.url || DEFAULT_DICTA_URL;
    this.timeout = opts.timeout || 120 * 1000;
    this._cancelled = false;
    this._abort = null;
  }

  cancel() {
    this._cancelled = true;
    try { if (this._abort) this._abort.abort(); } catch (e) { /* noop */ }
  }

  // Same interface as NikudGasClient.vocalize so callers can swap providers.
  async vocalize({
    text,
    torah_mode,
    preserve_spelling = false,
    status_callback = null,
  }) {
    if (!(text || "").trim()) {
      throw new DictaServerError("empty_input", "אין טקסט לניקוד.");
    }
    const genre = torah_mode ? "rabbinic" : "modern";
    const chunks = this._splitChunks(text);
    const outParts = [];
    for (let i = 0; i < chunks.length; i++) {
      if (this._cancelled) throw new DictaCancelledError("הופסק");
      if (status_callback) {
        try { status_callback(`דיקטה: חלק ${i + 1}/${chunks.length}`); }
        catch (e) { /* noop */ }
      }
      outParts.push(await this._vocalizeChunk(chunks[i], genre, preserve_spelling));
    }
    return { text: outParts.join("") };
  }

  // ----- helpers -----

  _splitChunks(text) {
    if (text.length <= MAX_CHARS_PER_REQUEST) return [text];
    const parts = [];
    let buf = "";
    // Keep line endings (Python's splitlines(keepends=True))
    const lines = text.split(/(?<=\n)/);
    for (const line of lines) {
      if (line.length > MAX_CHARS_PER_REQUEST) {
        if (buf) { parts.push(buf); buf = ""; }
        let wordBuf = "";
        for (const word of line.split(" ")) {
          const seg = word + " ";
          if (wordBuf.length + seg.length > MAX_CHARS_PER_REQUEST && wordBuf) {
            parts.push(wordBuf); wordBuf = "";
          }
          wordBuf += seg;
        }
        if (wordBuf) {
          if (wordBuf.endsWith(" ")) wordBuf = wordBuf.slice(0, -1);
          parts.push(wordBuf);
        }
        continue;
      }
      if (buf.length + line.length > MAX_CHARS_PER_REQUEST && buf) {
        parts.push(buf); buf = "";
      }
      buf += line;
    }
    if (buf) parts.push(buf);
    return parts;
  }

  async _vocalizeChunk(chunk, genre, preserve_spelling) {
    const body = {
      task: "nakdan",
      genre: genre,
      data: chunk,
      addmorph: true,
      matchpartial: true,
      keepmetagim: true,
      keepqq: preserve_spelling,
      nodageshdefmem: false,
      patachma: false,
      useTokenization: true,
      useMarkup: false,
      addHolamHaser: true,
      addHolamHaserBegadkefet: true,
    };
    _log(`POST genre=${genre} chars=${chunk.length} preserve=${preserve_spelling}`);

    let response;
    try {
      this._abort = new AbortController();
      const t = setTimeout(() => this._abort.abort(), this.timeout);
      response = await fetch(this.url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        signal: this._abort.signal,
      });
      clearTimeout(t);
    } catch (e) {
      if (e && e.name === "AbortError") {
        if (this._cancelled) throw new DictaCancelledError("הופסק");
        throw new DictaTimeoutError("דיקטה: השרת לא הגיב בזמן");
      }
      if (this._cancelled) throw new DictaCancelledError("הופסק");
      throw new DictaNetworkError(`שגיאה: ${e}`);
    }

    if (response.status !== 200) {
      const body200 = (await safeText(response)).slice(0, 200);
      _log(`HTTP ${response.status}: ${body200}`, "ERROR");
      throw new DictaServerError(
        `http_${response.status}`,
        `דיקטה החזירה קוד ${response.status}`
      );
    }
    let data;
    try { data = await response.json(); }
    catch (e) {
      _log(`non-JSON: (parse error)`, "ERROR");
      throw new DictaServerError("server_error", "תשובה לא תקינה מדיקטה");
    }
    return NikudDictaClient._parseResponse(data);
  }

  static _parseResponse(data) {
    const items = data.data || [];
    if (!Array.isArray(items)) {
      throw new DictaServerError("bad_format", "פורמט תשובה לא צפוי מדיקטה");
    }
    const out = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const isSep = !!item.sep;
      if (isSep) {
        out.push(item.str || item.pStr || "");
        continue;
      }
      const nakdan = item.nakdan || {};
      const opts = nakdan.options || item.options || [];
      let chosen = "";
      if (opts && opts.length) {
        const first = opts[0];
        if (first && typeof first === "object") {
          chosen = first.w || first.word || "";
        } else if (typeof first === "string") {
          chosen = first;
        }
      }
      if (!chosen) {
        chosen = nakdan.word || item.word || item.str || item.pStr || "";
      }
      // Dicta uses "|" to separate prefix from word — strip.
      chosen = String(chosen).replace(/\|/g, "");
      out.push(chosen);
    }
    return out.join("");
  }
}

async function safeText(r) {
  try { return await r.text(); } catch (e) { return ""; }
}
