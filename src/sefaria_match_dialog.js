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

// Visual palette matches the Torah toolbar — softer/lighter version per Moshe (2026-05-09).
const STYLES = {
  overlay:  "position:fixed;inset:0;background:rgba(30,40,60,0.40);backdrop-filter:blur(1px);z-index:99999;display:flex;align-items:center;justify-content:center;",
  modal:    "background:linear-gradient(180deg,#fefcf6 0%,#fbf8ee 100%);border:1px solid #e8d68f;border-radius:9px;padding:20px 22px 16px;max-width:680px;width:92%;max-height:80vh;overflow-y:auto;direction:rtl;font-family:inherit;box-shadow:0 12px 36px rgba(30,40,60,0.18),0 0 32px rgba(212,175,55,0.08);",
  title:    "margin:0 0 8px 0;font-size:16px;font-weight:700;color:#2a4677;letter-spacing:0.2px;",
  hint:     "margin:0 0 14px 0;font-size:12px;color:#9a4a52;font-style:italic;",
  options:  "display:flex;gap:20px;padding:9px 14px;margin:0 0 14px 0;background:linear-gradient(180deg,#fffdf3 0%,#fcf6dd 100%);border:1px solid #e8d68f;border-radius:5px;font-size:13px;color:#2a4677;font-weight:500;",
  optLabel: "display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none;",
  list:     "display:flex;flex-direction:column;gap:7px;",
  item:     "display:block;width:100%;text-align:right;padding:11px 14px;border:1px solid #e6d8b3;background:linear-gradient(180deg,#ffffff 0%,#fcf9f0 100%);cursor:pointer;font:inherit;font-size:13px;border-radius:6px;transition:all 0.15s ease;",
  itemRef:  "display:block;font-weight:700;color:#2a4677;margin-bottom:4px;font-size:14px;",
  itemSnip: "display:block;color:#4a4a4a;font-size:12px;line-height:1.6;",
  badge:    "display:inline-block;font-size:10px;background:#fef9e3;color:#9a4a52;padding:2px 8px;border-radius:10px;border:1px solid #e8d68f;margin-inline-start:8px;vertical-align:middle;font-weight:600;letter-spacing:0.2px;",
  footer:   "margin-top:16px;display:flex;justify-content:flex-start;",
  cancel:   "padding:7px 20px;border:1px solid #ddc99a;background:linear-gradient(180deg,#ffffff 0%,#fcf9f0 100%);color:#2a4677;cursor:pointer;border-radius:6px;font:inherit;font-size:13px;font-weight:500;transition:all 0.15s ease;",
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
      item.addEventListener("mouseenter", () => {
        item.style.background = "linear-gradient(180deg,#fffceb 0%,#fdf5d6 100%)";
        item.style.borderColor = "#c79a3a";
        item.style.boxShadow = "0 2px 6px rgba(184,134,11,0.12)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "linear-gradient(180deg,#ffffff 0%,#fcf9f0 100%)";
        item.style.borderColor = "#e6d8b3";
        item.style.boxShadow = "none";
      });
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
