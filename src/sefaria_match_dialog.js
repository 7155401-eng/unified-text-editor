// Modal dialog shown when auto-detect finds multiple candidate refs for a
// selection. Returns a Promise that resolves with { match, withNiqqud, withSource }
// (the user's pick + their checkbox state), or null if cancelled.
//
// Defaults flow from the action button the user clicked (Moshe, 2026-05-09):
//   ניקוד    → niqqud=ON,  source=OFF
//   מקור     → niqqud=OFF, source=ON
//   ניקוד+מקור → niqqud=ON, source=ON
//   השלמה    → niqqud=OFF, source=ON
// The caller passes those defaults in; whatever the user changes before
// clicking a match overrides the toolbar's niqqud + the button's cite param.

import { formatRefLabel } from "./sefaria_ref_format.js";

const STYLES = {
  overlay:  "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99999;display:flex;align-items:center;justify-content:center;",
  modal:    "background:#fff;border-radius:8px;padding:18px 18px 14px;max-width:640px;width:90%;max-height:80vh;overflow-y:auto;direction:rtl;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.2);",
  title:    "margin:0 0 8px 0;font-size:15px;font-weight:600;color:#222;",
  hint:     "margin:0 0 12px 0;font-size:12px;color:#666;",
  options:  "display:flex;gap:18px;padding:8px 10px;margin:0 0 12px 0;background:#f7f9fc;border:1px solid #e0e6ef;border-radius:5px;font-size:13px;",
  optLabel: "display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;",
  list:     "display:flex;flex-direction:column;gap:6px;",
  item:     "display:block;width:100%;text-align:right;padding:10px 12px;border:1px solid #d8d8dc;background:#fff;cursor:pointer;font:inherit;font-size:13px;border-radius:5px;",
  itemRef:  "display:block;font-weight:600;color:#1a3d70;margin-bottom:3px;",
  itemSnip: "display:block;color:#555;font-size:12px;line-height:1.5;",
  badge:    "display:inline-block;font-size:10px;background:#eef2ff;color:#3949a3;padding:1px 6px;border-radius:8px;margin-inline-start:6px;vertical-align:middle;",
  footer:   "margin-top:14px;display:flex;justify-content:flex-start;",
  cancel:   "padding:6px 18px;border:1px solid #ccc;background:#f5f5f7;cursor:pointer;border-radius:5px;font:inherit;font-size:13px;",
};

const TYPE_BADGE = {
  "verse-in-selection": "הפסוק בתוך הסימון",
  "selection-in-verse": "הסימון בתוך הפסוק",
};

export function showMatchDialog(matches, defaults = {}) {
  const initialNiqqud = defaults.withNiqqud === true;
  const initialSource = defaults.withSource !== false; // default to true if not given
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

    // === Options strip ===
    // Defaults are passed in by the caller, derived from which action button
    // was clicked. The user can override before picking a match.
    const options = document.createElement("div");
    options.style.cssText = STYLES.options;

    function makeCheckbox(id, label, defaultChecked) {
      const wrap = document.createElement("label");
      wrap.style.cssText = STYLES.optLabel;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = defaultChecked;
      const span = document.createElement("span");
      span.textContent = label;
      wrap.appendChild(cb);
      wrap.appendChild(span);
      return { wrap, cb };
    }
    const niqqud = makeCheckbox("smd-niqqud", "להכניס עם ניקוד", initialNiqqud);
    const source = makeCheckbox("smd-source", "להכניס עם מקור", initialSource);
    options.appendChild(niqqud.wrap);
    options.appendChild(source.wrap);
    modal.appendChild(options);

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

      item.addEventListener("click", () => close({
        match,
        withNiqqud: niqqud.cb.checked,
        withSource: source.cb.checked,
      }));
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
