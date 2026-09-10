// link_mismatch_reporter.js
// מדווח שגיאות לאי־התאמה בין מספר הקישורים בטקסט הראשי לבין מספר ההערות בכל זרם.
//
// קישור = סימון "@NN" שסומן ב‑streamMark בחלונית הראשית.
// הערה = פיסה אחת מתוך תוכן חלונית הזרם המתאים, כשמפצלים אותו לפי הסמל "@NN".
// אם החלונית פותחת בסמל — הפיסה הריקה הראשונה נופלת (תאימות עם word_bridge).

import { getStreamParents, STREAM_LINKS_CHANGED_EVENT } from "./stream_links.js";

// מפתח פנימי ל"החלונית הראשית". תו שאינו יכול להופיע בקוד זרם אמיתי,
// כדי שלא יתנגש בשום קוד שמשה ייתן.
const MAIN_HOST = "\u0000main";

function findStreamMarksInState(state) {
  const found = [];
  if (!state || !state.doc || typeof state.doc.descendants !== "function") return found;
  state.doc.descendants((node) => {
    if (!node || !node.isText || !Array.isArray(node.marks)) return;
    const m = node.marks.find((x) => x && x.type && x.type.name === "streamMark");
    if (!m) return;
    found.push({ streamCode: m.attrs && m.attrs.streamCode });
  });
  return found;
}

function noteCountForStreamPane(pane) {
  if (!pane || !pane.editor) return 0;
  const symbol = pane.symbol || (pane.streamCode ? `@${pane.streamCode}` : "");
  if (!symbol) return 0;
  const text = pane.editor.state.doc.textContent || "";
  if (!text.trim()) return 0;
  const parts = text.split(symbol);
  if (parts.length > 0 && parts[0].trim() === "") parts.shift();
  return parts.length;
}

// משה 09/09/2026: כאן ישב הבאג של „הערות להערות”.
// הגירסה הקודמת דילגה על כל חלונית שיש לה קוד זרם, כלומר חיפשה סימנים
// אך ורק בראשי. אבל זרם שהוגדר כהערות-להערות מניח את הסימנים שלו בתוך
// חלונית האב — ולכן קיבל תמיד 0, וההודעה „אבל רק 0 קישורים בראשי”
// הופיעה גם כשהכול תקין. עכשיו סופרים בכל חלונית, ואחר כך שואלים לכל
// זרם בנפרד אילו חלוניות רלוונטיות לו.
function markerCountsByHost(paneManager) {
  const byHost = {};
  for (const pane of paneManager.panes) {
    if (!pane.editor) continue;
    const key = pane.streamCode ? String(pane.streamCode) : MAIN_HOST;
    const bucket = byHost[key] || (byHost[key] = {});
    for (const m of findStreamMarksInState(pane.editor.state)) {
      const code = m.streamCode;
      if (!code) continue;
      bucket[code] = (bucket[code] || 0) + 1;
    }
  }
  return byHost;
}

function safeParents(code) {
  try {
    return getStreamParents(code) || [];
  } catch (_) {
    return [];
  }
}

// איפה מותר לסימנים של זרם אחד לשבת.
// הראשי תמיד ברשימה — סימן בגוף הראשי לעולם אינו חסום (וכך גם מתנהג
// מנוע הפריסה). אב שנמחקה חלוניתו יורד מהרשימה, אחרת היינו סופרים
// סימנים שאיש כבר לא יכול לראות.
function hostsForStream(code, livePaneCodes, override) {
  const hosts = [MAIN_HOST];
  const raw = Array.isArray(override) ? override : safeParents(code);
  for (const entry of raw) {
    const parent = String(entry == null ? "" : entry).trim();
    if (!parent || parent === String(code)) continue;
    if (!livePaneCodes.has(parent)) continue;
    if (hosts.indexOf(parent) === -1) hosts.push(parent);
  }
  return hosts;
}

export function computeLinkMismatches(paneManager) {
  if (!paneManager || !Array.isArray(paneManager.panes)) return [];
  const byHost = markerCountsByHost(paneManager);

  const livePaneCodes = new Set();
  const labelByCode = {};
  for (const pane of paneManager.panes) {
    if (!pane.streamCode) continue;
    const code = String(pane.streamCode);
    livePaneCodes.add(code);
    labelByCode[code] = pane.label || `זרם ${code}`;
  }

  const issues = [];
  const seenCodes = new Set();

  for (const pane of paneManager.panes) {
    if (!pane.streamCode) continue;
    const code = String(pane.streamCode);
    seenCodes.add(code);
    const hosts = hostsForStream(code, livePaneCodes, pane.parentCodes);
    let markerCount = 0;
    for (const host of hosts) {
      markerCount += (byHost[host] && byHost[host][code]) || 0;
    }
    const noteCount = noteCountForStreamPane(pane);
    if (markerCount === noteCount) continue;
    issues.push({
      streamCode: code,
      label: pane.label || `זרם ${code}`,
      symbol: pane.symbol || `@${code}`,
      markerCount,
      noteCount,
      orphanedMarkers: false,
      // שמות קריאים של המקומות שבהם הסימנים נספרו — כדי שההודעה תוכל
      // לומר איפה לחפש, ולא רק „בראשי”.
      hostNames: hosts.map((h) => (h === MAIN_HOST ? "הראשי" : (labelByCode[h] || `זרם ${h}`))),
      hostIsMain: hosts.length === 1,
    });
  }

  // סימנים שמצביעים על זרם שאין לו חלונית כלל — בכל מקום שבו הם נמצאו.
  const orphanTotals = {};
  for (const host of Object.keys(byHost)) {
    for (const code of Object.keys(byHost[host])) {
      if (seenCodes.has(code)) continue;
      orphanTotals[code] = (orphanTotals[code] || 0) + byHost[host][code];
    }
  }
  for (const code of Object.keys(orphanTotals)) {
    issues.push({
      streamCode: code,
      label: `זרם ${code}`,
      symbol: `@${code}`,
      markerCount: orphanTotals[code],
      noteCount: 0,
      orphanedMarkers: true,
      hostNames: ["הראשי"],
      hostIsMain: true,
    });
  }

  issues.sort((a, b) => a.streamCode.localeCompare(b.streamCode));
  return issues;
}

// „איפה” — בראשי בלבד, או בראשי ובתוך הזרמים שהוא מקושר אליהם.
function whereText(issue) {
  const names = Array.isArray(issue.hostNames) ? issue.hostNames : [];
  if (names.length <= 1) return "בראשי";
  return "בראשי או בתוך " + names.slice(1).map((n) => `«${n}»`).join(", ");
}

// שורה מלאה לחלון הפירוט: אומרת גם מה זה אומר וגם מה לעשות.
function describeIssueLong(issue) {
  const line = describeIssue(issue);
  if (issue.orphanedMarkers || issue.hostIsMain !== false) return line;
  const names = (issue.hostNames || []).slice(1).map((n) => `«${n}»`).join(", ");
  return line + ` הזרם הזה מוגדר כהערות להערות, ולכן הסימן ${issue.symbol} `
    + `יכול לשבת בטקסט הראשי או בתוך ${names}.`;
}

function describeIssue(issue) {
  if (issue.orphanedMarkers) {
    return `${issue.label}: ${issue.markerCount} קישורים בראשי, אבל אין חלונית להערות.`;
  }
  const where = whereText(issue);
  if (issue.markerCount > issue.noteCount) {
    const diff = issue.markerCount - issue.noteCount;
    return `${issue.label}: יש ${issue.markerCount} קישורים ${where}, אבל רק ${issue.noteCount} הערות. חסרות ${diff}.`;
  }
  const diff = issue.noteCount - issue.markerCount;
  return `${issue.label}: יש ${issue.noteCount} הערות, אבל רק ${issue.markerCount} קישורים ${where}. ${diff} הערות לא ייוצאו.`;
}

function ensureBar() {
  let bar = document.getElementById("link-mismatch-bar");
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "link-mismatch-bar";
  bar.className = "link-mismatch-bar";
  bar.dir = "rtl";
  bar.hidden = true;
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.style.cssText = [
    "padding:6px 12px",
    "margin:4px 0",
    "background:#fde68a",
    "color:#7c2d12",
    "border:1px solid #d97706",
    "border-radius:6px",
    "font-weight:600",
    "cursor:pointer",
    "display:none",
    "align-items:center",
    "gap:8px",
    "font-size:13px",
  ].join(";");
  const status = document.getElementById("status");
  if (status && status.parentElement) {
    status.parentElement.insertBefore(bar, status.nextSibling);
  } else {
    document.body.insertBefore(bar, document.body.firstChild);
  }
  return bar;
}

function ensureDialog() {
  let dlg = document.getElementById("link-mismatch-dialog");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = "link-mismatch-dialog";
  dlg.dir = "rtl";
  dlg.style.cssText = "max-width:520px;padding:16px 20px;border-radius:10px;border:1px solid #d97706;font-family:inherit;";
  dlg.innerHTML = `
    <h3 style="margin:0 0 8px 0;color:#7c2d12">אי־התאמה בין קישורים להערות</h3>
    <p style="margin:0 0 8px 0;font-size:13px;color:#3f3f46">
      בכל זרם, מספר ההערות בחלונית צריך להיות זהה למספר הקישורים בראשי.
      רשימת הזרמים שאינם תואמים:
    </p>
    <ul id="link-mismatch-dialog-list" style="margin:0 0 12px 0;padding-inline-start:20px;font-size:13px;line-height:1.6"></ul>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button type="button" id="link-mismatch-dialog-close">סגור</button>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.querySelector("#link-mismatch-dialog-close")?.addEventListener("click", () => dlg.close());
  return dlg;
}

function renderBar(issues) {
  const bar = ensureBar();
  if (!issues.length) {
    bar.style.display = "none";
    bar.hidden = true;
    bar.textContent = "";
    return;
  }
  bar.style.display = "flex";
  bar.hidden = false;
  const summary = issues.length === 1
    ? describeIssue(issues[0])
    : `נמצאו אי־התאמות ב‑${issues.length} זרמים. לחץ לפירוט.`;
  bar.textContent = `⚠ ${summary}`;
}

function showDialog(issues) {
  if (!issues.length) return;
  const dlg = ensureDialog();
  const list = dlg.querySelector("#link-mismatch-dialog-list");
  if (list) {
    list.innerHTML = "";
    for (const issue of issues) {
      const li = document.createElement("li");
      li.textContent = describeIssueLong(issue);
      list.appendChild(li);
    }
  }
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

export function installLinkMismatchReporter(paneManager) {
  if (!paneManager || typeof paneManager.on !== "function") return null;
  if (typeof window !== "undefined" && window.__linkMismatchReporterInstalled) {
    return window.__linkMismatchReporterApi || null;
  }

  const bar = ensureBar();
  let lastIssues = [];

  bar.addEventListener("click", () => showDialog(lastIssues));

  let timer = null;
  const refresh = () => {
    timer = null;
    try {
      lastIssues = computeLinkMismatches(paneManager);
      renderBar(lastIssues);
    } catch (e) {
      console.warn("[link-mismatch] refresh failed:", e);
    }
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(refresh, 300);
  };

  paneManager.on("change", schedule);
  paneManager.on("focus", schedule);

  // שינוי של „לאיזה זרם החלונית מקושרת” משנה איפה מותר לסימנים לשבת,
  // ולכן חייב לחשב את האזהרה מחדש — אחרת היא נשארת על המסך אחרי שמשה
  // כבר תיקן את ההגדרה.
  try {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener(STREAM_LINKS_CHANGED_EVENT, schedule);
    }
  } catch (_) {}

  refresh();

  const api = {
    refresh,
    getIssues: () => lastIssues.slice(),
    showDialog: () => showDialog(lastIssues),
  };
  if (typeof window !== "undefined") {
    window.__linkMismatchReporterInstalled = true;
    window.__linkMismatchReporterApi = api;
  }
  return api;
}
