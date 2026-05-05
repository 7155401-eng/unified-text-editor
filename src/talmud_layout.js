/**
 * talmud_layout.js — תבנית תצוגת תלמוד (כתר + מרכזי + שני פרשנים)
 *
 * מבנה (כברירת מחדל):
 *   • הזרם המרכזי T תופס 42% במרכז
 *   • שני זרמי פרשנות A (ימין) ו-B (שמאל) תופסים 29% כל אחד
 *   • הכתר: 4 שורות עליונות שבהן A=50% ו-B=50% (ללא T)
 *   • זרמים שאינם בקונפיג נשארים מתחת לבלוק התלמוד בסדר המקורי
 *   • כשהתבנית כבויה — הכל חוזר לסדר המקורי בלי שיורים
 *
 * פורמט הקלט (שדה "זרמים"):
 *   "01 | 02 | 03"   ← T | פרשן ימין | פרשן שמאל
 *   "01 | 02, 03"    ← T | שני פרשנים (הראשון ימין, השני שמאל)
 *   "01 | 02"        ← T | פרשן בודד
 *
 * כללי שמירה (אסור להפר):
 *   • לעולם לא innerHTML='' על page-streams
 *   • הזזת DOM רק עם appendChild / insertBefore
 *   • במצב כבוי או בלי קונפיג: רק unwrap של talmud-block + ניקוי data-attrs
 *     שלנו, *לא* נוגעים בסדר הזרמים, *לא* נוגעים ב-mishna-level וכו'
 *   • לא נוגעים בשום DOM מחוץ ל-.page-streams של העמוד
 */

const STORAGE_KEY      = "ravtext.talmudLayout";
const SIDES_KEY        = "ravtext.talmudLayout.sides";
const CROWN_LINES_KEY  = "ravtext.talmudLayout.crownLines";
const MAIN_WIDTH_KEY   = "ravtext.talmudLayout.mainWidth";

const DEFAULT_CROWN_LINES = 4;
const DEFAULT_MAIN_WIDTH  = 42;

// ─── State getters / setters ──────────────────────────────────────────────

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

export function getTalmudCrownLines() {
  const raw = localStorage.getItem(CROWN_LINES_KEY);
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 20) return DEFAULT_CROWN_LINES;
  return n;
}

export function setTalmudCrownLines(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || n > 20) {
    localStorage.removeItem(CROWN_LINES_KEY);
    return;
  }
  localStorage.setItem(CROWN_LINES_KEY, String(n));
}

export function getTalmudMainWidth() {
  const raw = localStorage.getItem(MAIN_WIDTH_KEY);
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 20 || n > 80) return DEFAULT_MAIN_WIDTH;
  return n;
}

export function setTalmudMainWidth(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 20 || n > 80) {
    localStorage.removeItem(MAIN_WIDTH_KEY);
    return;
  }
  localStorage.setItem(MAIN_WIDTH_KEY, String(n));
}

// ─── Parsing ──────────────────────────────────────────────────────────────

function normalizeCode(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return String(n).padStart(2, "0");
}

function extractCodes(str) {
  return (str.match(/\d{1,3}/g) || []).map(normalizeCode).filter(Boolean);
}

/** מחזיר { main, right, left } או null אם הקלט לא חוקי */
function parseTalmudConfig() {
  const raw = getTalmudSideText().trim();
  if (!raw) return null;
  const parts = raw.split(/\|/);

  const mainCodes = extractCodes(parts[0] || "");
  const main = mainCodes[0] || null;
  if (!main) return null;

  let right = null;
  let left  = null;

  if (parts.length >= 3) {
    right = extractCodes(parts[1] || "")[0] || null;
    left  = extractCodes(parts[2] || "")[0] || null;
  } else if (parts.length === 2) {
    const rest = extractCodes(parts[1] || "");
    right = rest[0] || null;
    left  = rest[1] || null;
  } else {
    const rest = mainCodes.slice(1);
    right = rest[0] || null;
    left  = rest[1] || null;
  }

  return { main, right, left };
}

// ─── DOM helpers (talmud-only) ────────────────────────────────────────────

function codeForStream(streamEl) {
  return streamEl.getAttribute("data-stream") || "";
}

function clearTalmudMarks(streamEl) {
  streamEl.classList.remove(
    "talmud-main",
    "talmud-perush-right",
    "talmud-perush-left"
  );
  streamEl.removeAttribute("data-talmud-role");
}

/**
 * מוציא את הזרמים מתוך כל .talmud-block ומחזיר אותם ישירות ל-streamsWrap
 * *לפני* הבלוק. מסיר את הבלוק. לא נוגע ב-.mishna-level או בשום דבר אחר.
 */
function unwrapTalmudBlocks(streamsWrap) {
  const blocks = Array.from(
    streamsWrap.querySelectorAll(":scope > .talmud-block")
  );
  for (const block of blocks) {
    const innerStreams = Array.from(
      block.querySelectorAll(":scope > .stream")
    );
    for (const s of innerStreams) {
      streamsWrap.insertBefore(s, block);
    }
    block.remove();
  }
}

/** מנקה את כל סימוני התלמוד מהעמוד — בלי לגעת בסדר הזרמים. */
function cleanTalmudFromPage(pageEl, streamsWrap) {
  unwrapTalmudBlocks(streamsWrap);
  // מנקה data-attrs/classes על *כל* הזרמים של העמוד, לא משנה איפה הם
  // (גם אלו שיושבים בתוך .mishna-level)
  pageEl.querySelectorAll(".stream").forEach(clearTalmudMarks);
  pageEl.classList.remove("talmud-layout-page");
  pageEl.style.removeProperty("--talmud-crown-lines");
  pageEl.style.removeProperty("--talmud-main-width");
}

// ─── Core layout ──────────────────────────────────────────────────────────

export function applyTalmudLayoutToPage(pageEl) {
  const streamsWrap = pageEl && pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  // 1. ניקוי תלמוד בלבד — *אסור* לגעת בסדר זרמים או בעטיפות של תבניות אחרות.
  cleanTalmudFromPage(pageEl, streamsWrap);

  // 2. כבוי? → סיימנו, מחזירים את ה-DOM כפי שהיה לפני קריאתנו.
  if (!isTalmudLayoutEnabled()) return;

  // 3. אין קונפיג חוקי? → סיימנו (לא משנים סדר).
  const config = parseTalmudConfig();
  if (!config) return;

  // 4. מאתרים את T, A, B *רק* בין הזרמים שנמצאים ישירות תחת streamsWrap.
  //    זרם שכבר עטוף בתבנית אחרת (למשל .mishna-level) — לא לוקחים, כדי
  //    לא לשבור את התבנית האחרת.
  const directStreams = Array.from(
    streamsWrap.querySelectorAll(":scope > .stream")
  );
  const byCode = new Map();
  for (const s of directStreams) {
    const code = codeForStream(s);
    if (code && !byCode.has(code)) byCode.set(code, s);
  }

  const mainEl  = config.main  ? (byCode.get(config.main)  || null) : null;
  const rightEl = config.right ? (byCode.get(config.right) || null) : null;
  const leftEl  = config.left  ? (byCode.get(config.left)  || null) : null;

  // 5. אם אף זרם רלוונטי לא פנוי → לא בונים בלוק (ולא משנים שום דבר).
  if (!mainEl && !rightEl && !leftEl) return;

  // 6. בונים את בלוק התלמוד.
  const block = document.createElement("div");
  block.className = "talmud-block";
  block.dataset.talmudBlock = "1";

  if (rightEl) {
    rightEl.classList.add("talmud-perush-right");
    rightEl.dataset.talmudRole = "right";
    block.appendChild(rightEl);
  }
  if (mainEl) {
    mainEl.classList.add("talmud-main");
    mainEl.dataset.talmudRole = "main";
    block.appendChild(mainEl);
  }
  if (leftEl) {
    leftEl.classList.add("talmud-perush-left");
    leftEl.dataset.talmudRole = "left";
    block.appendChild(leftEl);
  }

  // 7. מסמנים את העמוד עם הקונפיג.
  pageEl.classList.add("talmud-layout-page");
  pageEl.style.setProperty("--talmud-crown-lines", String(getTalmudCrownLines()));
  pageEl.style.setProperty("--talmud-main-width",  String(getTalmudMainWidth()) + "%");

  // 8. מכניסים את הבלוק *בראש* streamsWrap (מעל .mishna-level וכו').
  streamsWrap.insertBefore(block, streamsWrap.firstChild);
}

export function applyTalmudLayoutToPages(container) {
  container.querySelectorAll(".page").forEach((page) =>
    applyTalmudLayoutToPage(page)
  );

  const baseRealize = container.__realizePage;
  if (typeof baseRealize !== "function" || baseRealize.__talmudWrapped) return;

  const wrapped = function (idx) {
    baseRealize(idx);
    const page = container.querySelector(`.page[data-page-index="${idx}"]`);
    if (page) applyTalmudLayoutToPage(page);
  };
  wrapped.__talmudWrapped = true;
  container.__realizePage = wrapped;
}

// ─── UI wiring ────────────────────────────────────────────────────────────

export function wireTalmudLayoutToggle(onChange) {
  const toggle      = document.getElementById("talmud-layout-toggle");
  const sidesInput  = document.getElementById("talmud-sides-input");
  const crownInput  = document.getElementById("talmud-crown-input");
  const widthInput  = document.getElementById("talmud-main-width-input");
  if (!toggle) return;

  toggle.checked = isTalmudLayoutEnabled();
  if (sidesInput) sidesInput.value = getTalmudSideText();
  if (crownInput) {
    const v = getTalmudCrownLines();
    crownInput.value = v === DEFAULT_CROWN_LINES ? "" : String(v);
  }
  if (widthInput) {
    const v = getTalmudMainWidth();
    widthInput.value = v === DEFAULT_MAIN_WIDTH ? "" : String(v);
  }

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

  crownInput?.addEventListener("change", () => {
    setTalmudCrownLines(crownInput.value);
    if (isTalmudLayoutEnabled()) onChange && onChange();
  });

  widthInput?.addEventListener("change", () => {
    setTalmudMainWidth(widthInput.value);
    if (isTalmudLayoutEnabled()) onChange && onChange();
  });
}
