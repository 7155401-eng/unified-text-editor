const DEFAULT_MARKER_RE = "^(?:#{1,6}\\s+|פרק\\s+|סימן\\s+|סעיף\\s+).+";

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugName(name, index) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${String(index + 1).padStart(3, "0")}-${cleaned || "chapter"}.txt`;
}

function readEditorText(paneManager) {
  try {
    const ed = paneManager?.getActiveEditor?.();
    if (!ed) return "";
    if (ed.getText) return String(ed.getText() || "");
    return String(ed.state?.doc?.textBetween?.(0, ed.state.doc.content.size, "\n", "\n") || "");
  } catch {
    return "";
  }
}

async function readInputFile(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value || "";
  }
  return await file.text();
}

function splitChapters(text, pattern, flags = "mu") {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const re = new RegExp(pattern || DEFAULT_MARKER_RE, flags.includes("m") ? flags : flags + "m");
  const lines = source.split("\n");
  const chapters = [];
  let current = null;
  let preface = [];
  for (const line of lines) {
    if (re.test(line.trim())) {
      if (current) chapters.push(current);
      else if (preface.join("\n").trim()) {
        chapters.push({ title: "פתיחה", text: preface.join("\n").trim() });
      }
      current = { title: line.trim().replace(/^#+\s*/, ""), lines: [line] };
      re.lastIndex = 0;
      continue;
    }
    re.lastIndex = 0;
    if (current) current.lines.push(line);
    else preface.push(line);
  }
  if (current) chapters.push(current);
  else if (preface.join("\n").trim()) chapters.push({ title: "מסמך מלא", text: preface.join("\n").trim() });
  return chapters.map((chapter) => ({
    title: chapter.title || "פרק",
    text: chapter.text || (chapter.lines || []).join("\n").trim(),
  })).filter((chapter) => chapter.text.trim());
}

function openChapterSplitter(paneManager) {
  if (document.getElementById("chapter-splitter-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "chapter-splitter-overlay";
  overlay.className = "chapter-splitter-overlay";
  overlay.dir = "rtl";
  overlay.innerHTML = `
    <div class="chapter-splitter-modal">
      <header class="chapter-splitter-header">
        <div>
          <h2>פיצול עומס מסמך לפרקים</h2>
          <p>ייבוא עצלן לעימוד: פצל לפי כותרות או סימונים מותאמים אישית.</p>
        </div>
        <button type="button" class="chapter-splitter-close" aria-label="סגור">x</button>
      </header>
      <div class="chapter-splitter-body">
        <section class="chapter-splitter-controls">
          <div class="chapter-splitter-row">
            <button type="button" class="chapter-splitter-from-editor">טען מהעורך הפעיל</button>
            <label class="chapter-splitter-file">
              <span>ייבא קובץ TXT / MD / DOCX</span>
              <input type="file" accept=".txt,.md,.markdown,.docx" />
            </label>
          </div>
          <label>
            <span>סימון תחילת פרק / Regex</span>
            <input class="chapter-splitter-pattern" type="text" dir="ltr" value="${escapeHtml(DEFAULT_MARKER_RE)}" />
          </label>
          <textarea class="chapter-splitter-source" placeholder="טקסט המסמך לפיצול..."></textarea>
          <div class="chapter-splitter-actions">
            <button type="button" class="chapter-splitter-preview">חשב פרקים</button>
            <button type="button" class="chapter-splitter-zip">ייצא ZIP</button>
          </div>
        </section>
        <section class="chapter-splitter-preview-pane">
          <div class="chapter-splitter-count">אין עדיין פיצול.</div>
          <div class="chapter-splitter-list"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const source = overlay.querySelector(".chapter-splitter-source");
  const pattern = overlay.querySelector(".chapter-splitter-pattern");
  const list = overlay.querySelector(".chapter-splitter-list");
  const count = overlay.querySelector(".chapter-splitter-count");
  let chapters = [];

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", esc);
  }
  function esc(ev) {
    if (ev.key === "Escape") close();
  }
  function render() {
    chapters = splitChapters(source.value, pattern.value);
    count.textContent = chapters.length
      ? `נמצאו ${chapters.length} פרקים.`
      : "לא נמצאו פרקים לפי הסימון הנוכחי.";
    list.innerHTML = chapters.map((chapter, index) => `
      <article class="chapter-splitter-item">
        <strong>${escapeHtml(chapter.title || `פרק ${index + 1}`)}</strong>
        <span>${chapter.text.length.toLocaleString("he-IL")} תווים</span>
        <p>${escapeHtml(chapter.text.slice(0, 220))}${chapter.text.length > 220 ? "..." : ""}</p>
      </article>
    `).join("");
  }

  overlay.querySelector(".chapter-splitter-close").addEventListener("click", close);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  document.addEventListener("keydown", esc);
  overlay.querySelector(".chapter-splitter-from-editor").addEventListener("click", () => {
    source.value = readEditorText(paneManager);
    render();
  });
  overlay.querySelector(".chapter-splitter-preview").addEventListener("click", render);
  overlay.querySelector(".chapter-splitter-file input").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    source.value = await readInputFile(file);
    render();
  });
  overlay.querySelector(".chapter-splitter-zip").addEventListener("click", async () => {
    render();
    if (!chapters.length) return;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    chapters.forEach((chapter, index) => {
      zip.file(slugName(chapter.title, index), chapter.text);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ravtext-chapters-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  source.value = readEditorText(paneManager);
  render();
}

export function wireChapterSplitter(paneManager) {
  const toolbar = document.querySelector(".layout-extra-toolbar") || document.querySelector(".insert-toolbar");
  if (!toolbar || toolbar.querySelector("#chapter-splitter-btn")) return;
  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "פיצול מסמך";
  group.dataset.ribbonTab = "layout";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "chapter-splitter-btn";
  btn.textContent = "פיצול פרקים";
  btn.title = "ייבא או פצל את המסמך לפרקים לפי כותרות או סימונים מותאמים אישית";
  btn.addEventListener("click", () => openChapterSplitter(paneManager));
  group.appendChild(btn);
  toolbar.appendChild(group);
}
