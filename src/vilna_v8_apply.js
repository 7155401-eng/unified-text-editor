// vilna_v8_apply.js — מחיל את V8 על עמודים שכבר פוצלו ע"י domPack.
//
// admin-only ב-runtime. כש-V8 דלוק, engine_bridge מריץ את domPack ו-renderPages
// כרגיל, ואז קורא לפונקציה הזו להחיל את הצורה הוויזואלית של V8 על כל עמוד.
//
// הזרימה:
//   1. domPack חתך את הראשי וההערות לעמודים (לפי גיאומטריית V1)
//   2. renderPages יצר את המבנה .page > .page-main + .page-streams > .stream
//   3. applyVilnaV8ToPages עובר על כל .page, קורא את המבנה,
//      ומשבץ אותו בארכיטקטורת host/guest float של V8
//   4. lazy-realize hook: עמודים שיתממשו בעתיד (סקרול) יקבלו V8 גם הם

import { buildPage } from "./vilna_v8.js";

const STORAGE_KEY = "ravtext.vilnaV8Beta";

const DEFAULT_TITLES = {
  "01": "מגן אברהם",
  "02": "משנה ברורה",
  "03": "ביאור הלכה",
  "04": "טורי זהב",
  "05": "כף החיים",
};

export function isVilnaV8Enabled() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__ || {};
  if (!auth.admin) return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setVilnaV8Enabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

function settingsForStreamCode(code) {
  return (typeof window !== "undefined" &&
          window.__STREAM_SETTINGS__ &&
          window.__STREAM_SETTINGS__[code]) || {};
}

function streamElToData(streamEl) {
  const id = streamEl.getAttribute("data-stream") || "";
  const noteEls = Array.from(streamEl.querySelectorAll(".note"));
  const items = noteEls.length
    ? noteEls.map(n => n.textContent.trim()).filter(Boolean)
    : [streamEl.textContent.trim()].filter(Boolean);
  return { id, items };
}

function pickHostGuestFooter(streamData) {
  let rightStream = null;
  let leftStream = null;
  const footerStreams = [];

  for (const s of streamData) {
    const side = settingsForStreamCode(s.id).mishnaSide;
    if (side === "right" && !rightStream) rightStream = s;
    else if (side === "left" && !leftStream) leftStream = s;
    else footerStreams.push(s);
  }

  if (!rightStream && !leftStream && streamData.length >= 1) {
    rightStream = streamData[0];
    if (streamData.length >= 2) leftStream = streamData[1];
    footerStreams.length = 0;
    for (let i = 2; i < streamData.length; i++) footerStreams.push(streamData[i]);
  } else if (!rightStream && footerStreams.length > 0) {
    rightStream = footerStreams.shift();
  } else if (!leftStream && footerStreams.length > 0) {
    leftStream = footerStreams.shift();
  }

  return { rightStream, leftStream, footerStreams };
}

function extractMainTextPreservingParas(mainEl) {
  if (!mainEl) return "";
  // משה 2026-05-08: לשמור על הפרדה בין פסקאות (textContent רגיל מוחק רווחים).
  // נחבר עם רווח כפול בין כל בלוק.
  const blocks = Array.from(mainEl.querySelectorAll("p, h1, h2, h3, h4, h5, h6"));
  if (blocks.length === 0) return mainEl.textContent.trim();
  return blocks.map(b => b.textContent.trim()).filter(Boolean).join("  ");
}

export async function applyVilnaV8ToPage(pageEl) {
  if (!pageEl) return;
  if (pageEl.dataset.vilnaV8Rendered === "1") return; // כבר טופל ברינדור הזה

  const mainEl = pageEl.querySelector(".page-main");
  const streamsWrap = pageEl.querySelector(".page-streams");
  if (!mainEl && !streamsWrap) return;

  // Backup HTML לשחזור אם V8 ייכבה
  if (!pageEl.dataset.vilnaV8OriginalHtml) {
    pageEl.dataset.vilnaV8OriginalHtml = pageEl.innerHTML;
  }

  const mainText = extractMainTextPreservingParas(mainEl);
  const streamEls = streamsWrap
    ? Array.from(streamsWrap.querySelectorAll(":scope > .stream"))
    : [];
  const streamData = streamEls
    .map(streamElToData)
    .filter(s => s.items.length > 0);

  const { rightStream, leftStream, footerStreams } = pickHostGuestFooter(streamData);

  const labels = (typeof window !== "undefined" && window.__STREAM_LABELS__) || {};
  const titles = Object.assign({}, DEFAULT_TITLES, labels);

  // מידות מ-rect של ה-.page (כבר נקבעו ע"י page_settings/CSS)
  const rect = pageEl.getBoundingClientRect();
  const pageWidth = Math.round(rect.width) || 380;
  const pageHeight = Math.round(rect.height) || 537;
  const padding = 12;
  const maxMainHeight = pageHeight - 2 * padding;

  pageEl.innerHTML = "";
  pageEl.classList.add("vilna-v8-page");
  pageEl.style.position = "relative";
  pageEl.style.overflow = "hidden";

  await buildPage(pageEl, {
    mainText,
    rightStream,
    leftStream,
    footerStreams,
    titles,
  }, {
    pageWidth,
    pageHeight,
    padding,
    useExisting: true,
    maxMainHeight,
  });

  pageEl.dataset.vilnaV8Rendered = "1";
}

export async function applyVilnaV8ToPages(container) {
  if (!container) return;

  // אם V8 כבוי — שחזר ל-HTML המקורי בעמודים שטופלו, ונקה hooks.
  if (!isVilnaV8Enabled()) {
    const dirty = Array.from(container.querySelectorAll(".page.vilna-v8-page"));
    for (const page of dirty) {
      const orig = page.dataset.vilnaV8OriginalHtml;
      if (orig) {
        page.innerHTML = orig;
        delete page.dataset.vilnaV8OriginalHtml;
        delete page.dataset.vilnaV8Rendered;
        page.classList.remove("vilna-v8-page");
        page.style.overflow = "";
      }
    }
    // בטל את ה-hooks (מסומנים __vilnaV8) — נחזיר את הקודמים אם היו
    if (container.__processRealizedPage && container.__processRealizedPage.__vilnaV8) {
      container.__processRealizedPage = container.__processRealizedPage.__prev || null;
    }
    if (container.__realizePage && container.__realizePage.__vilnaV8) {
      container.__realizePage = container.__realizePage.__prev;
    }
    return;
  }

  // טפל בעמודים שכבר ממומשים
  const pages = Array.from(container.querySelectorAll(".page:not(.page-placeholder)"));
  for (const page of pages) {
    await applyVilnaV8ToPage(page);
  }

  // Hook לעמודים שיתממשו בעתיד דרך realizePage (סקרול lazy)
  const prevProcessor = container.__processRealizedPage;
  if (!prevProcessor || !prevProcessor.__vilnaV8) {
    const processor = function (page, idx) {
      if (typeof prevProcessor === "function") prevProcessor(page, idx);
      if (isVilnaV8Enabled()) applyVilnaV8ToPage(page);
    };
    processor.__vilnaV8 = true;
    processor.__prev = prevProcessor;
    container.__processRealizedPage = processor;
  }

  const baseRealize = container.__realizePage;
  if (typeof baseRealize === "function" && !baseRealize.__vilnaV8) {
    const wrapped = function (idx) {
      baseRealize(idx);
      const page = typeof container.__getPageElement === "function"
        ? container.__getPageElement(idx)
        : container.querySelector(`.page[data-page-index="${idx}"]`);
      if (page && isVilnaV8Enabled()) applyVilnaV8ToPage(page);
    };
    wrapped.__vilnaV8 = true;
    wrapped.__prev = baseRealize;
    container.__realizePage = wrapped;
  }
}
