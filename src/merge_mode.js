const SNAPSHOT_KEY = "ravtext.merge.snapshot.v1";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitNotesBySymbol(text, symbol) {
  const parts = String(text || "").split(symbol);
  if (parts.length > 0 && parts[0].trim() === "") parts.shift();
  return parts
    .map((part) => part.trim().replace(/^\[\d+\]\s*/, ""))
    .filter(Boolean);
}

function mergeSnapshotToText(paneManager) {
  const main = paneManager.getMainPane();
  const mainText = main && main.editor ? main.editor.state.doc.textContent : "";
  const configs = [];

  for (const pane of paneManager.panes) {
    if (!pane.streamCode || !pane.editor) continue;
    const symbol = pane.symbol || `@${pane.streamCode}`;
    configs.push({
      symbol,
      notes: splitNotesBySymbol(pane.editor.state.doc.textContent, symbol),
      cursor: 0,
    });
  }

  configs.sort((a, b) => b.symbol.length - a.symbol.length);
  if (configs.length === 0) return mainText;

  const regex = new RegExp(`(${configs.map((c) => escapeRegex(c.symbol)).join("|")})`, "g");
  return mainText.replace(regex, (match) => {
    const cfg = configs.find((c) => c.symbol === match);
    if (!cfg) return match;
    const note = cfg.notes[cfg.cursor++];
    return note === undefined ? match : `[[${match} ${note}]]`;
  });
}

export function toggleMerge(paneManager) {
  if (paneManager.merged) {
    const snap = paneManager._mergeSnapshot || JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!snap) {
      alert("אין מצב קודם לפריקה");
      return false;
    }
    paneManager.load(snap);
    paneManager.merged = false;
    paneManager._mergeSnapshot = null;
    localStorage.removeItem(SNAPSHOT_KEY);
    return true;
  }

  const snapshot = paneManager.serialize();
  paneManager._mergeSnapshot = snapshot;
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));

  const mergedText = mergeSnapshotToText(paneManager);
  paneManager.load({
    version: 1,
    activeId: "merged-main",
    panes: [{
      id: "merged-main",
      streamCode: null,
      symbol: "",
      label: "ראשי",
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }],
  });

  const main = paneManager.getMainPane();
  if (main && main.editor) {
    main.editor.commands.setContent(`<p>${escapeHtml(mergedText).replace(/\n/g, "<br>")}</p>`);
  }
  paneManager.merged = true;
  return true;
}
