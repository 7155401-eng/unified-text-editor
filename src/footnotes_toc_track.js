// Footnotes (numbered, auto-collected at end), Table of Contents generator,
// and a simple Track-Changes diff snapshot/highlight system.

// === Footnotes ===
// Each footnote is a <sup class="ravtext-fn-ref" data-fn-id="N">N</sup>
// inserted at cursor; the body text is appended to a single
// <ol class="ravtext-footnotes"> at the document end.

function ensureFootnoteList(editor) {
  const dom = editor.view.dom;
  let list = dom.querySelector("ol.ravtext-footnotes");
  if (list) return list;
  return null;
}

function nextFootnoteId(editor) {
  const dom = editor.view.dom;
  const refs = dom.querySelectorAll(".ravtext-fn-ref[data-fn-id]");
  let max = 0;
  refs.forEach((r) => {
    const n = parseInt(r.dataset.fnId, 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

export function insertFootnote(paneManager) {
  const editor = paneManager.getActiveEditor?.();
  if (!editor) return;
  const text = prompt("טקסט ההערה:");
  if (!text) return;
  const id = nextFootnoteId(editor);

  editor
    .chain()
    .focus()
    .insertContent(`<sup class="ravtext-fn-ref" data-fn-id="${id}">${id}</sup>`)
    .run();

  // Append/update the footnotes list at the end of the document.
  const dom = editor.view.dom;
  let list = dom.querySelector("ol.ravtext-footnotes");
  if (!list) {
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      `<ol class="ravtext-footnotes"><li class="ravtext-fn-item" data-fn-id="${id}">${text}</li></ol>`
    );
  } else {
    const li = document.createElement("li");
    li.className = "ravtext-fn-item";
    li.dataset.fnId = String(id);
    li.textContent = text;
    list.appendChild(li);
  }
}

// === Table of Contents ===
// Walks the active editor for h1/h2/h3 elements and inserts an <ul>
// linked TOC at the cursor.

export function insertTOC(paneManager) {
  const editor = paneManager.getActiveEditor?.();
  if (!editor) return;
  const dom = editor.view.dom;
  const headings = Array.from(dom.querySelectorAll("h1, h2, h3"));
  if (headings.length === 0) {
    alert("לא נמצאו כותרות (H1/H2/H3) במסמך.");
    return;
  }
  let html = '<div class="ravtext-toc"><h2>תוכן עניינים</h2><ul>';
  headings.forEach((h, i) => {
    const id = `ravtext-toc-target-${i}`;
    h.id = h.id || id;
    const level = parseInt(h.tagName.slice(1), 10);
    const indent = (level - 1) * 16;
    const text = (h.textContent || "").trim();
    if (!text) return;
    html += `<li style="padding-inline-start:${indent}px"><a href="#${h.id}">${text}</a></li>`;
  });
  html += "</ul></div>";
  editor.chain().focus().insertContent(html).run();
}

// === Track Changes (snapshot + diff) ===
// On toggle ON: snapshot current document JSON to localStorage.
// "Show changes" button: compare current to snapshot, highlight differing
// paragraphs with insert/delete markers. Simple paragraph-level diff.

const TRACK_KEY = "ravtext.trackChanges.enabled";
const SNAPSHOT_KEY = "ravtext.trackChanges.snapshot";

function paragraphsFromDoc(doc) {
  const paras = [];
  doc.descendants((node) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      paras.push(node.textContent);
    }
  });
  return paras;
}

export function wireTrackChanges(paneManager) {
  const cb = document.getElementById("track-changes-toggle");
  const showBtn = document.getElementById("track-changes-show");
  if (!cb && !showBtn) return;

  if (cb) {
    cb.checked = localStorage.getItem(TRACK_KEY) === "1";
    cb.addEventListener("change", () => {
      const on = cb.checked;
      localStorage.setItem(TRACK_KEY, on ? "1" : "0");
      if (on) {
        const editor = paneManager.getActiveEditor?.();
        if (editor) {
          const snap = paragraphsFromDoc(editor.state.doc);
          localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
          const status = document.getElementById("status");
          if (status) status.textContent = `מעקב שינויים הופעל. תמונת מצב נשמרה (${snap.length} פסקאות).`;
        }
      } else {
        localStorage.removeItem(SNAPSHOT_KEY);
        clearDiffHighlights();
      }
    });
  }
  showBtn?.addEventListener("click", () => {
    showDiff(paneManager);
  });
}

function clearDiffHighlights() {
  document.querySelectorAll(".ravtext-diff-added, .ravtext-diff-removed, .ravtext-diff-changed")
    .forEach((el) => {
      el.classList.remove("ravtext-diff-added", "ravtext-diff-removed", "ravtext-diff-changed");
    });
  document.querySelectorAll(".ravtext-diff-removed-pseudo").forEach((el) => el.remove());
}

function showDiff(paneManager) {
  const editor = paneManager.getActiveEditor?.();
  if (!editor) return;
  const snapRaw = localStorage.getItem(SNAPSHOT_KEY);
  if (!snapRaw) {
    alert("אין תמונת מצב לשוות אליה. הפעל מעקב שינויים תחילה.");
    return;
  }
  const before = JSON.parse(snapRaw);
  const after = paragraphsFromDoc(editor.state.doc);

  clearDiffHighlights();

  const dom = editor.view.dom;
  const blocks = Array.from(dom.querySelectorAll("p, h1, h2, h3, h4, h5, h6"));
  const len = Math.max(before.length, after.length);
  let added = 0, removed = 0, changed = 0;
  for (let i = 0; i < len; i++) {
    const b = before[i];
    const a = after[i];
    const block = blocks[i];
    if (b == null && a != null) {
      if (block) block.classList.add("ravtext-diff-added");
      added++;
    } else if (b != null && a == null) {
      removed++;
    } else if (b !== a) {
      if (block) block.classList.add("ravtext-diff-changed");
      changed++;
    }
  }
  const status = document.getElementById("status");
  if (status) {
    status.textContent = `שינויים: +${added} -${removed} ~${changed}.`;
  }
}
