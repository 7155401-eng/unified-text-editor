// Editor utilities — Word-like extras: word/character count, fullscreen,
// zoom, formatting marks, spell-check toggle, page-break, horizontal rule.

function activeEditor(paneManager) {
  return paneManager.getActiveEditor?.() || null;
}

function countDoc(editor) {
  if (!editor) return { chars: 0, words: 0, paragraphs: 0 };
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  let paragraphs = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") paragraphs++;
  });
  return { chars, words, paragraphs };
}

function findStatusEl() {
  return document.getElementById("editor-stats-display");
}

function refreshStats(paneManager) {
  const el = findStatusEl();
  if (!el) return;
  const ed = activeEditor(paneManager);
  if (!ed) {
    el.textContent = "";
    return;
  }
  const c = countDoc(ed);
  el.textContent = `מילים: ${c.words} • תווים: ${c.chars} • פסקאות: ${c.paragraphs}`;
}

export function wireWordCount(paneManager) {
  const el = findStatusEl();
  if (!el) return;
  refreshStats(paneManager);
  paneManager.on?.("change", () => refreshStats(paneManager));
  paneManager.on?.("focus", () => refreshStats(paneManager));
}

export function wireFullscreen() {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    btn.classList.toggle("active", !!document.fullscreenElement);
    btn.textContent = document.fullscreenElement ? "⛶ צא ממסך מלא" : "⛶ מסך מלא";
  });
}

export function wireZoom() {
  const slider = document.getElementById("zoom-slider");
  const label = document.getElementById("zoom-label");
  if (!slider) return;
  const STORAGE = "ravtext.zoom";
  const stored = parseInt(localStorage.getItem(STORAGE) || "100", 10);
  slider.value = String(stored);
  if (label) label.textContent = `${stored}%`;
  function apply(value) {
    const pct = Math.max(50, Math.min(200, parseInt(value, 10) || 100));
    document.documentElement.style.setProperty("--ravtext-zoom", String(pct / 100));
    const containers = document.querySelectorAll("#pages-container, .pages-container");
    containers.forEach((c) => {
      c.style.transform = `scale(${pct / 100})`;
      c.style.transformOrigin = "top center";
    });
    if (label) label.textContent = `${pct}%`;
    localStorage.setItem(STORAGE, String(pct));
  }
  slider.addEventListener("input", () => apply(slider.value));
  apply(slider.value);
  document.getElementById("zoom-reset")?.addEventListener("click", () => {
    slider.value = "100";
    apply("100");
  });
}

export function wireFormattingMarks() {
  const cb = document.getElementById("formatting-marks-toggle");
  if (!cb) return;
  const STORAGE = "ravtext.formattingMarks";
  cb.checked = localStorage.getItem(STORAGE) === "1";
  function apply() {
    document.body.classList.toggle("show-formatting-marks", cb.checked);
    localStorage.setItem(STORAGE, cb.checked ? "1" : "0");
  }
  cb.addEventListener("change", apply);
  apply();
}

export function wireSpellcheck(paneManager) {
  const cb = document.getElementById("spellcheck-toggle");
  if (!cb) return;
  const STORAGE = "ravtext.spellcheck";
  cb.checked = localStorage.getItem(STORAGE) === "1";
  function apply() {
    const on = cb.checked;
    document.querySelectorAll(".ProseMirror").forEach((el) => {
      el.setAttribute("spellcheck", on ? "true" : "false");
    });
    localStorage.setItem(STORAGE, on ? "1" : "0");
  }
  cb.addEventListener("change", apply);
  apply();
  paneManager.on?.("change", apply);
}

export function wireQuickInsertActions(paneManager) {
  const get = () => activeEditor(paneManager);
  document.getElementById("btn-insert-hr")?.addEventListener("click", () => {
    get()?.chain().focus().setHorizontalRule().run();
  });
  document.getElementById("btn-insert-page-break")?.addEventListener("click", () => {
    const ed = get();
    if (!ed) return;
    ed.chain().focus().insertContent({
      type: "paragraph",
      attrs: { class: "ravtext-page-break" },
    }).run();
    requestAnimationFrame(() => {
      const last = ed.view.dom.querySelector("p:last-of-type");
      if (last && last.textContent.trim() === "") last.classList.add("ravtext-page-break");
    });
  });
  document.getElementById("btn-insert-hardbreak")?.addEventListener("click", () => {
    get()?.chain().focus().setHardBreak().run();
  });
}
