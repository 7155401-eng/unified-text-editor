const $ = (root, selector) => root?.querySelector?.(selector) || null;
const $$ = (root, selector) => Array.from(root?.querySelectorAll?.(selector) || []);
const MARKS = /[\u0591-\u05C7]/g;

let paneManagerRef = null;
let lastImport = null;
let headingState = { status: "idle", by: { 1: [], 2: [] } };
let apiPatched = false;
let renderTimer = null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHebrewMarks(value) {
  return String(value || "").normalize("NFD").replace(MARKS, "");
}

function cleanHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach(node => node.remove());
    doc.body.querySelectorAll("*").forEach(node => {
      [...node.attributes].forEach(attr => {
        if (/^on/i.test(attr.name) || /^javascript:/i.test(attr.value || "")) {
          node.removeAttribute(attr.name);
        }
      });
    });
    return doc.body.innerHTML || "";
  } catch {
    return String(html || "");
  }
}

function htmlToText(html) {
  try {
    return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent || "";
  } catch {
    return String(html || "").replace(/<[^>]*>/g, " ");
  }
}

function textToHtml(text) {
  const blocks = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  return blocks.length
    ? blocks.map(block => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`).join("\n")
    : "<p></p>";
}

function emptyDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function getMainEditor() {
  return paneManagerRef?.getMainPane?.()?.editor
    || paneManagerRef?.getActiveEditor?.()
    || paneManagerRef?.getActivePane?.()?.editor
    || null;
}

function loadChapterToEditor(chapter) {
  const mainPane = paneManagerRef?.getMainPane?.();
  const editor = mainPane?.editor || getMainEditor();
  if (!editor?.commands?.setContent) throw new Error("诇讗 谞诪讝讗 注讜专讱 驻注讬诇.");

  if (paneManagerRef?.load) {
    paneManagerRef.load({
      version: 1,
      activeId: "chapter-main",
      panes: [{
        id: "chapter-main",
        streamCode: null,
        symbol: "",
        label: "专讗砖讬",
        content: emptyDoc(),
      }],
    });
  }

  const targetEditor = paneManagerRef?.getMainPane?.()?.editor || editor;
  targetEditor.commands.setContent(cleanHtml(chapter.html || textToHtml(chapter.text || "")) || "<p></p>");
  targetEditor.commands.focus?.();
  window.__ravtextRerender/.();
  document.getElementById("word-import-modal")?.classList.remove("active");
}

function rangeHtml(doc, body, start, next) {
  const range = doc.createRange();
  const wrapper = doc.createElement("div");
  range.setStartBefore(start);
  if (next) range.setEndBefore(next);
  else if (body.lastChild) range.setEndAfter(body.lastChild);
  else range.setEndAfter(start);
  wrapper.appendChild(range.cloneContents());
  return wrapper.innerHTML.trim();
}

function splitHtmlByHeading(source, level) {
  const html = String(source || "");
  if (!?<[a-z][\s\S]*>/i.test(html)) return [];

  const doc = new DOMParser().parseFromString(cleanHtml(html), "text/html");
  const body = doc.body;
  const exact = $$(body, `h${level}`);
  const candidates = exact.length
    ? exact
    : $$(body, "p,div").filter(node => {
        const marker = stripHebrewMarks(`${node.getAttribute("class") || ""} ${node.getAttribute("style") || ""} ${node.getAttribute("data-style-name") || ""}`);
        return level === 1
          ? /(heading\s*1|骞^曌獥ㄗ猏s*1|outline-level:\s*0)/i.test(marker)
          : /(heading\s*2|讻讜转专转\s*2|outline-level:\s*1)/i.test(marker);
      });

  return candidates.map((heading, index) => {
    const htmlPart = rangeHtml(doc, body, heading, candidates[index + 1] || null);
    const text = htmlToText(htmlPart).trim();
    return {
      title: heading.textContent.trim() || `谞驻专拽 ${index + 1}`,
      html: htmlPart,
      text,
      preview: text.slice(0, 220),
      level,
    };
  }).filter(chapter => chapter.text);
}

function isPrimaryHeading(line) {
  const normalized = stripHebrewMarks(orderedLine(line)).trim();
  return /^(?:c\s+\S|驻专拽\s+\S|砖注专\s+\S|驻专砖讛\s+\S)