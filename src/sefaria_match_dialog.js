// Modal dialog shown when auto-detect finds multiple candidate refs for a
// selection. Returns a Promise that resolves with the picked match, or null
// if the user cancelled.

import { formatRefLabel } from "./sefaria_ref_format.js";

const STYLES = {
  overlay: "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99999;display:flex;align-items:center;justify-content:center;",
  modal:   "background:#fff;border-radius:8px;padding:18px 18px 14px;max-width:640px;width:90%;max-height:80vh;overflow-y:auto;direction:rtl;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.2);",
  title:   "margin:0 0 12px 0;font-size:15px;font-weight:600;color:#222;",
  hint:    "margin:0 0 12px 0;font-size:12px;color:#666;",
  list:    "display:flex;flex-direction:column;gap:6px;",
  item:    "display:block;width:100%;text-align:right;padding:10px 12px;border:1px solid #d8d8dc;background:#fff;cursor:pointer;font:inherit;font-size:13px;border-radius:5px;",
  itemRef: "display:block;font-weight:600;color:#1a3d70;margin-bottom:3px;",
  itemSnip:"display:block;color:#555;font-size:12px;line-height:1.5;",
  badge:   "display:inline-block;font-size:10px;background:#eef2ff;color:#3949a3;padding:1px 6px;border-radius:8px;margin-inline-start:6px;vertical-align:middle;",
  footer:  "margin-top:14px;display:flex;justify-content:flex-start;",
  cancel:  "padding:6px 18px;border:1px solid #ccc;background:#f5f5f7;cursor:pointer;border-radius:5px;font:inherit;font-size:13px;",
};

const TYPE_BADGE = {
  "verse-in-selection": "הפסוק בתוך הסימון",
  "selection-in-verse": "הסימון בתוך הפסוק",
};

export function showMatchDialog(matches) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = STYLES.overlay;

    const modal = document.createElement("div");
    modal.style.cssText = STYLES.modal;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const title = document.createElement("h3");
    title.textContent = `מצאתי ${matches.length} התאמות אפשריות — בחר את הנכונה:`;
    title.style.cssText = STYLES.title;
    modal.appendChild(title);

    const hint = document.createElement("p");
    hint.textContent = "ההתאמות מסודרות לפי איכות המתאם (מהארוך לקצר).";
    hint.style.cssText = STYLES.hint;
    modal.appendChild(hint);

    const list = document.createElement("div");
    list.style.cssText = STYLES.list;

    function close(value) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") close(null);
    }
    document.addEventListener("keydown", onKey);

    for (const match of matches) {
      const item = document.createElement("button");
      item.type = "button";
      item.style.cssText = STYLES.item;

      const refLine = document.createElement("span");
      refLine.style.cssText = STYLES.itemRef;
      refLine.textContent = formatRefLabel(match);
      const badge = document.createElement("span");
      badge.style.cssText = STYLES.badge;
      badge.textContent = TYPE_BADGE[match.matchType] || "";
      refLine.appendChild(badge);
      item.appendChild(refLine);

      const snip = document.createElement("span");
      snip.style.cssText = STYLES.itemSnip;
      const text = match.original || "";
      snip.textContent = text.length > 140 ? text.slice(0, 140) + "…" : text;
      item.appendChild(snip);

      item.addEventListener("click", () => close(match));
      item.addEventListener("mouseenter", () => { item.style.background = "#f7f9fc"; });
      item.addEventListener("mouseleave", () => { item.style.background = "#fff"; });
      list.appendChild(item);
    }
    modal.appendChild(list);

    const footer = document.createElement("div");
    footer.style.cssText = STYLES.footer;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "ביטול";
    cancel.style.cssText = STYLES.cancel;
    cancel.addEventListener("click", () => close(null));
    footer.appendChild(cancel);
    modal.appendChild(footer);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus first item for keyboard accessibility
    const first = list.querySelector("button");
    if (first) first.focus();
  });
}
