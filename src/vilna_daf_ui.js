// vilna_daf_ui.js — הכפתורים וההגדרות של "נעילת דף".
//
// שלושה דברים:
//   1. הגדרות: להדליק/לכבות, לבחור מצב, ולקבוע כמה מותר להקטין ולהגדיל.
//   2. כפתור "סמן סוף דף" — מכניס ⟦דף …⟧ במקום הסמן, למי שמקליד לבד.
//   3. דוח קצר אחרי רינדור: כמה דפים, איזה דף הוקטן, ומי לא נכנס.

import {
  DAF_LOCK_KEYS, makeDafMark, readDafLockSettings,
} from "./vilna_daf_lock.js";

function ls(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
    return value;
  } catch {
    return null;
  }
}

export function wireDafLockControls(onChange) {
  const toggle = document.getElementById("daf-lock-toggle");
  const modeSelect = document.getElementById("daf-lock-mode-select");
  const minInput = document.getElementById("daf-lock-min-input");
  const maxInput = document.getElementById("daf-lock-max-input");
  const labelToggle = document.getElementById("daf-lock-label-toggle");
  const markBtn = document.getElementById("daf-lock-mark-btn");
  const reportBtn = document.getElementById("daf-lock-report-btn");
  if (!toggle && !markBtn) return;

  const s = readDafLockSettings();
  if (toggle) toggle.checked = s.enabled !== "0";
  if (modeSelect) modeSelect.value = s.mode;
  if (minInput) minInput.value = Math.round(s.minScale * 100);
  if (maxInput) maxInput.value = Math.round(s.maxScale * 100);
  if (labelToggle) labelToggle.checked = s.showLabel;

  const commit = () => onChange?.();

  toggle?.addEventListener("change", () => {
    // "auto" = פועל רק כשיש סימני דף בטקסט. זו ברירת המחדל: מסמך רגיל
    // לא מרגיש שהתכונה קיימת, ומסמך עם סימנים מקבל אותה בלי לבקש.
    ls(DAF_LOCK_KEYS.enabled, toggle.checked ? "auto" : "0");
    commit();
  });
  modeSelect?.addEventListener("change", () => {
    ls(DAF_LOCK_KEYS.mode, modeSelect.value === "soft" ? "soft" : "strict");
    commit();
  });
  minInput?.addEventListener("change", () => {
    const n = Math.max(40, Math.min(100, parseInt(minInput.value, 10) || 70));
    minInput.value = n;
    ls(DAF_LOCK_KEYS.minScale, String(n));
    commit();
  });
  maxInput?.addEventListener("change", () => {
    const n = Math.max(100, Math.min(250, parseInt(maxInput.value, 10) || 130));
    maxInput.value = n;
    ls(DAF_LOCK_KEYS.maxScale, String(n));
    commit();
  });
  labelToggle?.addEventListener("change", () => {
    ls(DAF_LOCK_KEYS.showLabel, labelToggle.checked ? "1" : "0");
    commit();
  });

  markBtn?.addEventListener("click", () => {
    // הסימן נכנס לעורך הפעיל; אם אין פעיל — לעורך הראשי.
    const pm = window.paneManager;
    const editor = pm?.getActiveEditor?.() || pm?.getMainPane?.()?.editor;
    if (!editor) {
      alert("אין עורך פעיל לסימון דף");
      return;
    }
    const label = prompt('שם הדף שמתחיל כאן (למשל: ב. או ה"ב):', "");
    if (label === null) return;
    const mark = makeDafMark(label);
    // הסימן יושב בפסקה משלו: כך הוא לא נדחף לתוך משפט, וקל למחוק אותו.
    editor.chain().focus().insertContent(`<p>${mark}</p>`).run();
    commit();
  });

  reportBtn?.addEventListener("click", showDafReport);
}

export function showDafReport() {
  const r = typeof window !== "undefined" ? window.__VILNA_DAF_REPORT__ : null;
  if (!r) {
    alert("עדיין לא רץ רינדור עם נעילת דף.\nסמן דפים בטקסט (⟦דף ב.⟧) והפעל רינדור.");
    return;
  }
  const rows = r.segments.map((s) => {
    const name = s.label || "(פתיחה)";
    const scale = `${Math.round(s.scale * 100)}%`;
    const fill = `${Math.round((s.fill || 0) * 100)}%`;
    const note = s.overflow ? "  ⚠ לא נכנס בעמוד אחד" : "";
    return `דף ${name}: ${s.pages} עמ' · אות ${scale} · מילוי ${fill}${note}`;
  });
  const head = [
    `מצב: ${r.mode === "soft" ? "רק גבול הדף" : "דף = עמוד"}`,
    `סימני דף: ${r.markerCount} · עמודים: ${r.pagesTotal} · זמן: ${Math.round((r.durationMs || 0) / 100) / 10} שנ'`,
    r.dafimOverflowed ? `⚠ ${r.dafimOverflowed} דפים לא נכנסו בעמוד אחד גם בהקטנה המרבית` : "כל הדפים נכנסו בעמוד אחד",
    "",
  ];
  alert([...head, ...rows].join("\n"));
}
