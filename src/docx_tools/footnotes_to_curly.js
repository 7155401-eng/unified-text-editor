import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

const parser = new DOMParser();
const serializer = new XMLSerializer();

function localName(node) {
  return String(node?.localName || node?.nodeName || "").replace(/^.*:/, "");
}

function elements(node) {
  const out = [];
  for (let c = node?.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) out.push(c);
  }
  return out;
}

function wAttr(node, name) {
  return node?.getAttributeNS?.(W_NS, name)
    || node?.getAttribute?.(`w:${name}`)
    || node?.getAttribute?.(name)
    || "";
}

function createW(doc, name) {
  return doc.createElementNS(W_NS, `w:${name}`);
}

function createTextRun(doc, text) {
  const run = createW(doc, "r");
  const t = createW(doc, "t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(String(text ?? "")));
  run.appendChild(t);
  return run;
}

function imported(doc, node) {
  if (!node) return null;
  try {
    if (typeof doc.importNode === "function") return doc.importNode(node, true);
  } catch (_) {}
  return node.cloneNode(true);
}

function runPayloadNodes(sourceRun) {
  const out = [];
  for (const child of elements(sourceRun)) {
    const ln = localName(child);
    if (ln === "rPr" || ln === "footnoteRef" || ln === "footnoteReference") continue;
    if (["t", "delText", "tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(ln)) {
      out.push(child);
    }
  }
  return out;
}

function convertSourceRun(doc, sourceRun) {
  const payload = runPayloadNodes(sourceRun);
  if (!payload.length) return null;

  const run = createW(doc, "r");
  const rPr = elements(sourceRun).find(n => localName(n) === "rPr");
  if (rPr) run.appendChild(imported(doc, rPr));

  for (const item of payload) {
    const ln = localName(item);
    if (ln === "t" || ln === "delText") {
      const t = createW(doc, "t");
      t.setAttribute("xml:space", "preserve");
      t.appendChild(doc.createTextNode(item.textContent || ""));
      run.appendChild(t);
    } else if (ln === "tab") {
      run.appendChild(createW(doc, "tab"));
    } else if (ln === "br" || ln === "cr") {
      run.appendChild(createW(doc, "br"));
    } else if (ln === "noBreakHyphen") {
      const t = createW(doc, "t");
      t.appendChild(doc.createTextNode("‑"));
      run.appendChild(t);
    } else if (ln === "softHyphen") {
      const t = createW(doc, "t");
      t.appendChild(doc.createTextNode("\u00ad"));
      run.appendChild(t);
    }
  }
  return run;
}

function footnoteParagraphs(noteEl) {
  const all = Array.from(noteEl.getElementsByTagNameNS?.(W_NS, "p") || []);
  if (all.length) return all;
  return Array.from(noteEl.getElementsByTagName("w:p") || []);
}

function unsupportedFootnoteContent(noteEl) {
  const forbidden = new Set([
    "drawing", "pict", "object", "altChunk", "tbl", "hyperlink",
    // These carry semantics that cannot be preserved by merely copying visible
    // runs into the main document. Fail closed rather than flattening silently.
    "fldSimple", "instrText", "fldChar", "sym", "sdt", "smartTag", "customXml",
    "ins", "del", "moveFrom", "moveTo",
  ]);
  const stack = [noteEl];
  while (stack.length) {
    const node = stack.pop();
    for (const child of elements(node)) {
      if (forbidden.has(localName(child))) return localName(child);
      stack.push(child);
    }
  }
  return "";
}

function buildFootnoteRuns(doc, noteEl) {
  const runs = [createTextRun(doc, "{")];
  const paragraphs = footnoteParagraphs(noteEl);

  paragraphs.forEach((p, pi) => {
    if (pi > 0) {
      const brRun = createW(doc, "r");
      brRun.appendChild(createW(doc, "br"));
      runs.push(brRun);
    }
    const sourceRuns = Array.from(p.getElementsByTagNameNS?.(W_NS, "r") || []);
    const fallbackRuns = sourceRuns.length ? sourceRuns : Array.from(p.getElementsByTagName("w:r") || []);
    for (const sourceRun of fallbackRuns) {
      const converted = convertSourceRun(doc, sourceRun);
      if (converted) runs.push(converted);
    }
  });

  runs.push(createTextRun(doc, "}"));
  return runs;
}

function directRunAncestor(node) {
  let cur = node?.parentNode || null;
  while (cur) {
    if (cur.nodeType === 1 && localName(cur) === "r") return cur;
    if (cur.nodeType === 1 && localName(cur) === "p") return null;
    cur = cur.parentNode;
  }
  return null;
}

function cloneMainRunSlice(doc, sourceRun, childNodes) {
  const useful = childNodes.filter(n => n?.nodeType === 1 && localName(n) !== "rPr");
  if (!useful.length) return null;
  const out = createW(doc, "r");
  const rPr = elements(sourceRun).find(n => localName(n) === "rPr");
  if (rPr) out.appendChild(imported(doc, rPr));
  useful.forEach(n => out.appendChild(imported(doc, n)));
  return out;
}

function replaceReference(doc, refEl, noteRuns) {
  const run = directRunAncestor(refEl);
  if (!run || !run.parentNode) {
    const parent = refEl.parentNode;
    if (!parent) return false;
    noteRuns.forEach(r => parent.insertBefore(r, refEl));
    parent.removeChild(refEl);
    return true;
  }

  const parent = run.parentNode;
  const children = elements(run);
  const refIndex = children.indexOf(refEl);
  if (refIndex < 0) return false;

  const before = cloneMainRunSlice(doc, run, children.slice(0, refIndex));
  const after = cloneMainRunSlice(doc, run, children.slice(refIndex + 1));

  if (before) parent.insertBefore(before, run);
  noteRuns.forEach(r => parent.insertBefore(r, run));
  if (after) parent.insertBefore(after, run);
  parent.removeChild(run);
  return true;
}

function positiveFootnotes(footnotesDoc) {
  const nodes = Array.from(footnotesDoc.getElementsByTagNameNS?.(W_NS, "footnote") || []);
  const fallback = nodes.length ? nodes : Array.from(footnotesDoc.getElementsByTagName("w:footnote") || []);
  const map = new Map();
  for (const note of fallback) {
    const id = Number(wAttr(note, "id"));
    if (Number.isInteger(id) && id > 0) map.set(String(id), note);
  }
  return map;
}

function referenceNodes(documentDoc) {
  const nodes = Array.from(documentDoc.getElementsByTagNameNS?.(W_NS, "footnoteReference") || []);
  return nodes.length ? nodes : Array.from(documentDoc.getElementsByTagName("w:footnoteReference") || []);
}

function removeFootnoteRelationship(zip, relXml) {
  if (!relXml) return;
  const doc = parser.parseFromString(relXml, "application/xml");
  const rels = Array.from(doc.getElementsByTagNameNS?.(REL_NS, "Relationship") || []);
  const fallback = rels.length ? rels : Array.from(doc.getElementsByTagName("Relationship") || []);
  for (const rel of fallback) {
    const type = rel.getAttribute("Type") || "";
    const target = rel.getAttribute("Target") || "";
    if (type.endsWith("/footnotes") || /(^|\/)footnotes\.xml$/i.test(target)) {
      rel.parentNode?.removeChild(rel);
    }
  }
  zip.file("word/_rels/document.xml.rels", serializer.serializeToString(doc));
}

function removeFootnoteContentType(zip, contentTypesXml) {
  if (!contentTypesXml) return;
  const doc = parser.parseFromString(contentTypesXml, "application/xml");
  const nodes = Array.from(doc.getElementsByTagNameNS?.(CT_NS, "Override") || []);
  const fallback = nodes.length ? nodes : Array.from(doc.getElementsByTagName("Override") || []);
  for (const node of fallback) {
    if ((node.getAttribute("PartName") || "").toLowerCase() === "/word/footnotes.xml") {
      node.parentNode?.removeChild(node);
    }
  }
  zip.file("[Content_Types].xml", serializer.serializeToString(doc));
}

function outputName(name) {
  const raw = String(name || "document.docx");
  return /\.docx$/i.test(raw)
    ? raw.replace(/\.docx$/i, "_מסולסלות.docx")
    : raw + "_מסולסלות.docx";
}

export async function transformFootnotesToCurly(input, { filename = "" } = {}) {
  const arrayBuffer = input instanceof ArrayBuffer
    ? input
    : await input.arrayBuffer();

  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  const footFile = zip.file("word/footnotes.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml בקובץ.");
  if (!footFile) throw new Error("לא נמצאו הערות שוליים בקובץ Word.");

  const [docXml, footXml, relXml, ctXml] = await Promise.all([
    docFile.async("string"),
    footFile.async("string"),
    zip.file("word/_rels/document.xml.rels")?.async("string") || Promise.resolve(""),
    zip.file("[Content_Types].xml")?.async("string") || Promise.resolve(""),
  ]);

  const documentDoc = parser.parseFromString(docXml, "application/xml");
  const footnotesDoc = parser.parseFromString(footXml, "application/xml");
  const notes = positiveFootnotes(footnotesDoc);
  const refs = referenceNodes(documentDoc);

  if (!refs.length) throw new Error("לא נמצאו הפניות להערות שוליים בגוף המסמך.");

  const referencedIds = [...new Set(refs.map(ref => String(wAttr(ref, "id"))).filter(Boolean))];
  const missingIds = referencedIds.filter(id => !notes.has(id));
  if (missingIds.length) {
    const err = new Error(`חסרות הערות עבור ההפניות: ${missingIds.join(", ")}. המסמך לא שונה.`);
    err.code = "MISSING_FOOTNOTES";
    err.missingIds = missingIds;
    throw err;
  }

  const referencedSet = new Set(referencedIds);
  const orphanIds = [...notes.keys()].filter(id => !referencedSet.has(id));
  if (orphanIds.length) {
    const err = new Error(
      `קיימות הערות שוליים ללא הפניה בגוף המסמך: ${orphanIds.join(", ")}. המסמך לא שונה כדי למנוע אובדן מידע.`
    );
    err.code = "UNREFERENCED_FOOTNOTES";
    err.orphanIds = orphanIds;
    throw err;
  }

  const unsupported = [];
  for (const id of referencedIds) {
    const kind = unsupportedFootnoteContent(notes.get(id));
    if (kind) unsupported.push({ id, kind });
  }
  if (unsupported.length) {
    const err = new Error(
      "יש הערות שמכילות מבנה שאינו בטוח להמרה אוטומטית (תמונה/טבלה/אובייקט). המסמך לא שונה."
    );
    err.code = "UNSUPPORTED_FOOTNOTE_CONTENT";
    err.items = unsupported;
    throw err;
  }

  let converted = 0;
  for (const ref of [...refs]) {
    const id = String(wAttr(ref, "id"));
    const note = notes.get(id);
    if (!note) continue;
    const noteRuns = buildFootnoteRuns(documentDoc, note);
    if (replaceReference(documentDoc, ref, noteRuns)) converted++;
  }

  if (converted !== refs.length) {
    const err = new Error(
      `הומרו ${converted} מתוך ${refs.length} הפניות בלבד. המסמך לא נשמר כדי למנוע אובדן מידע.`
    );
    err.code = "PARTIAL_CONVERSION";
    throw err;
  }

  zip.file("word/document.xml", serializer.serializeToString(documentDoc));

  // Every reference was converted. Remove the now-unused footnote part and its
  // package declarations. Styles remain untouched because they may be reused.
  zip.remove("word/footnotes.xml");
  zip.remove("word/_rels/footnotes.xml.rels");
  removeFootnoteRelationship(zip, relXml);
  removeFootnoteContentType(zip, ctXml);

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const sourceName = filename || input?.name || "document.docx";
  return {
    blob,
    filename: outputName(sourceName),
    report: {
      referencesConverted: converted,
      uniqueFootnotesConverted: referencedIds.length,
      missingIds: [],
      removedFootnotePart: true,
    },
  };
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
    input.accept = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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
          `ההמרה הסתיימה בהצלחה.\n\nהפניות שהומרו: ${result.report.referencesConverted}\nהערות ייחודיות: ${result.report.uniqueFootnotesConverted}\n\nנשמר: ${result.filename}`
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
