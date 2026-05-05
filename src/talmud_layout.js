/**
 * talmud_layout.js — תבנית תצוגת תלמוד
 *
 * מבנה: טקסט ראשי (גמרא) בחלק עליון מרכזי,
 *        ומתחתיו הזרמים מסודרים ב"פרסה": שניים בשורה (ימין/שמאל)
 *        בדומה לדף הגמרא המסורתי.
 *
 * ניתן לקבוע אילו זרמים ימוקמו ב-right ואילו ב-left
 * דרך ממשק ה-UI (input עם כינויים).
 * אם לא הוגדר — חלוקה אוטומטית: מספרי זרמים אי-זוגיים ימינה, זוגיים שמאלה.
 *
 * API:
 *   applyTalmudLayoutToPage(pageEl)
 *   applyTalmudLayoutToPages(container)
 *   wireTalmudLayoutToggle(onChange)
 *   isTalmudLayoutEnabled() → bool
 *   setTalmudLayoutEnabled(bool)
 *   getTalmudSideText() → string   ("01,03 | 02,04")
 *   setTalmudSideText(string)
 */

const STORAGE_KEY = "ravtext.talmudLayout";
const SIDES_KEY   = "ravtext.talmudLayout.sides";

// ─── State getters/setters ─────────────────────────────────────────────────

export function isTalmudLayoutEnabled() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setTalmudLayoutEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

export function getTalmudSideText() {
  return localStorage.getItem(SIDES_KEY) || "";
}

export function setTalmudSideText(value) {
  localStorage.setItem(SIDES_KEY, value || "");
}

// ─── Parsing ───────────────────────────────────────────────────────────────

/**
 * parseTalmudSides()
 * מנתח מחרוזת "01,03 | 02,04" (חלק ראשון=ימין, שני=שמאל)
 * ומחזיר { right: Set<code>, left: Set<code> }
 */
function normalizeCode(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return String(n).padStart(2, "0");
}

function parseTalmudSides() {
  const raw = getTalmudSideText().trim();
  if (!raw) return { right: new Set(), left: new Set() };

  const parts = raw.split(/\|/);
  const extract = (str) =>
    (str.match(/\d{1,3}/g) || []).map(normalizeCode).filter(Boolean);

  const rightCodes = extract(parts[0] || "");
  const leftCodes  = extract(parts[1] || "");

  return {
    right: new Set(rightCodes),
    left:  new Set(leftCodes),
  };
}

// ─── DOM helpers ──────────────────────────────────────────────────────────

function resetTalmudPage(pageEl) {
  pageEl.classList.remove("talmud-layout-page");
  const streamsWrap = pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  // מחזיר את כל הזרמים ישירות ל-streamsWrap (מוציא מ-rows)
  const rows = Array.from(streamsWrap.querySelectorAll(":scope > .talmud-row"));
  for (const row of rows) {
    const streams = Array.from(row.querySelectorAll(":scope > .stream"));
    for (const s of streams) streamsWrap.insertBefore(s, row);
    row.remove();
  }

  // מאפס סטייל על כל זרם
  for (const s of streamsWrap.querySelectorAll(":scope > .stream")) {
    s.removeAttribute("data-talmud-side");
    s.style.flex = "";
    s.style.width = "";
    s.style.minWidth = "";
    s.style.maxWidth = "";
  }
}

// ─── Core layout ─────────────────────────────────────────────────────────

export function applyTalmudLayoutToPage(pageEl) {
  // תמיד מאפסים קודם — כדי לאפשר חזרה ל-default ולמשנה-ברורה בלי שיורים
  resetTalmudPage(pageEl);

  if (!isTalmudLayoutEnabled()) return;

  const streamsWrap = pageEl && pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  const streams = Array.from(streamsWrap.querySelectorAll(":scope > .stream"));
  if (streams.length === 0) return;

  // קביעת צדדים
  const { right, left } = parseTalmudSides();

  function sideFor(code) {
    if (right.size > 0 || left.size > 0) {
      if (right.has(code)) return "right";
      if (left.has(code))  return "left";
      return "right"; // ברירת מחדל — ימין
    }
    // אוטומטי: אי-זוגי=ימין, זוגי=שמאל
    const n = parseInt(code, 10);
    return n % 2 === 1 ? "right" : "left";
  }

  const rightStreams = [];
  const leftStreams  = [];

  for (const s of streams) {
    const code = s.getAttribute("data-stream") || "";
    const side = sideFor(code);
    s.setAttribute("data-talmud-side", side);
    if (side === "right") rightStreams.push(s);
    else leftStreams.push(s);
  }

  // בונה שורות: זוגות ימין+שמאל
  const rowCount = Math.max(rightStreams.length, leftStreams.length);

  pageEl.classList.add("talmud-layout-page");

  for (let i = 0; i < rowCount; i++) {
    const row = document.createElement("div");
    row.className = "talmud-row";

    // RTL: ימין מגיע ראשון ב-DOM ← מוצג בצד ימין
    if (rightStreams[i]) {
      rightStreams[i].style.flex = "1";
      row.appendChild(rightStreams[i]);
    } else {
      const ph = document.createElement("div");
      ph.className = "talmud-col-placeholder";
      row.appendChild(ph);
    }

    if (leftStreams[i]) {
      leftStreams[i].style.flex = "1";
      row.appendChild(leftStreams[i]);
    }

    streamsWrap.appendChild(row);
  }
}

export function applyTalmudLayoutToPages(container) {
  container.querySelectorAll(".page").forEach((page) => applyTalmudLayoutToPage(page));

  // עוטף את __realizePage כדי לחשב layout גם לעמודים שנוצרים בגלילה
  const baseRealize = container.__realizePage;
  if (typeof baseRealize === "function" && !baseRealize.__talmudWrapped) {
    const wrapped = function (idx) {
      baseRealize(idx);
      const page = container.querySelector(`.page[data-page-index="${idx}"]`);
      if (page) applyTalmudLayoutToPage(page);
    };
    wrapped.__talmudWrapped = true;
    container.__realizePage = wrapped;
  }
}

// ─── UI wiring ────────────────────────────────────────────────────────────

export function wireTalmudLayoutToggle(onChange) {
  const toggle     = document.getElementById("talmud-layout-toggle");
  const sidesInput = document.getElementById("talmud-sides-input");
  if (!toggle) return;

  toggle.checked = isTalmudLayoutEnabled();
  if (sidesInput) sidesInput.value = getTalmudSideText();

  toggle.addEventListener("change", () => {
    setTalmudLayoutEnabled(toggle.checked);
    onChange && onChange();
  });

  sidesInput?.addEventListener("change", () => {
    setTalmudSideText(sidesInput.value);
    onChange && onChange();
  });

  sidesInput?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    sidesInput.blur();
  });
}
