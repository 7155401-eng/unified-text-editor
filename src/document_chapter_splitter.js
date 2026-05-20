const MODAL_ID = "word-extractor-modal";
const CARD_ID = "we-doc-diagnostics";

let wired = false;
let lastFile = null;
let lastStats = null;
let scanToken = 0;

const $ = (root, selector) => root?.querySelector?.(selector) || null;
const $$ = (root, selector) => Array.from(root?.querySelectorAll?.(selector) || []);
const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function getModal() {
  return document.getElementById(MODAL_ID);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("he-IL");
}

function ensureCard() {
  const modal = getModal();
  if (!modal) return null;

  let card = document.getElementById(CARD_ID);
  if (!card) {
    card = document.createElement("section");
    card.id = CARD_ID;
    card.dir = "rtl";
    card.style.cssText = [
      "margin:12px 0",
      "padding:12px 14px",
      "border:1px solid #c7d2fe",
      "border-radius:10px",
      "background:#f8fbff",
      "color:#111827",
      "box-sizing:border-box"
    ].join(";");

    const streamsWrap = $(".we-streams-wrap", modal);
    const meta = $(".we-meta", modal);
    if (streamsWrap?.parentElement) streamsWrap.parentElement.insertBefore(card, streamsWrap);
    else if (meta?.parentElement) meta.parentElement.insertBefore(card, meta.nextSibling);
    else $(".modal, .we-modal", modal)?.appendChild(card) || modal.appendChild(card);
  }
  return card;
}

function renderCard(status = "idle", message = "") {
  const card = ensureCard();
  if (!card) return;

  const stats = lastStats;
  const headingCounts = stats?.headingCounts || {};
  const headingRows = [1, 2, 3, 4, 5, 6].map(level => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center">
      <b style="display:block;font-size:18px">${formatNumber(headingCounts[level] || 0)}</b>
      <span>H${level}</span>
    </div>
  `).join("");

  let body = "";
  if (status === "loading") {
    body = `<div style="padding:8px 0;color:#475569">סופר תווים, מילים וכותרות במסמך...</div>`;
  } else if (status === "error") {
    body = `<div style="padding:8px 0;color:#b91c1c">לא הצלחתי לחשב אבחון למסמך: ${esc(message)}</div>`;
  } else if (stats) {
    body = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0">
        <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:8px;text-align:center">
          <b style="display:block;font-size:19px">${formatNumber(stats.characters)}</b>
          <span>תווים כולל רווחים</span>
        </div>
        <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:8px;text-align:center">
          <b style="display:block;font-size:19px">${formatNumber(stats.words)}</b>
          <span>מילים</span>
        </div>
        <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:8px;text-align:center">
          <b style="display:block;font-size:19px">${formatNumber(stats.totalHeadings)}</b>
          <span>כותרות בסך הכול</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">${headingRows}</div>
    `;
  } else {
    body = `<div style="padding:8px 0;color:#475569">בחר קובץ DOCX כדי לראות אבחון בסיסי של המסמך.</div>`;
  }

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
      <div>
        <b style="color:#1d4ed8">אבחון מסמך — בדיקת חיבור למסך הייבוא</b>
        <div style="font-size:12px;color:#64748b">מופיע מתוך אותו חלון ייבוא Word, מיד אחרי העלאת הקובץ.</div>
      </div>
      <button type="button" id="we-doc-diagnostics-refresh"
        style="border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:6px 10px;cursor:pointer;font-weight:700">
        רענן
      </button>
    </div>
    ${body}
  `;

  const refresh = document.getElementById("we-doc-diagnostics-refresh");
  if (refresh) refresh.onclick = () => {
    if (lastFile) analyzeFile(lastFile);
    else renderCard("idle");
  };
}

function xmlChildren(node, localName) {
  if (!node) return [];
  const byNs = Array.from(node.getElementsByTagNameNS?.("*", localName) || []);
  if (byNs.length) return byNs;
  return Array.from(node.getElementsByTagName?.(`w:${localName}`) || []);
}

function firstXmlChild(node, localName) {
  return xmlChildren(node, localName)[0] || null;
}

function attr(node, name) {
  if (!node) return "";
  return node.getAttribute(`w:${name}`)
    || node.getAttribute(name)
    || node.getAttributeNS?.("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name)
    || "";
}

function paragraphText(p) {
  return xmlChildren(p, "t").map(t => t.textContent || "").join("");
}

function normalizeStyleName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0591-\u05C7]/g, "")
    .trim()
    .toLowerCase();
}

function parseStyles(stylesXml) {
  const styles = {};
  if (!stylesXml) return styles;

  const doc = new DOMParser().parseFromString(stylesXml, "application/xml");
  for (const style of xmlChildren(doc, "style")) {
    const id = attr(style, "styleId");
    if (!id) continue;
    const nameNode = firstXmlChild(style, "name");
    const outlineNode = firstXmlChild(style, "outlineLvl");
    styles[id] = {
      name: attr(nameNode, "val"),
      outline: attr(outlineNode, "val"),
    };
  }
  return styles;
}

function headingLevelFromStyle(styleId, styles, inlineOutline) {
  if (inlineOutline !== "" && inlineOutline != null) {
    const n = Number(inlineOutline);
    if (Number.isFinite(n) && n >= 0 && n <= 5) return n + 1;
  }

  const style = styles[String(styleId || "")] || {};
  if (style.outline !== "" && style.outline != null) {
    const n = Number(style.outline);
    if (Number.isFinite(n) && n >= 0 && n <= 5) return n + 1;
  }

  const id = normalizeStyleName(styleId);
  const name = normalizeStyleName(style.name);
  const marker = `${id} ${name}`;

  for (let i = 1; i <= 6; i++) {
    if (
      id === String(i)
      || id === `heading${i}`
      || id === `heading ${i}`
      || /(^|[^0-9])heading\s*/.test(marker) && new RegExp(`heading\\s*${i}`).test(marker)
      || new RegExp(`כותרת\\s*${i}`).test(marker)
      || new RegExp(`heading${i}`).test(marker)
    ) {
      return i;
    }
  }

  return 0;
}

function countWords(text) {
  const src = String(text || "").trim();
  if (!src) return 0;
  try {
    return (src.match(/[\p{L}\p{N}]+(?:[׳'"״־-][\p{L}\p{N}]+)*/gu) || []).length;
  } catch {
    return src.split(/\s+/).filter(Boolean).length;
  }
}

async function loadZipLib() {
  if (window.JSZip) return window.JSZip;
  const mod = await import("jszip");
  return mod.default || mod;
}

async function analyzeFile(file) {
  if (!file) return;
  lastFile = file;
  const token = ++scanToken;
  renderCard("loading");

  try {
    const JSZip = await loadZipLib();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("text");
    if (!documentXml) throw new Error("לא נמצא word/document.xml בתוך הקובץ.");

    const stylesXml = await zip.file("word/styles.xml")?.async("text");
    const styles = parseStyles(stylesXml || "");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const paragraphs = xmlChildren(doc, "p");

    const texts = [];
    const headingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    for (const p of paragraphs) {
      const text = paragraphText(p);
      texts.push(text);

      const pPr = firstXmlChild(p, "pPr");
      const pStyle = firstXmlChild(pPr, "pStyle");
      const outline = firstXmlChild(pPr, "outlineLvl");
      const level = headingLevelFromStyle(attr(pStyle, "val"), styles, attr(outline, "val"));
      if (level >= 1 && level <= 6) headingCounts[level] += 1;
    }

    const fullText = texts.join("\n");
    const totalHeadings = Object.values(headingCounts).reduce((sum, n) => sum + n, 0);

    if (token !== scanToken) return;
    lastStats = {
      characters: fullText.length,
      words: countWords(fullText),
      headingCounts,
      totalHeadings,
    };
    renderCard("ready");
  } catch (err) {
    if (token !== scanToken) return;
    lastStats = null;
    renderCard("error", err?.message || String(err));
  }
}

function onFileInputChange(event) {
  const input = event.target?.closest?.(`#${MODAL_ID} .we-file-input`);
  if (!input) return;
  const file = input.files?.[0];
  if (file) analyzeFile(file);
}

function onModalMutation() {
  const modal = getModal();
  if (!modal?.classList.contains("active")) return;
  renderCard(lastStats ? "ready" : "idle");
}

export function wireChapterSplitter(paneManager) {
  void paneManager;
  if (typeof document === "undefined" || wired) return;
  wired = true;

  document.addEventListener("change", onFileInputChange, true);

  const run = () => onModalMutation();
  [0, 250, 750, 1500, 3000].forEach(ms => setTimeout(run, ms));

  new MutationObserver(run).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });

  window.ravtextRefreshWordDocumentDiagnostics = () => {
    if (lastFile) analyzeFile(lastFile);
    else renderCard("idle");
  };
}
