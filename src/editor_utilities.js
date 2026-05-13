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
  const TORAH_STORAGE = "ravtext.torahSpellcheck";
  cb.checked = localStorage.getItem(STORAGE) === "1";
  const group = cb.closest(".tb-group") || cb.parentElement;
  let torahLabel = document.getElementById("torah-spellcheck-toggle-label");
  let torahCb = document.getElementById("torah-spellcheck-toggle");
  if (group && !torahCb) {
    torahLabel = document.createElement("label");
    torahLabel.id = "torah-spellcheck-toggle-label";
    torahLabel.className = "toolbar-checkbox";
    torahCb = document.createElement("input");
    torahCb.type = "checkbox";
    torahCb.id = "torah-spellcheck-toggle";
    const txt = document.createElement("span");
    txt.textContent = "בדיקת איות תורני";
    torahLabel.appendChild(torahCb);
    torahLabel.appendChild(txt);
    group.appendChild(torahLabel);
    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.id = "torah-spellcheck-run";
    checkBtn.textContent = "בדוק תורני";
    checkBtn.title = "בודק מילים מול חיפוש ספריא; מילה שמופיעה בהרבה מקורות נחשבת תקינה";
    group.appendChild(checkBtn);
  }
  if (torahCb) torahCb.checked = localStorage.getItem(TORAH_STORAGE) === "1";

  function apply() {
    const on = cb.checked;
    const torahOn = !!torahCb?.checked;
    document.querySelectorAll(".ProseMirror").forEach((el) => {
      el.setAttribute("spellcheck", on ? "true" : "false");
      el.spellcheck = on;
      el.setAttribute("lang", "he");
      el.setAttribute("dir", el.getAttribute("dir") || "rtl");
    });
    for (const pane of paneManager.panes || []) {
      const dom = pane.editor?.view?.dom;
      if (!dom) continue;
      dom.setAttribute("spellcheck", on ? "true" : "false");
      dom.spellcheck = on;
      dom.setAttribute("lang", "he");
      try {
        pane.editor.setOptions({
          editorProps: {
            ...(pane.editor.options.editorProps || {}),
            attributes: {
              ...((pane.editor.options.editorProps || {}).attributes || {}),
              spellcheck: on ? "true" : "false",
              lang: "he",
            },
          },
        });
      } catch (_) {}
    }
    localStorage.setItem(STORAGE, on ? "1" : "0");
    localStorage.setItem(TORAH_STORAGE, torahOn ? "1" : "0");
    document.body.classList.toggle("torah-spellcheck-enabled", torahOn);
  }
  cb.addEventListener("change", apply);
  torahCb?.addEventListener("change", apply);
  apply();
  paneManager.on?.("change", apply);
  document.getElementById("torah-spellcheck-run")?.addEventListener("click", () => {
    runTorahSpellcheck(paneManager);
  });
}

const COMMON_HE_WORDS = new Set([
  "של", "על", "אל", "עם", "או", "אם", "כי", "לא", "כן", "זה", "זו", "הוא", "היא",
  "את", "כל", "גם", "יש", "אין", "היה", "היו", "שם", "מה", "מי", "בו", "בה", "לו",
  "לה", "מן", "כדי", "אבל", "אשר", "ואם", "וכן", "עוד", "וכו"
]);

function torahSpellWords(text) {
  const words = String(text || "").match(/[\u0590-\u05FF]{3,}/g) || [];
  const seen = new Set();
  const out = [];
  for (const raw of words) {
    const w = raw.replace(/^[והבכלמש]+(?=[\u0590-\u05FF]{3,}$)/, "");
    if (w.length < 3 || COMMON_HE_WORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 80) break;
  }
  return out;
}

async function sefariaHitCount(word) {
  const res = await fetch("https://www.sefaria.org/api/search-wrapper", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      query: word,
      type: "text",
      field: "naive_lemmatizer",
      size: 0,
    }),
  });
  if (!res.ok) throw new Error(`Sefaria HTTP ${res.status}`);
  const data = await res.json();
  const total = data?.hits?.total;
  if (typeof total === "number") return total;
  if (total && typeof total.value === "number") return total.value;
  return 0;
}

async function runTorahSpellcheck(paneManager) {
  const editor = activeEditor(paneManager) || paneManager.getMainPane?.()?.editor;
  if (!editor) return;
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ");
  const words = torahSpellWords(text);
  if (words.length === 0) {
    alert("לא נמצאו מילים לבדיקה.");
    return;
  }
  const btn = document.getElementById("torah-spellcheck-run");
  const old = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "בודק...";
  }
  try {
    const suspicious = [];
    const cache = JSON.parse(localStorage.getItem("ravtext.torahSpellCache.v1") || "{}");
    for (const word of words) {
      let count = cache[word];
      if (typeof count !== "number") {
        count = await sefariaHitCount(word);
        cache[word] = count;
      }
      if (count < 3) suspicious.push(`${word} (${count})`);
      if (suspicious.length >= 30) break;
    }
    localStorage.setItem("ravtext.torahSpellCache.v1", JSON.stringify(cache));
    alert(
      suspicious.length
        ? `מילים שצריכות בדיקה:\n${suspicious.join(", ")}`
        : "לא נמצאו מילים חשודות בבדיקה התורנית."
    );
  } catch (err) {
    alert(`בדיקת איות תורני נכשלה: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = old || "בדוק תורני";
    }
  }
}

function normalizePreviewQuery(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function clearPreviewSelectionHits() {
  document.querySelectorAll(".ravtext-preview-selection-hit").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(el.textContent || ""), el);
    parent.normalize();
  });
}

function markFirstTextOccurrence(root, query) {
  if (!root || !query) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(".ravtext-preview-selection-hit")) return NodeFilter.FILTER_REJECT;
      if (!parent.closest(".page-main, .page-streams")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.includes(query)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const node = walker.nextNode();
  if (!node) return null;
  const idx = node.nodeValue.indexOf(query);
  const range = document.createRange();
  range.setStart(node, idx);
  range.setEnd(node, idx + query.length);
  const mark = document.createElement("mark");
  mark.className = "ravtext-preview-selection-hit";
  range.surroundContents(mark);
  return mark;
}

export function wirePreviewSelectionSync() {
  let timer = null;
  const run = () => {
    timer = null;
    clearPreviewSelectionHits();
    const sel = document.getSelection?.();
    const text = normalizePreviewQuery(sel?.toString?.() || "");
    if (!text || text.length < 2) return;
    const anchorEl = sel.anchorNode?.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement
      : sel.anchorNode;
    if (!anchorEl?.closest?.(".ProseMirror")) return;
    const pages = document.getElementById("pages-container");
    const hit = markFirstTextOccurrence(pages, text);
    hit?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };
  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 180);
  });
  window.addEventListener("ravtext:engine-rendered", () => {
    clearPreviewSelectionHits();
  });
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
