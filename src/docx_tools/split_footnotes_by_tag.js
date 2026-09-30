const ENDPOINT = "/api/word-split-footnotes-by-tag";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function normalizeTagsInput(value) {
  const tags = String(value || "")
    .split(/[\n,;]+/u)
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

function outputName(name) {
  const raw = String(name || "document.docx");
  return /\.docx$/i.test(raw)
    ? raw.replace(/\.docx$/i, "_מפוצל_לפי_תג.docx")
    : raw + "_מפוצל_לפי_תג.docx";
}

function decodeHeaderValue(value, fallback = "") {
  if (!value) return fallback;
  try { return decodeURIComponent(value); } catch (_) { return value || fallback; }
}

export async function splitFootnotesByTag(input, {
  filename = "",
  tags = [],
} = {}) {
  const sourceName = filename || input?.name || "document.docx";
  const normalizedTags = Array.isArray(tags)
    ? [...new Set(tags.map(x => String(x || "").trim()).filter(Boolean))]
    : normalizeTagsInput(tags);

  if (!normalizedTags.length) {
    const error = new Error("לא הוזן תג לפיצול.");
    error.code = "MISSING_SPLIT_TAGS";
    throw error;
  }

  const body = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": DOCX_TYPE,
      "x-file-name": encodeURIComponent(sourceName),
      "x-footnote-split-tags": encodeURIComponent(JSON.stringify(normalizedTags)),
    },
    body,
  });

  if (!response.ok) {
    let data = null;
    try { data = await response.json(); } catch (_) {}
    const error = new Error(data?.error || data?.message || `HTTP ${response.status}`);
    error.code = data?.code || "DOCX_SPLIT_FAILED";
    error.status = response.status;
    error.details = data;
    throw error;
  }

  const bytes = await response.arrayBuffer();
  const blob = new Blob([bytes], { type: DOCX_TYPE });
  const outName = decodeHeaderValue(
    response.headers.get("x-docx-filename"),
    outputName(sourceName)
  );

  let report = {};
  const encodedReport = response.headers.get("x-docx-report");
  if (encodedReport) {
    try { report = JSON.parse(decodeURIComponent(encodedReport)); } catch (_) {}
  }

  return { blob, filename: outName, report };
}

export function downloadSplitFootnotesDocx(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "document_מפוצל_לפי_תג.docx";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { a.remove(); } catch (_) {}
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, 300);
}

export function wireSplitFootnotesByTagTool() {
  if (document.getElementById("split-footnotes-by-tag-btn")) return;
  const toolbar = document.querySelector(".review-toolbar");
  if (!toolbar) return;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "כלי Word";

  const btn = document.createElement("button");
  btn.id = "split-footnotes-by-tag-btn";
  btn.type = "button";
  btn.textContent = "✂ פצל הערות לפי תג";
  btn.title = "פיצול הערות שוליים ב-Word לכמה הערות לפי תג אחד או כמה תגים";

  btn.addEventListener("click", () => {
    const raw = window.prompt(
      "הזן תג אחד או כמה תגים לפיצול.\n" +
      "אפשר להפריד בפסיק, נקודה-פסיק או שורה חדשה.\n\n" +
      "הפיצול נעשה לפני כל הופעת תג והתג עצמו נשמר.\n" +
      "לדוגמה: @01, @02",
      "@01, @02"
    );
    if (raw == null) return;

    const tags = normalizeTagsInput(raw);
    if (!tags.length) {
      alert("לא הוזן תג לפיצול.");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx," + DOCX_TYPE;
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;

      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "מפצל…";

      try {
        const result = await splitFootnotesByTag(file, { tags });
        downloadSplitFootnotesDocx(result.blob, result.filename);

        const counts = result.report?.matchesByTag || {};
        const tagSummary = tags
          .map(tag => `${tag}: ${counts[tag] ?? 0}`)
          .join("\n");

        alert(
          `הפיצול הסתיים בהצלחה.\n\n` +
          `הערות שפוצלו: ${result.report?.footnotesSplit ?? "—"}\n` +
          `הערות חדשות שנוצרו: ${result.report?.newFootnotesCreated ?? "—"}\n` +
          `הפניות שהורחבו: ${result.report?.referencesExpanded ?? "—"}\n\n` +
          `תגים שנמצאו:\n${tagSummary}\n\n` +
          `נשמר: ${result.filename}`
        );
      } catch (error) {
        alert(`הפיצול לא בוצע.\n\n${error?.message || error}`);
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    }, { once: true });

    input.addEventListener("cancel", () => input.remove(), { once: true });
    input.click();
  });

  group.appendChild(btn);
  toolbar.appendChild(group);
}
