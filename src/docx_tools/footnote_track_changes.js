const ENDPOINT = "/api/word-footnote-track-changes";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function outputName(name, action) {
  const raw = String(name || "document.docx");
  const suffix = action === "reject"
    ? "_שינויי_הערות_נדחו.docx"
    : "_שינויי_הערות_התקבלו.docx";
  return /\.docx$/i.test(raw) ? raw.replace(/\.docx$/i, suffix) : raw + suffix;
}

function decodeHeaderValue(value, fallback = "") {
  if (!value) return fallback;
  try { return decodeURIComponent(value); } catch (_) { return value || fallback; }
}

export async function transformFootnoteTrackedChanges(input, {
  filename = "",
  action = "accept",
} = {}) {
  const normalizedAction = String(action || "").toLowerCase();
  if (!["accept", "reject"].includes(normalizedAction)) {
    throw new Error("יש לבחור accept או reject.");
  }

  const sourceName = filename || input?.name || "document.docx";
  const body = input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": DOCX_TYPE,
      "x-file-name": encodeURIComponent(sourceName),
      "x-footnote-track-action": normalizedAction,
    },
    body,
  });

  if (!response.ok) {
    let data = null;
    try { data = await response.json(); } catch (_) {}
    const error = new Error(data?.error || data?.message || `HTTP ${response.status}`);
    error.code = data?.code || "DOCX_FOOTNOTE_TRACK_CHANGES_FAILED";
    error.status = response.status;
    error.details = data;
    throw error;
  }

  const bytes = await response.arrayBuffer();
  const blob = new Blob([bytes], { type: DOCX_TYPE });
  const outName = decodeHeaderValue(
    response.headers.get("x-docx-filename"),
    outputName(sourceName, normalizedAction)
  );

  let report = {};
  const encodedReport = response.headers.get("x-docx-report");
  if (encodedReport) {
    try { report = JSON.parse(decodeURIComponent(encodedReport)); } catch (_) {}
  }

  return { blob, filename: outName, report };
}

export function downloadFootnoteRevisionDocx(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "document.docx";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { a.remove(); } catch (_) {}
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, 300);
}

function reportLine(report, action) {
  if (action === "accept") {
    return [
      `תוספות שהתקבלו: ${report.insertionsAccepted ?? 0}`,
      `מחיקות שהתקבלו: ${report.deletionsAccepted ?? 0}`,
      `שינויי עיצוב שהתקבלו: ${report.propertyChangesAccepted ?? 0}`,
    ].join("\n");
  }
  return [
    `תוספות שנדחו: ${report.insertionsRejected ?? 0}`,
    `מחיקות שנדחו: ${report.deletionsRejected ?? 0}`,
    `שינויי עיצוב שנדחו: ${report.propertyChangesRejected ?? 0}`,
  ].join("\n");
}

function runAction(action, button) {
  const verb = action === "accept" ? "לקבל" : "לדחות";
  const adjective = action === "accept" ? "התקבלו" : "נדחו";

  const ok = window.confirm(
    `הפעולה ת${verb === "לקבל" ? "קבל" : "דחה"} שינויי מעקב בתוך הערות השוליים בלבד.\n\n` +
    "שינויים בגוף המסמך לא יטופלו ולא יימחקו.\n" +
    "יישמר קובץ חדש; הקובץ המקורי לא ישתנה.\n\n" +
    "להמשיך?"
  );
  if (!ok) return;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".docx," + DOCX_TYPE;
  input.style.display = "none";
  document.body.appendChild(input);

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = action === "accept" ? "מקבל…" : "דוחה…";

    try {
      const result = await transformFootnoteTrackedChanges(file, { action });
      downloadFootnoteRevisionDocx(result.blob, result.filename);
      alert(
        `שינויי ההערות ${adjective} בהצלחה.\n\n` +
        reportLine(result.report || {}, action) + "\n" +
        `שינויי גוף שנשארו ללא נגיעה: ${result.report?.bodyRevisionNodesUntouched ?? 0}\n\n` +
        `נשמר: ${result.filename}`
      );
    } catch (error) {
      alert(`הפעולה לא בוצעה.\n\n${error?.message || error}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }, { once: true });

  input.addEventListener("cancel", () => input.remove(), { once: true });
  input.click();
}

export function wireFootnoteTrackChangesTool() {
  if (document.getElementById("footnote-changes-accept-btn")) return;
  const toolbar = document.querySelector(".review-toolbar");
  if (!toolbar) return;

  const group = document.createElement("span");
  group.className = "tb-group";
  group.dataset.title = "שינויי Word בהערות";

  const acceptBtn = document.createElement("button");
  acceptBtn.id = "footnote-changes-accept-btn";
  acceptBtn.type = "button";
  acceptBtn.textContent = "✓ קבל שינויי הערות";
  acceptBtn.title = "קבלת שינויי Track Changes בתוך הערות השוליים בלבד";

  const rejectBtn = document.createElement("button");
  rejectBtn.id = "footnote-changes-reject-btn";
  rejectBtn.type = "button";
  rejectBtn.textContent = "✗ דחה שינויי הערות";
  rejectBtn.title = "דחיית שינויי Track Changes בתוך הערות השוליים בלבד";

  acceptBtn.addEventListener("click", () => runAction("accept", acceptBtn));
  rejectBtn.addEventListener("click", () => runAction("reject", rejectBtn));

  group.append(acceptBtn, rejectBtn);
  toolbar.appendChild(group);
}
