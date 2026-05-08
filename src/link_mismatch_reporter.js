// link_mismatch_reporter.js
// מדווח שגיאות לאי־התאמה בין מספר הקישורים בטקסט הראשי לבין מספר ההערות בכל זרם.
//
// קישור = סימון "@NN" שסומן ב‑streamMark בחלונית הראשית.
// הערה = פיסה אחת מתוך תוכן חלונית הזרם המתאים, כשמפצלים אותו לפי הסמל "@NN".
// אם החלונית פותחת בסמל — הפיסה הריקה הראשונה נופלת (תאימות עם word_bridge).

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

function markerCountsInMains(paneManager) {
  const counts = {};
  for (const pane of paneManager.panes) {
    if (pane.streamCode || !pane.editor) continue;
    const marks = findStreamMarksInState(pane.editor.state);
    for (const m of marks) {
      const code = m.streamCode;
      if (!code) continue;
      counts[code] = (counts[code] || 0) + 1;
    }
  }
  return counts;
}

export function computeLinkMismatches(paneManager) {
  if (!paneManager || !Array.isArray(paneManager.panes)) return [];
  const markerCounts = markerCountsInMains(paneManager);
  const issues = [];
  const seenCodes = new Set();

  for (const pane of paneManager.panes) {
    if (!pane.streamCode) continue;
    seenCodes.add(pane.streamCode);
    const markerCount = markerCounts[pane.streamCode] || 0;
    const noteCount = noteCountForStreamPane(pane);
    if (markerCount === noteCount) continue;
    issues.push({
      streamCode: pane.streamCode,
      label: pane.label || `זרם ${pane.streamCode}`,
      symbol: pane.symbol || `@${pane.streamCode}`,
      markerCount,
      noteCount,
      orphanedMarkers: false,
    });
  }

  for (const code of Object.keys(markerCounts)) {
    if (seenCodes.has(code)) continue;
    issues.push({
      streamCode: code,
      label: `זרם ${code}`,
      symbol: `@${code}`,
      markerCount: markerCounts[code],
      noteCount: 0,
      orphanedMarkers: true,
    });
  }

  issues.sort((a, b) => a.streamCode.localeCompare(b.streamCode));
  return issues;
}

function describeIssue(issue) {
  if (issue.orphanedMarkers) {
    return `${issue.label}: ${issue.markerCount} קישורים בראשי, אבל אין חלונית להערות.`;
  }
  if (issue.markerCount > issue.noteCount) {
    const diff = issue.markerCount - issue.noteCount;
    return `${issue.label}: יש ${issue.markerCount} קישורים בראשי, אבל רק ${issue.noteCount} הערות. חסרות ${diff}.`;
  }
  const diff = issue.noteCount - issue.markerCount;
  return `${issue.label}: יש ${issue.noteCount} הערות, אבל רק ${issue.markerCount} קישורים בראשי. ${diff} הערות לא ייוצאו.`;
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
    "display:flex",
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
    bar.hidden = true;
    bar.textContent = "";
    return;
  }
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
      li.textContent = describeIssue(issue);
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
