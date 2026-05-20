// Lightweight static probe for the real Word extractor modal.
// No DOCX reading, no file listeners, no JSZip, no import interception.

const PROBE_ID = "we-static-connection-probe";

function getModal() {
  return typeof document !== "undefined"
    ? document.getElementById("word-extractor-modal")
    : null;
}

function ensureStaticProbe() {
  const modal = getModal();
  if (!modal || !modal.classList.contains("active")) return;

  let probe = document.getElementById(PROBE_ID);
  if (!probe) {
    probe = document.createElement("section");
    probe.id = PROBE_ID;
    probe.dir = "rtl";
    probe.style.cssText = [
      "margin:12px 0",
      "padding:10px 12px",
      "border:1px solid #7c3aed",
      "border-radius:10px",
      "background:#faf5ff",
      "color:#312e81",
      "font-weight:700",
      "box-sizing:border-box"
    ].join(";");

    probe.textContent = "בדיקת חיבור: הקוד הזה הוזרק לתוך מסך ייבוא Word עם זרמים מלאים";

    const streamsWrap = modal.querySelector(".we-streams-wrap");
    const meta = modal.querySelector(".we-meta");

    if (streamsWrap?.parentElement) {
      streamsWrap.parentElement.insertBefore(probe, streamsWrap);
    } else if (meta?.parentElement) {
      meta.parentElement.insertBefore(probe, meta.nextSibling);
    } else {
      modal.querySelector(".we-modal")?.appendChild(probe) || modal.appendChild(probe);
    }
  }
}

export function wireChapterSplitter(paneManager) {
  void paneManager;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const run = () => ensureStaticProbe();

  [0, 100, 300, 800, 1500].forEach((ms) => setTimeout(run, ms));

  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });

  window.ravtextRefreshWordDocumentDiagnostics = run;
  window.ravtextRefreshWordHeadingMap = run;
}
