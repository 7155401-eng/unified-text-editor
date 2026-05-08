// vilna_v8_apply.js — מחיל את V8 על עמודים שכבר פוצלו ע"י domPack.
//
// הלוגיקה: מקבל .page שכבר מכיל .page-main + .page-streams עם הזרמים.
// קורא את הטקסט והזרמים, מחליט host/guest/footer לפי הגדרות הזרם
// (window.__STREAM_SETTINGS__[code].mishnaSide), ובונה מחדש את ה-DOM
// של ה-.page בארכיטקטורה של V8.
//
// admin-only ב-runtime: isVilnaV8Enabled מחזיר false אם המשתמש לא מנהל,
// גם אם ה-localStorage flag דלוק. כך אם משתמש רגיל קיבל את ה-flag בטעות,
// הוא לא יקבל V8.

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
    if (side === "right" && !rightStream) {
      rightStream = s;
    } else if (side === "left" && !leftStream) {
      leftStream = s;
    } else {
      footerStreams.push(s);
    }
  }

  // Fallback: אם אף זרם לא הוגדר עם side, נשבץ את 2 הראשונים כ-host/guest
  if (!rightStream && !leftStream && streamData.length >= 1) {
    rightStream = streamData[0];
    if (streamData.length >= 2) leftStream = streamData[1];
    footerStreams.length = 0;
    for (let i = 2; i < streamData.length; i++) footerStreams.push(streamData[i]);
  } else if (!rightStream) {
    const candidate = footerStreams.shift();
    if (candidate) rightStream = candidate;
  } else if (!leftStream) {
    const candidate = footerStreams.shift();
    if (candidate) leftStream = candidate;
  }

  return { rightStream, leftStream, footerStreams };
}

export async function applyVilnaV8ToPage(pageEl) {
  if (!pageEl) return;
  const mainEl = pageEl.querySelector(".page-main");
  const streamsWrap = pageEl.querySelector(".page-streams");
  if (!mainEl && !streamsWrap) return;

  // נשמור את ה-HTML המקורי פעם אחת כדי לאפשר restore אם הוחלט לכבות
  if (!pageEl.dataset.vilnaV8OriginalHtml) {
    pageEl.dataset.vilnaV8OriginalHtml = pageEl.innerHTML;
  }

  const mainText = mainEl ? mainEl.textContent.trim() : "";
  const streamEls = streamsWrap
    ? Array.from(streamsWrap.querySelectorAll(":scope > .stream"))
    : [];
  const streamData = streamEls
    .map(streamElToData)
    .filter(s => s.items.length > 0);

  const { rightStream, leftStream, footerStreams } = pickHostGuestFooter(streamData);

  const titles = Object.assign({}, DEFAULT_TITLES,
    (typeof window !== "undefined" && window.__STREAM_TITLES__) || {});

  const rect = pageEl.getBoundingClientRect();
  const pageWidth = Math.round(rect.width) || 559;
  const pageHeight = Math.round(rect.height) || 794;

  pageEl.innerHTML = "";
  pageEl.classList.add("vilna-v8-page");

  await buildPage(pageEl, {
    mainText,
    rightStream,
    leftStream,
    footerStreams,
    titles,
  }, {
    pageWidth,
    pageHeight,
    padding: 12,
    useExisting: true,
  });
}

export async function applyVilnaV8ToPages(container) {
  if (!container) return;
  if (!isVilnaV8Enabled()) {
    // אם נכבה, נחזיר לעמודים ערוכים את ה-HTML המקורי
    const dirty = Array.from(container.querySelectorAll(".page.vilna-v8-page"));
    for (const page of dirty) {
      const orig = page.dataset.vilnaV8OriginalHtml;
      if (orig) {
        page.innerHTML = orig;
        delete page.dataset.vilnaV8OriginalHtml;
        page.classList.remove("vilna-v8-page");
      }
    }
    return;
  }
  const pages = Array.from(container.querySelectorAll(".page:not(.page-placeholder)"));
  for (const page of pages) {
    await applyVilnaV8ToPage(page);
  }
}
