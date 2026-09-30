const ENDPOINT = "/api/word-footnotes-to-curly";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function outputName(name) {
  const raw = String(name || "document.docx");
  return /\.docx$/i.test(raw)
    ? raw.replace(/\.docx$/i, "_מסולסלות.docx")
    : raw + "_מסולסלות.docx";
}

function decodeHeaderValue(value, fallback = "") {
  if (!value) return fallback;
  try { return decodeURIComponent(value); } catch (_) { return value || fallback; }
}

export async function transformFootnotesToCurly(input, { filename = "" } = {}) {
  const sourceName = filename || input?.name || "document.docx";
  const body = input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": DOCX_TYPE,
      "x-file-name": encodeURIComponent(sourceName),
    },
    body,
  });

  if (!response.ok) {
    let data = null;
    try { data = await response.json(); } catch (_) {}
    const error = new Error(data?.error || data?.message || `HTTP ${response.status}`);
    error.code = data?.code || "DOCX_TRANSFORM_FAILED";
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

export function downloadTransformedDocx(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "document_מסולסלות.docx";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { a.remove(); } catch (_) {}
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, 300);
}

export function wireFootnotesToCurlyTool() {
  if (document.getElementById("footnotes-to-curly-btn")) return;
  const toolbar = document.querySelector(".review-toolbar");
  if (!toolbar) return;

  const sep = document.createElement("span");
  sep.className = "sep";

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "כלי Word";

  const btn = document.createElement("button");
  btn.id = "footnotes-to-curly-btn";
  btn.type = "button";
  btn.textContent = "הערות → {מסולסלות}";
  btn.title = "המרת הערות שוליים בקובץ Word לסוגריים מסולסלות בתוך הטקסט";

  btn.addEventListener("click", () => {
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
      btn.textContent = "ממיר…";

      try {
        const result = await transformFootnotesToCurly(file);
        downloadTransformedDocx(result.blob, result.filename);
        alert(
          `ההמרה הסתיימה בהצלחה.\n\n` +
          `הפניות שהומרו: ${result.report.referencesConverted ?? "—"}\n` +
          `הערות ייחודיות: ${result.report.uniqueFootnotesConverted ?? "—"}\n\n` +
          `נשמר: ${result.filename}`
        );
      } catch (error) {
        alert(`ההמרה לא בוצעה.\n\n${error?.message || error}`);
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    }, { once: true });

    input.addEventListener("cancel", () => input.remove(), { once: true });
    input.click();
  });

  group.appendChild(btn);
  toolbar.append(sep, group);
}
