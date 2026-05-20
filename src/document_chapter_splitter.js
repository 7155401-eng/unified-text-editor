// Lightweight live probe for the real Word extractor modal.
// Shows a static connection card and, after DOCX selection, counts document characters once.
// It does not touch the Import button and does not change stream mapping.

const PROBE_ID = "we-static-connection-probe";
const MODAL_ID = "word-extractor-modal";

let wired = false;
let currentToken = 0;
let lastFile = null;

function getModal() {
  return typeof document !== "undefined" ? document.getElementById(MODAL_ID) : null;
}

function fmt(value) {
  return Number(value || 0).toLocaleString("he-IL");
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function frame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function ensureCard() {
  const modal = getModal();
  if (!modal || !modal.classList.contains("active")) return null;

  let card = document.getElementById(PROBE_ID);
  if (!card) {
    card = document.createElement("section");
    card.id = PROBE_ID;
    card.dir = "rtl";
    card.style.cssText = [
      "margin:12px 0",
      "padding:10px 12px",
      "border:1px solid #7c3aed",
      "border-radius:10px",
      "background:#faf5ff",
      "color:#312e81",
      "font-weight:700",
      "box-sizing:border-box"
    ].join(";");

    const streamsWrap = modal.querySelector(".we-streams-wrap");
    const meta = modal.querySelector(".we-meta");

    if (streamsWrap?.parentElement) {
      streamsWrap.parentElement.insertBefore(card, streamsWrap);
    } else if (meta?.parentElement) {
      meta.parentElement.insertBefore(card, meta.nextSibling);
    } else {
      modal.querySelector(".we-modal")?.appendChild(card) || modal.appendChild(card);
    }
  }

  return card;
}

function render(message) {
  const card = ensureCard();
  if (card) card.textContent = message;
}

function getXmlChildren(node, localName) {
  if (!node) return [];
  const byNs = Array.from(node.getElementsByTagNameNS?.("*", localName) || []);
  if (byNs.length) return byNs;
  return Array.from(node.getElementsByTagName?.(`w:${localName}`) || []);
}

function paragraphText(paragraph) {
  return getXmlChildren(paragraph, "t").map(t => t.textContent || "").join("");
}

function countWords(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return 0;
  try {
    return (trimmed.match(/[\p{L}\p{N}]+(?:['׳״־-][\p{L}\p{N}]+)*/gu) || []).length;
  } catch {
    return trimmed.split(/\s+/).filter(Boolean).length;
  }
}

async function waitForNativeScanToFinish(token) {
  const started = Date.now();
  while (token === currentToken && Date.now() - started < 15000) {
    const modal = getModal();
    const meta = modal?.querySelector(".we-meta");
    const streams = modal?.querySelector(".we-streams-wrap");
    const status = modal?.querySelector(".we-status");
    const hasResult = (meta && meta.hidden === false) || (streams && streams.hidden === false);
    const isScanning = status && status.hidden === false && /סורק|Scanning|scanner|scan/i.test(status.textContent || "");
    if (hasResult && !isScanning) return;
    await wait(300);
  }
}

async function analyzeCharacters(file, token) {
  if (!file || token !== currentToken) return;

  render("בדיקת חיבור: הקובץ נקלט. ממתין לסיום הסריקה הרגילה של מסך הייבוא…");

  await waitForNativeScanToFinish(token);
  await frame();
  await wait(150);

  if (token !== currentToken) return;

  render("בדיקת חיבור: סופר עכשיו תווים מתוך המסמך…");

  try {
    const JSZipModule = await import("jszip");
    const JSZip = JSZipModule.default || JSZipModule;
    await frame();

    const buffer = await file.arrayBuffer();
    if (token !== currentToken) return;
    await frame();

    const zip = await JSZip.loadAsync(buffer);
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) throw new Error("לא נמצא word/document.xml בתוך הקובץ.");

    const documentXml = await documentFile.async("text");
    if (token !== currentToken) return;
    await frame();

    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const paragraphs = getXmlChildren(doc, "p");
    const text = paragraphs.length
      ? paragraphs.map(paragraphText).join("\n")
      : getXmlChildren(doc, "t").map(t => t.textContent || "").join("");

    render(`בדיקת חיבור: במסמך יש ${fmt(text.length)} תווים כולל רווחים ושבירות שורה. מילים: ${fmt(countWords(text))}.`);
  } catch (err) {
    render(`בדיקת חיבור: לא הצלחתי לספור תווים במסמך — ${err?.message || String(err)}`);
  }
}

function onFileChange(event) {
  const input = event.target?.closest?.(`#${MODAL_ID} .we-file-input`);
  if (!input) return;

  const file = input.files?.[0];
  if (!file) return;

  lastFile = file;
  const token = ++currentToken;
  render("בדיקת חיבור: הקובץ נקלט. ספירת התווים תתחיל אחרי הסריקה הרגילה…");

  setTimeout(() => analyzeCharacters(file, token), 800);
}

export function wireChapterSplitter(paneManager) {
  void paneManager;
  if (typeof window === "undefined" || typeof document === "undefined" || wired) return;
  wired = true;

  const run = () => {
    ensureCard();
  };

  document.addEventListener("change", onFileChange, false);

  [0, 100, 300, 800, 1500].forEach(ms => setTimeout(run, ms));

  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });

  window.ravtextRefreshWordDocumentDiagnostics = () => {
    if (lastFile) analyzeCharacters(lastFile, ++currentToken);
    else render("בדיקת חיבור: עדיין לא נבחר קובץ DOCX.");
  };
  window.ravtextRefreshWordHeadingMap = window.ravtextRefreshWordDocumentDiagnostics;
}
