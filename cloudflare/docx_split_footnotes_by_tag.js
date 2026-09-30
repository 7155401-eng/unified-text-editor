import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
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

function setWAttr(node, name, value) {
  node.setAttributeNS(W_NS, `w:${name}`, String(value));
}

function createW(doc, name) {
  return doc.createElementNS(W_NS, `w:${name}`);
}

function imported(doc, node) {
  if (!node) return null;
  try {
    if (typeof doc.importNode === "function") return doc.importNode(node, true);
  } catch (_) {}
  return node.cloneNode(true);
}

function copyAttributes(source, target, skipLocalNames = new Set()) {
  const attrs = source?.attributes || [];
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs.item(i);
    if (!a) continue;
    const local = String(a.localName || a.name || "").replace(/^.*:/, "");
    if (skipLocalNames.has(local)) continue;
    if (a.namespaceURI) target.setAttributeNS(a.namespaceURI, a.name, a.value);
    else target.setAttribute(a.name, a.value);
  }
}

function transformError(message, code, details = {}, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, details);
  return error;
}

export function normalizeFootnoteSplitTags(tags) {
  const raw = Array.isArray(tags)
    ? tags
    : String(tags || "").split(/[\n,;]+/u);

  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const tag = String(value ?? "").trim();
    if (!tag || seen.has(tag)) continue;
    if (tag.length > 64) {
      throw transformError("תג ארוך מדי. המגבלה היא 64 תווים לתג.", "TAG_TOO_LONG", { tag }, 400);
    }
    seen.add(tag);
    out.push(tag);
  }
  if (!out.length) {
    throw transformError("לא הוזן תג לפיצול.", "MISSING_SPLIT_TAGS", {}, 400);
  }
  if (out.length > 32) {
    throw transformError("ניתן לפצל לפי עד 32 תגים בפעולה אחת.", "TOO_MANY_SPLIT_TAGS", { count: out.length }, 400);
  }
  // Longest first avoids @01 matching inside @010 at the same position.
  return out.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function splitFootnotesByTagOutputName(name) {
  const raw = String(name || "document.docx");
  return /\.docx$/i.test(raw)
    ? raw.replace(/\.docx$/i, "_מפוצל_לפי_תג.docx")
    : raw + "_מפוצל_לפי_תג.docx";
}

function positiveFootnotes(footnotesDoc) {
  const nodes = Array.from(footnotesDoc.getElementsByTagNameNS?.(W_NS, "footnote") || []);
  const fallback = nodes.length
    ? nodes
    : Array.from(footnotesDoc.getElementsByTagName("w:footnote") || []);
  const map = new Map();

  for (const note of fallback) {
    const id = Number(wAttr(note, "id"));
    if (Number.isInteger(id) && id > 0) map.set(String(id), note);
  }
  return map;
}

function referenceNodes(documentDoc) {
  const nodes = Array.from(documentDoc.getElementsByTagNameNS?.(W_NS, "footnoteReference") || []);
  return nodes.length
    ? nodes
    : Array.from(documentDoc.getElementsByTagName("w:footnoteReference") || []);
}

function footnoteParagraphs(noteEl) {
  const all = Array.from(noteEl.getElementsByTagNameNS?.(W_NS, "p") || []);
  return all.length ? all : Array.from(noteEl.getElementsByTagName("w:p") || []);
}

function paragraphRuns(paragraph) {
  const all = Array.from(paragraph.getElementsByTagNameNS?.(W_NS, "r") || []);
  return all.length ? all : Array.from(paragraph.getElementsByTagName("w:r") || []);
}

function payloadTextForElement(el) {
  switch (localName(el)) {
    case "t": return el.textContent || "";
    case "tab": return "\t";
    case "br":
    case "cr": return "\n";
    case "noBreakHyphen": return "‑";
    case "softHyphen": return "\u00ad";
    default: return "";
  }
}

function semanticFootnoteText(noteEl) {
  let out = "";
  const walk = (node) => {
    for (const child of elements(node)) {
      const ln = localName(child);
      if (ln === "footnoteRef") continue;
      if (["t", "tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(ln)) {
        out += payloadTextForElement(child);
        continue;
      }
      walk(child);
    }
  };
  walk(noteEl);
  return out;
}

function unsupportedFootnoteContent(noteEl) {
  const forbidden = new Set([
    "drawing", "pict", "object", "altChunk", "tbl", "hyperlink",
    "fldSimple", "instrText", "fldChar", "sym", "sdt", "smartTag", "customXml",
    "ins", "del", "moveFrom", "moveTo", "endnoteReference", "footnoteReference",
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

function noteModel(noteEl) {
  const paragraphs = footnoteParagraphs(noteEl);
  let text = "";
  let pos = 0;
  const pModels = [];

  paragraphs.forEach((p, pi) => {
    if (pi > 0) {
      text += "\n";
      pos += 1;
    }
    const pStart = pos;
    const runs = [];

    for (const sourceRun of paragraphRuns(p)) {
      const units = [];
      for (const child of elements(sourceRun)) {
        const ln = localName(child);
        if (ln === "rPr" || ln === "footnoteRef") continue;
        if (!["t", "tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(ln)) continue;
        const unitText = payloadTextForElement(child);
        if (!unitText) continue;
        const start = pos;
        text += unitText;
        pos += unitText.length;
        units.push({ source: child, start, end: pos, text: unitText, kind: ln });
      }
      if (units.length) runs.push({ sourceRun, units });
    }

    pModels.push({
      source: p,
      start: pStart,
      end: pos,
      runs,
    });
  });

  return { text, paragraphs: pModels };
}

function matchTagAt(text, index, tags) {
  for (const tag of tags) {
    if (text.startsWith(tag, index)) return tag;
  }
  return "";
}

function splitRangesByTags(text, tags) {
  const boundaries = [0];
  const matches = [];
  let lastBoundary = 0;

  for (let i = 0; i < text.length;) {
    const tag = matchTagAt(text, i, tags);
    if (!tag) {
      i += 1;
      continue;
    }

    // Avoid creating a whitespace-only prefix when the first tag follows only
    // spaces/line breaks. In that case the first real segment begins at 0 and
    // keeps the whitespace plus tag.
    const before = text.slice(lastBoundary, i);
    if (i > lastBoundary && before.trim()) {
      boundaries.push(i);
      lastBoundary = i;
    }
    matches.push({ index: i, tag });
    i += Math.max(1, tag.length);
  }

  const uniq = [...new Set(boundaries)].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < uniq.length; i++) {
    const start = uniq[i];
    const end = i + 1 < uniq.length ? uniq[i + 1] : text.length;
    if (end <= start) continue;
    if (!text.slice(start, end).trim()) {
      if (ranges.length) ranges[ranges.length - 1].end = end;
      continue;
    }
    ranges.push({ start, end });
  }

  return { ranges, matches };
}

function createFootnoteMarkerRun(doc, sourceNote) {
  const run = createW(doc, "r");
  const sourceRuns = paragraphRuns(footnoteParagraphs(sourceNote)[0] || sourceNote);
  const markerSource = sourceRuns.find(r =>
    elements(r).some(c => localName(c) === "footnoteRef")
  );
  const rPr = markerSource && elements(markerSource).find(c => localName(c) === "rPr");
  if (rPr) run.appendChild(imported(doc, rPr));
  run.appendChild(createW(doc, "footnoteRef"));
  return run;
}

function cloneElementWithText(doc, source, text) {
  const out = source.cloneNode(false);
  // xmldom clone belongs to the same footnotes document, but import defensively.
  const target = imported(doc, out);
  while (target.firstChild) target.removeChild(target.firstChild);
  if (text || localName(source) === "t") {
    if (/^\s|\s$/u.test(text)) target.setAttribute("xml:space", "preserve");
    target.appendChild(doc.createTextNode(text));
  }
  return target;
}

function sliceRun(doc, runModel, start, end) {
  const newRun = createW(doc, "r");
  const rPr = elements(runModel.sourceRun).find(c => localName(c) === "rPr");
  if (rPr) newRun.appendChild(imported(doc, rPr));

  let payloadCount = 0;
  for (const unit of runModel.units) {
    const a = Math.max(start, unit.start);
    const b = Math.min(end, unit.end);
    if (b <= a) continue;

    if (unit.kind === "t") {
      const relA = a - unit.start;
      const relB = b - unit.start;
      const slice = unit.text.slice(relA, relB);
      if (!slice) continue;
      newRun.appendChild(cloneElementWithText(doc, unit.source, slice));
      payloadCount++;
    } else {
      // Non-text units are one logical character. Include only when the whole
      // unit belongs to this segment; boundaries never intentionally split them.
      if (a === unit.start && b === unit.end) {
        newRun.appendChild(imported(doc, unit.source));
        payloadCount++;
      }
    }
  }

  return payloadCount ? newRun : null;
}

function buildSegmentFootnote(footnotesDoc, sourceNote, model, range, id) {
  const note = createW(footnotesDoc, "footnote");
  copyAttributes(sourceNote, note, new Set(["id"]));
  setWAttr(note, "id", id);

  let emitted = 0;
  for (const pModel of model.paragraphs) {
    const a = Math.max(range.start, pModel.start);
    const b = Math.min(range.end, pModel.end);
    if (b <= a) continue;

    const p = createW(footnotesDoc, "p");
    copyAttributes(pModel.source, p);
    const pPr = elements(pModel.source).find(c => localName(c) === "pPr");
    if (pPr) p.appendChild(imported(footnotesDoc, pPr));

    if (emitted === 0) p.appendChild(createFootnoteMarkerRun(footnotesDoc, sourceNote));

    let runCount = 0;
    for (const runModel of pModel.runs) {
      const run = sliceRun(footnotesDoc, runModel, a, b);
      if (run) {
        p.appendChild(run);
        runCount++;
      }
    }

    if (runCount || emitted === 0) {
      note.appendChild(p);
      emitted++;
    }
  }

  if (!emitted) {
    throw transformError(
      "נוצר מקטע הערה ריק בזמן הפיצול. המסמך לא שונה.",
      "EMPTY_SPLIT_SEGMENT",
      { id, start: range.start, end: range.end }
    );
  }

  return note;
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

function createReferenceRun(doc, sourceRun, id) {
  const run = createW(doc, "r");
  const rPr = elements(sourceRun).find(n => localName(n) === "rPr");
  if (rPr) run.appendChild(imported(doc, rPr));
  const ref = createW(doc, "footnoteReference");
  setWAttr(ref, "id", id);
  run.appendChild(ref);
  return run;
}

function validateMainReferenceRun(refEl) {
  const run = directRunAncestor(refEl);
  if (!run || !run.parentNode) {
    throw transformError(
      "נמצאה הפניית הערת שוליים במבנה Word לא רגיל. המסמך לא שונה.",
      "UNSUPPORTED_REFERENCE_LAYOUT"
    );
  }
  const refs = elements(run).filter(c => localName(c) === "footnoteReference");
  if (refs.length !== 1) {
    throw transformError(
      "נמצאו כמה הפניות באותו run של Word. המסמך לא שונה כדי למנוע שינוי סדר.",
      "MULTIPLE_REFERENCES_IN_RUN"
    );
  }
  const forbidden = new Set(["drawing", "pict", "object", "fldChar", "instrText", "sym"]);
  for (const child of elements(run)) {
    if (forbidden.has(localName(child))) {
      throw transformError(
        "הפניית הערת שוליים נמצאת בתוך run מורכב (שדה/תמונה/סמל). המסמך לא שונה.",
        "UNSUPPORTED_REFERENCE_RUN",
        { kind: localName(child) }
      );
    }
  }
  return run;
}

function replaceReferenceWithIds(documentDoc, refEl, ids) {
  const run = validateMainReferenceRun(refEl);
  const parent = run.parentNode;
  const children = elements(run);
  const refIndex = children.indexOf(refEl);
  if (refIndex < 0) {
    throw transformError("לא ניתן לאתר את ההפניה בתוך ה-run.", "REFERENCE_NOT_IN_RUN");
  }

  const before = cloneMainRunSlice(documentDoc, run, children.slice(0, refIndex));
  const after = cloneMainRunSlice(documentDoc, run, children.slice(refIndex + 1));

  if (before) parent.insertBefore(before, run);
  for (const id of ids) parent.insertBefore(createReferenceRun(documentDoc, run, id), run);
  if (after) parent.insertBefore(after, run);
  parent.removeChild(run);
}

export async function transformSplitFootnotesByTagCore(arrayBuffer, {
  filename = "",
  tags = [],
} = {}) {
  if (!arrayBuffer || !arrayBuffer.byteLength) {
    throw transformError("לא התקבל קובץ DOCX.", "EMPTY_DOCX", {}, 400);
  }

  const normalizedTags = normalizeFootnoteSplitTags(tags);
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  const footFile = zip.file("word/footnotes.xml");

  if (!docFile) throw transformError("לא נמצא word/document.xml בקובץ.", "MISSING_DOCUMENT_XML", {}, 400);
  if (!footFile) throw transformError("לא נמצאו הערות שוליים בקובץ Word.", "NO_FOOTNOTES");

  const [docXml, footXml] = await Promise.all([
    docFile.async("string"),
    footFile.async("string"),
  ]);

  const documentDoc = parser.parseFromString(docXml, "application/xml");
  const footnotesDoc = parser.parseFromString(footXml, "application/xml");
  const notes = positiveFootnotes(footnotesDoc);
  const refs = referenceNodes(documentDoc);

  if (!refs.length) {
    throw transformError("לא נמצאו הפניות להערות שוליים בגוף המסמך.", "NO_FOOTNOTE_REFERENCES");
  }

  const refsById = new Map();
  for (const ref of refs) {
    const id = String(wAttr(ref, "id"));
    if (!id) continue;
    if (!refsById.has(id)) refsById.set(id, []);
    refsById.get(id).push(ref);
  }

  const missingIds = [...refsById.keys()].filter(id => !notes.has(id));
  if (missingIds.length) {
    throw transformError(
      `חסרות הערות עבור ההפניות: ${missingIds.join(", ")}. המסמך לא שונה.`,
      "MISSING_FOOTNOTES",
      { missingIds }
    );
  }

  // Validate all main references before mutating either XML document.
  refs.forEach(validateMainReferenceRun);

  let maxId = 0;
  for (const id of notes.keys()) maxId = Math.max(maxId, Number(id) || 0);

  const plans = [];
  const matchesByTag = Object.fromEntries(normalizedTags.map(tag => [tag, 0]));

  for (const [id, note] of notes.entries()) {
    // First decide from all visible text whether this note is a split target.
    // Unsupported containers (table/hyperlink/field/etc.) may hold a tag that
    // the safe run model intentionally ignores; silently treating that as
    // "no match" would hide data from the user. If raw text implies a split,
    // require the entire note structure to be safe before modelling it.
    const rawText = semanticFootnoteText(note);
    const rawSplit = splitRangesByTags(rawText, normalizedTags);
    if (rawSplit.ranges.length <= 1) {
      rawSplit.matches.forEach(m => { matchesByTag[m.tag] = (matchesByTag[m.tag] || 0) + 1; });
      continue;
    }

    const unsafe = unsupportedFootnoteContent(note);
    if (unsafe) {
      throw transformError(
        `הערה ${id} מכילה מבנה שאינו בטוח לפיצול אוטומטי (${unsafe}). המסמך לא שונה.`,
        "UNSUPPORTED_FOOTNOTE_CONTENT",
        { items: [{ id, kind: unsafe }] }
      );
    }

    const model = noteModel(note);
    const split = splitRangesByTags(model.text, normalizedTags);
    split.matches.forEach(m => { matchesByTag[m.tag] = (matchesByTag[m.tag] || 0) + 1; });

    if (split.ranges.length <= 1) {
      throw transformError(
        `הערה ${id} זוהתה כמועמדת לפיצול, אך לא ניתן היה למפות את התגים בבטחה ל-runs של Word.`,
        "TAG_MAPPING_MISMATCH",
        { id }
      );
    }

    const ids = [Number(id)];
    while (ids.length < split.ranges.length) ids.push(++maxId);

    const segmentNotes = split.ranges.map((range, index) =>
      buildSegmentFootnote(footnotesDoc, note, model, range, ids[index])
    );

    plans.push({
      id,
      sourceNote: note,
      refs: refsById.get(id) || [],
      ids,
      segmentNotes,
      segmentCount: split.ranges.length,
    });
  }

  if (!plans.length) {
    throw transformError(
      "לא נמצאה אף הערת שוליים שניתנת לפיצול לפי התגים שנבחרו. המסמך לא שונה.",
      "NO_SPLIT_TAG_MATCHES",
      { tags: normalizedTags, matchesByTag }
    );
  }

  let referencesExpanded = 0;
  let newFootnotesCreated = 0;

  // Apply footnote replacements first.
  for (const plan of plans) {
    const parent = plan.sourceNote.parentNode;
    const first = plan.segmentNotes[0];
    parent.replaceChild(first, plan.sourceNote);

    let cursor = first.nextSibling;
    for (const extra of plan.segmentNotes.slice(1)) {
      parent.insertBefore(extra, cursor);
      newFootnotesCreated++;
    }
  }

  // Then expand each body reference into adjacent references for all segments.
  for (const plan of plans) {
    for (const ref of plan.refs) {
      replaceReferenceWithIds(documentDoc, ref, plan.ids);
      referencesExpanded++;
    }
  }

  zip.file("word/document.xml", serializer.serializeToString(documentDoc));
  zip.file("word/footnotes.xml", serializer.serializeToString(footnotesDoc));

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    bytes,
    filename: splitFootnotesByTagOutputName(filename || "document.docx"),
    report: {
      tags: normalizedTags,
      matchesByTag,
      footnotesScanned: notes.size,
      footnotesSplit: plans.length,
      newFootnotesCreated,
      referencesExpanded,
      resultingPositiveFootnotes: notes.size + newFootnotesCreated,
    },
  };
}
