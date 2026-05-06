// Word-like editing extras — features Word users expect that the existing
// TipTap toolbar doesn't expose: highlight, format painter, math (KaTeX),
// mermaid diagrams, inline comments, section/clause auto-numbering.
//
// External libraries (KaTeX, Mermaid) are lazy-loaded from a CDN on first
// use to avoid bloating the initial bundle.

let _katexLoading = null;
function loadKaTeX() {
  if (window.katex) return Promise.resolve(window.katex);
  if (_katexLoading) return _katexLoading;
  _katexLoading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    s.onload = () => resolve(window.katex);
    s.onerror = () => reject(new Error("KaTeX failed to load"));
    document.head.appendChild(s);
  });
  return _katexLoading;
}

let _mermaidLoading = null;
function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (_mermaidLoading) return _mermaidLoading;
  _mermaidLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs";
    s.onload = () => {
      import("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs")
        .then((mod) => {
          window.mermaid = mod.default;
          mod.default.initialize({ startOnLoad: false, theme: "default" });
          resolve(mod.default);
        })
        .catch(reject);
    };
    s.onerror = () => reject(new Error("Mermaid failed to load"));
    document.head.appendChild(s);
  });
  return _mermaidLoading;
}

function activeEditor(paneManager) {
  return paneManager.getActiveEditor?.() || null;
}

function getMarksAtSelection(editor) {
  if (!editor) return [];
  const { from, to } = editor.state.selection;
  const marks = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    for (const m of node.marks) {
      if (!marks.find((x) => x.type === m.type && JSON.stringify(x.attrs) === JSON.stringify(m.attrs))) {
        marks.push({ type: m.type, attrs: m.attrs });
      }
    }
  });
  return marks;
}

let _formatPainterMarks = null;
let _formatPainterArmed = false;

export function wireFormatPainter(paneManager) {
  const btn = document.getElementById("btn-format-painter");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const ed = activeEditor(paneManager);
    if (!ed) return;
    if (_formatPainterArmed) {
      _formatPainterArmed = false;
      _formatPainterMarks = null;
      btn.classList.remove("active");
      return;
    }
    _formatPainterMarks = getMarksAtSelection(ed);
    if (_formatPainterMarks.length === 0) {
      const status = document.getElementById("status");
      if (status) status.textContent = "המקור לא הכיל עיצוב — בחר טקסט עם עיצוב לפני לחיצה על המברשת.";
      return;
    }
    _formatPainterArmed = true;
    btn.classList.add("active");
    const status = document.getElementById("status");
    if (status) status.textContent = "מברשת מזוינת — בחר טקסט יעד והמברשת תיישם את העיצוב.";
  });
  document.addEventListener("mouseup", () => {
    if (!_formatPainterArmed || !_formatPainterMarks) return;
    const ed = activeEditor(paneManager);
    if (!ed) return;
    const { from, to, empty } = ed.state.selection;
    if (empty || from === to) return;
    let chain = ed.chain().focus();
    for (const m of _formatPainterMarks) {
      chain = chain.setMark(m.type.name, m.attrs);
    }
    chain.run();
    _formatPainterArmed = false;
    _formatPainterMarks = null;
    btn.classList.remove("active");
  });
}

export function wireHighlight(paneManager) {
  const btn = document.getElementById("btn-highlight");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const ed = activeEditor(paneManager);
    if (!ed) return;
    ed.chain().focus().setBackgroundColor?.("#fef08a").run();
  });
  const btnClear = document.getElementById("btn-highlight-clear");
  btnClear?.addEventListener("click", () => {
    const ed = activeEditor(paneManager);
    if (!ed) return;
    ed.chain().focus().unsetBackgroundColor?.().run();
  });
}

export async function insertMath(paneManager) {
  const ed = activeEditor(paneManager);
  if (!ed) return;
  const tex = prompt("כתוב נוסחה ב-LaTeX:", "x^2 + y^2 = z^2");
  if (!tex) return;
  try {
    const katex = await loadKaTeX();
    const html = katex.renderToString(tex, { throwOnError: false, displayMode: false });
    ed.chain().focus().insertContent(`<span class="ravtext-math" data-tex="${tex.replace(/"/g, "&quot;")}">${html}</span>`).run();
  } catch (e) {
    alert("טעינת KaTeX נכשלה: " + e.message);
  }
}

export async function insertMermaid(paneManager) {
  const ed = activeEditor(paneManager);
  if (!ed) return;
  const code = prompt("הקלד קוד Mermaid (תרשים זרימה / רצף / וכו'):",
    "graph TD;\n  A[התחלה] --> B{החלטה};\n  B -- כן --> C[סיום];\n  B -- לא --> D[חזרה];");
  if (!code) return;
  try {
    const mermaid = await loadMermaid();
    const id = "mmd-" + Math.random().toString(36).slice(2, 9);
    const { svg } = await mermaid.render(id, code);
    ed.chain().focus().insertContent(`<div class="ravtext-mermaid" data-source="${code.replace(/"/g, "&quot;")}">${svg}</div>`).run();
  } catch (e) {
    alert("טעינת/רנדור Mermaid נכשל: " + e.message);
  }
}

export function insertComment(paneManager) {
  const ed = activeEditor(paneManager);
  if (!ed) return;
  const note = prompt("טקסט ההערה:");
  if (!note) return;
  const { from, to, empty } = ed.state.selection;
  if (empty || from === to) {
    ed.chain().focus().insertContent(`<mark class="ravtext-comment" title="${note.replace(/"/g, "&quot;")}">[הערה: ${note}]</mark>`).run();
  } else {
    const selectedText = ed.state.doc.textBetween(from, to, " ", " ");
    ed.chain().focus().deleteRange({ from, to }).insertContent(`<mark class="ravtext-comment" title="${note.replace(/"/g, "&quot;")}">${selectedText}</mark>`).run();
  }
}

export function autoNumberClauses(paneManager) {
  const ed = activeEditor(paneManager);
  if (!ed) return;
  const HEB_NUMS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י",
    "יא", "יב", "יג", "יד", "טו", "טז", "יז", "יח", "יט", "כ",
    "כא", "כב", "כג", "כד", "כה", "כו", "כז", "כח", "כט", "ל",
    "לא", "לב", "לג", "לד", "לה", "לו", "לז", "לח", "לט", "מ"];
  const root = ed.view.dom;
  const paragraphs = Array.from(root.querySelectorAll("p"));
  let counter = 0;
  for (const p of paragraphs) {
    if (p.textContent.trim().length === 0) continue;
    const existingMatch = p.textContent.match(/^[֐-׿]+\.\s/);
    if (existingMatch) continue;
    if (counter >= HEB_NUMS.length) break;
    const num = HEB_NUMS[counter];
    p.textContent = `${num}. ${p.textContent}`;
    counter++;
  }
  if (counter > 0) {
    const status = document.getElementById("status");
    if (status) status.textContent = `מוספרו ${counter} סעיפים בעורך הפעיל.`;
  }
}

export function insertChapterHeading(paneManager) {
  const ed = activeEditor(paneManager);
  if (!ed) return;
  const num = prompt("מספר פרק/סימן:", "א");
  if (!num) return;
  const title = prompt("כותרת:", "");
  const text = title ? `סימן ${num} – ${title}` : `סימן ${num}`;
  ed.chain().focus().insertContent(`<h2 class="ravtext-chapter-head">${text}</h2><p></p>`).run();
}

export function wireWordLikeTools(paneManager) {
  wireFormatPainter(paneManager);
  wireHighlight(paneManager);
}
