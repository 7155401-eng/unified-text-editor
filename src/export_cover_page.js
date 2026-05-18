// export_cover_page.js — builds an official technical cover page for exports.
// The page is intentionally plain, self-contained, and inline-styled so it can
// be rendered by the PDF foreignObject path, native print, and standalone HTML
// debug snapshots without relying on app chrome CSS.

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function hebrewTimestamp(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

function readStorage(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (_) {
    return "";
  }
}

function shortValue(value, fallback = "—", max = 140) {
  const s = String(value ?? "").trim();
  if (!s) return fallback;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function metadataRows({ mode, contentPageCount, filename, generatedAt }) {
  const talmudOn = readStorage("ravtext.talmudLayout") === "1";
  const rows = [
    ["מערכת", "רב טקסט — Unified Text Editor"],
    ["סוג יצוא", mode || "PDF"],
    ["שעת יצוא", hebrewTimestamp(generatedAt)],
    ["מספר עמודי תוכן", String(contentPageCount ?? 0)],
    ["שם קובץ", filename || "ravtext-preview.pdf"],
    ["כתובת מקור", shortValue(typeof window !== "undefined" ? window.location?.href : "")],
    ["דפדפן", shortValue(typeof navigator !== "undefined" ? navigator.userAgent : "", "—", 180)],
    ["מצב גפ״ת", talmudOn ? "פעיל" : "כבוי"],
    ["זרמי גפ״ת", shortValue(readStorage("ravtext.talmudLayout.streams"))],
    ["רוחב ראשי", shortValue(readStorage("ravtext.talmudLayout.mainWidth"))],
    ["רווח צד", shortValue(readStorage("ravtext.talmudLayout.sideGap"))],
  ];
  return rows;
}

const PRINT_MARGIN_SAFE_STYLE = `
<style>
@media print {
  /*
    Chrome may ignore zero @page margin or print with default device margins.
    A full A4 zoom (2.0887) can then become slightly taller than the printable
    area, and break-inside:avoid may open a blank sheet before the first page.
    This late body-level style is embedded only in HTML debug exports. It must
    not be included in PDF cover rendering, because the PDF path turns every
    page into an SVG image and embedded body <style> can break image decoding.
  */
  body.ravtext-debug-snapshot #pages-container,
  body.ravtext-debug-snapshot #pages-container.pages-container {
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  body.ravtext-debug-snapshot #pages-container > .page,
  body.ravtext-debug-snapshot #pages-container > .page:not(.measure-page) {
    zoom: 1.86 !important;
    margin: 0 auto !important;
    break-before: auto !important;
    page-break-before: auto !important;
    break-inside: auto !important;
    page-break-inside: auto !important;
    break-after: page !important;
    page-break-after: always !important;
  }

  body.ravtext-debug-snapshot #pages-container > .page:first-of-type,
  body.ravtext-debug-snapshot #pages-container > .ravtext-export-cover-page {
    margin-top: 0 !important;
    break-before: auto !important;
    page-break-before: auto !important;
  }

  body.ravtext-debug-snapshot #pages-container > .page:last-of-type {
    break-after: auto !important;
    page-break-after: auto !important;
  }
}
</style>`;

export function buildExportCoverPage(options = {}) {
  const {
    mode = "PDF",
    contentPageCount = 0,
    filename = "ravtext-preview.pdf",
    generatedAt = new Date(),
    includePrintPatch = false,
    note = "דף זה נוצר אוטומטית בתחילת הייצוא כדי למנוע פתיחה בעמוד ריק ולתעד את פרטי הייצוא.",
  } = options;

  const page = document.createElement("div");
  page.className = "page ravtext-export-cover-page";
  page.setAttribute("dir", "rtl");
  page.dataset.exportCover = "1";
  page.style.cssText = [
    "width:380px",
    "height:537px",
    "box-sizing:border-box",
    "padding:34px 32px 30px 32px",
    "background:#fff",
    "color:#111827",
    "font-family:'David Libre','Frank Ruhl Libre','Times New Roman',serif",
    "display:flex",
    "flex-direction:column",
    "justify-content:space-between",
    "overflow:hidden",
    "box-shadow:none",
    "border:0",
    "direction:rtl",
    "text-align:right",
  ].join(";");

  const rows = metadataRows({ mode, contentPageCount, filename, generatedAt })
    .map(([label, value]) => `
      <div style="display:grid;grid-template-columns:94px 1fr;gap:8px;border-bottom:1px solid #e5e7eb;padding:5px 0;align-items:start;">
        <div style="font-size:10.5px;color:#6b7280;font-weight:700;">${escapeHTML(label)}</div>
        <div style="font-size:10.5px;color:#111827;line-height:1.38;direction:rtl;unicode-bidi:plaintext;overflow-wrap:anywhere;">${escapeHTML(value)}</div>
      </div>`)
    .join("");

  page.innerHTML = `
    ${includePrintPatch ? PRINT_MARGIN_SAFE_STYLE : ""}
    <div>
      <div style="border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:18px;">
        <div style="font-size:22px;font-weight:800;letter-spacing:.02em;line-height:1.2;">רב טקסט</div>
        <div style="font-size:14px;font-weight:700;color:#374151;margin-top:3px;">דף מידע טכני לייצוא</div>
      </div>
      <div style="font-size:11.5px;line-height:1.55;color:#374151;margin-bottom:14px;">
        ${escapeHTML(note)}
      </div>
      <div style="border:1px solid #d1d5db;border-radius:6px;padding:8px 10px;background:#fafafa;">
        ${rows}
      </div>
    </div>
    <div style="font-size:9.5px;color:#6b7280;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:12px;">
      נוצר אוטומטית על ידי RavText. דף זה אינו חלק מתוכן המסמך המקורי.
    </div>`;

  return page;
}
