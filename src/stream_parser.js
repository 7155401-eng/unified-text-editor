// stream_parser.js — thin client only — האלגוריתמים העיקריים עוברים לשרת (worker/stream_parser.js).
// הסריקה מחזירה גם נתוני כותרות כדי שסורק המסמך הכללי יראה אותן יחד עם זרמי ההערות.

const ENDPOINT = "/api/streams/parse";
const HEBREW_MARKS_RX = /[\u0591-\u05C7]/g;
let lastHeadingNoticeKey = "";

function stripHebrewMarks(text) {
  return String(text || "").normalize("NFD").replace(HEBREW_MARKS_RX, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textFromHtmlTag(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addSample(samples, text) {
  const sample = String(text || "").replace(/\s+/g, " ").trim();
  if (sample && samples.length < 5 && !samples.includes(sample)) samples.push(sample);
}

function scanHeadings(text) {
  const raw = String(text || "");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let h1 = 0;
  let h2 = 0;
  const samples = [];

  for (const match of raw.matchAll(/<h([12])\b[^>]*>[\s\S]*?<\/h\1>/gi)) {
    const level = match[1] === "2" ? 2 : 1;
    if (level === 1) h1 += 1;
    else h2 += 1;
    addSample(samples, textFromHtmlTag(match[0]));
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^<h[12]\b/i.test(trimmed)) continue;

    if (/^##\s+\S/.test(trimmed)) {
      h2 += 1;
      addSample(samples, trimmed.replace(/^##\s+/, ""));
      continue;
    }

    if (/^#\s+\S/.test(trimmed)) {
      h1 += 1;
      addSample(samples, trimmed.replace(/^#\s+/, ""));
      continue;
    }

    const normalized = stripHebrewMarks(trimmed).trim();

    if (/^(?:פרק|שער|פרשה)\s+\S/u.test(normalized)) {
      h1 += 1;
      addSample(samples, trimmed);
      continue;
    }

    if (/^(?:סימן|משנה|הלכה|סעיף)\s+\S/u.test(normalized)) {
      h2 += 1;
      addSample(samples, trimmed);
    }
  }

  return { h1, h2, total: h1 + h2, samples };
}

function ensureHeadingNoticeStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("ravtext-heading-scan-card-style")) return;

  const style = document.createElement("style");
  style.id = "ravtext-heading-scan-card-style";
  style.textContent = `
    .ravtext-heading-scan-card {
      direction: rtl;
      margin: 12px 0;
      padding: 14px;
      border-radius: 20px;
      background:
        radial-gradient(circle at 12% 8%, rgba(250,204,21,.28), transparent 32%),
        linear-gradient(135deg, rgba(15,23,42,.96), rgba(67,56,202,.94), rgba(126,34,206,.92));
      color: #fff;
      box-shadow: 0 18px 45px rgba(15, 23, 42, .28);
      border: 1px solid rgba(255,255,255,.22);
      font-family: inherit;
      position: relative;
      overflow: hidden;
    }
    .ravtext-heading-scan-card.ravtext-heading-scan-card-floating {
      position: fixed;
      z-index: 2147483000;
      top: 18px;
      left: 18px;
      width: min(420px, calc(100vw - 36px));
    }
    .ravtext-heading-scan-card::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.12), transparent);
      transform: rotate(18deg);
      pointer-events: none;
    }
    .ravtext-heading-scan-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      position: relative;
      z-index: 1;
    }
    .ravtext-heading-scan-card-title {
      font-weight: 900;
      font-size: 15px;
      letter-spacing: .01em;
    }
    .ravtext-heading-scan-card-subtitle {
      margin-top: 3px;
      font-size: 12px;
      opacity: .86;
    }
    .ravtext-heading-scan-card-close {
      border: 0;
      color: #fff;
      background: rgba(255,255,255,.14);
      border-radius: 999px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    .ravtext-heading-scan-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 12px 0;
      position: relative;
      z-index: 1;
    }
    .ravtext-heading-scan-metric {
      padding: 9px 8px;
      border-radius: 15px;
      background: rgba(255,255,255,.13);
      border: 1px solid rgba(255,255,255,.18);
      text-align: center;
      backdrop-filter: blur(8px);
    }
    .ravtext-heading-scan-metric strong {
      display: block;
      font-size: 20px;
      line-height: 1.05;
    }
    .ravtext-heading-scan-metric span {
      font-size: 11px;
      opacity: .82;
    }
    .ravtext-heading-scan-samples {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      position: relative;
      z-index: 1;
      max-height: 118px;
      overflow: auto;
    }
    .ravtext-heading-scan-samples li {
      padding: 6px 9px;
      margin-top: 5px;
      border-radius: 12px;
      background: rgba(255,255,255,.10);
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ravtext-heading-scan-actions {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      margin-top: 12px;
      position: relative;
      z-index: 1;
    }
    .ravtext-heading-scan-hint {
      font-size: 12px;
      opacity: .88;
    }
    .ravtext-heading-scan-open {
      border: 0;
      border-radius: 999px;
      padding: 8px 13px;
      font-weight: 800;
      cursor: pointer;
      background: linear-gradient(90deg, #22d3ee, #a78bfa, #facc15);
      color: #111827;
      box-shadow: 0 8px 20px rgba(250,204,21,.28);
      white-space: nowrap;
    }
    .ravtext-heading-scan-open:disabled {
      opacity: .55;
      cursor: default;
      box-shadow: none;
    }
  `;
  document.head.appendChild(style);
}

function renderHeadingNotice(headings) {
  if (typeof document === "undefined" || !headings?.total) return;

  ensureHeadingNoticeStyles();

  const existing = document.getElementById("ravtext-heading-scan-card");
  if (existing) existing.remove();

  const card = document.createElement("section");
  card.id = "ravtext-heading-scan-card";
  card.className = "ravtext-heading-scan-card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const chapterButtonExists = !!document.getElementById("chapter-splitter-btn");
  const samplesHtml = headings.samples?.length
    ? `<ul class="ravtext-heading-scan-samples">${headings.samples
        .map((sample) => `<li title="${escapeHtml(sample)}">${escapeHtml(sample)}</li>`)
        .join("")}</ul>`
    : "";

  card.innerHTML = `
    <div class="ravtext-heading-scan-card-head">
      <div>
        <div class="ravtext-heading-scan-card-title">זוהו כותרות במסמך</div>
        <div class="ravtext-heading-scan-card-subtitle">אפשר לחלק את הספר לפרקים לפי הכותרות שנמצאו.</div>
      </div>
      <button type="button" class="ravtext-heading-scan-card-close" aria-label="סגור">×</button>
    </div>

    <div class="ravtext-heading-scan-metrics">
      <div class="ravtext-heading-scan-metric"><strong>${headings.total}</strong><span>כותרות</span></div>
      <div class="ravtext-heading-scan-metric"><strong>${headings.h1}</strong><span>H1 / ראשי</span></div>
      <div class="ravtext-heading-scan-metric"><strong>${headings.h2}</strong><span>H2 / משני</span></div>
    </div>

    ${samplesHtml}

    <div class="ravtext-heading-scan-actions">
      <span class="ravtext-heading-scan-hint">הסריקה מצאה מבנה פרקים בנוסף לזרמי ההערות.</span>
      <button type="button" class="ravtext-heading-scan-open" ${chapterButtonExists ? "" : "disabled"}>
        פתח ייבוא ספר
      </button>
    </div>
  `;

  card.querySelector(".ravtext-heading-scan-card-close")?.addEventListener("click", () => card.remove());
  card.querySelector(".ravtext-heading-scan-open")?.addEventListener("click", () => {
    document.getElementById("chapter-splitter-btn")?.click();
  });

  const status = document.getElementById("status");
  const scanPanel =
    document.querySelector("[data-document-scan-panel]") ||
    document.querySelector(".document-scan-panel") ||
    document.querySelector(".stream-scan-panel") ||
    document.querySelector(".scan-results") ||
    null;

  if (scanPanel) {
    scanPanel.appendChild(card);
  } else if (status?.parentElement) {
    status.parentElement.insertBefore(card, status.nextSibling);
  } else {
    card.classList.add("ravtext-heading-scan-card-floating");
    document.body.appendChild(card);
  }
}

function clearHeadingNotice() {
  if (typeof document === "undefined") return;
  document.getElementById("ravtext-heading-scan-card")?.remove();
}

function notifyHeadingScan(headings) {
  if (!headings?.total) {
    clearHeadingNotice();
    return;
  }

  const key = `${headings.h1}|${headings.h2}|${headings.samples.join("|")}`;
  if (key === lastHeadingNoticeKey) return;
  lastHeadingNoticeKey = key;

  const detail = { ...headings };

  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("ravtext:document-headings-scanned", { detail }));
    } catch (_) {}
  }

  if (typeof document !== "undefined") {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = `זוהו ${headings.total} כותרות במסמך — H1: ${headings.h1}, H2: ${headings.h2}.`;
    }
    renderHeadingNotice(headings);
  }
}

async function callServer(text) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: String(text || "") }),
  });

  if (!res.ok) {
    throw new Error(`Stream parse failed: HTTP ${res.status}`);
  }

  return res.json();
}

function attachHeadingStats(result, text) {
  const headings = scanHeadings(text);
  const out = result && typeof result === "object" ? result : {};
  out.stats = out.stats && typeof out.stats === "object" ? out.stats : { total: 0, byStream: {} };
  out.stats.headings = headings;
  notifyHeadingScan(headings);
  return out;
}

export async function parseRawTextToHTML(text) {
  const result = await callServer(text);
  return attachHeadingStats(result, text);
}

export async function scanRawText(text) {
  const result = await callServer(text);
  return attachHeadingStats(result, text).stats;
}
