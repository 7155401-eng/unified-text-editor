import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const parser = new DOMParser();
const serializer = new XMLSerializer();

const CONTENT_REVISIONS = new Set(["ins", "del", "moveFrom", "moveTo"]);
const MOVE_RANGE_MARKERS = new Set([
  "moveFromRangeStart", "moveFromRangeEnd",
  "moveToRangeStart", "moveToRangeEnd",
]);
const PROPERTY_CHANGE_TARGETS = Object.freeze({
  rPrChange: "rPr",
  pPrChange: "pPr",
  tblPrChange: "tblPr",
  trPrChange: "trPr",
  tcPrChange: "tcPr",
  sectPrChange: "sectPr",
  tblGridChange: "tblGrid",
});
const PROPERTY_CONTAINERS = new Set([
  "rPr", "pPr", "tblPr", "trPr", "tcPr", "sectPr", "tblGrid", "numPr",
]);
const UNSUPPORTED_REVISION_MARKUP = new Set([
  "cellIns", "cellDel", "cellMerge",
  "numberingChange",
  "customXmlInsRangeStart", "customXmlInsRangeEnd",
  "customXmlDelRangeStart", "customXmlDelRangeEnd",
  "customXmlMoveFromRangeStart", "customXmlMoveFromRangeEnd",
  "customXmlMoveToRangeStart", "customXmlMoveToRangeEnd",
  "conflictIns", "conflictDel",
]);

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

function descendants(node) {
  const out = [];
  const stack = [...elements(node)].reverse();
  while (stack.length) {
    const cur = stack.pop();
    out.push(cur);
    const kids = elements(cur);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

function wAttr(node, name) {
  return node?.getAttributeNS?.(W_NS, name)
    || node?.getAttribute?.(`w:${name}`)
    || node?.getAttribute?.(name)
    || "";
}

function imported(doc, node) {
  if (!node) return null;
  try {
    if (typeof doc.importNode === "function") return doc.importNode(node, true);
  } catch (_) {}
  return node.cloneNode(true);
}

function createW(doc, name) {
  return doc.createElementNS(W_NS, `w:${name}`);
}

function copyAttributes(source, target) {
  const attrs = source?.attributes || [];
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs.item(i);
    if (!a) continue;
    if (a.namespaceURI) target.setAttributeNS(a.namespaceURI, a.name, a.value);
    else target.setAttribute(a.name, a.value);
  }
}

function replaceAttributes(target, source) {
  const attrs = [];
  for (let i = 0; i < (target?.attributes?.length || 0); i++) {
    const a = target.attributes.item(i);
    if (a) attrs.push(a);
  }
  for (const a of attrs) {
    if (a.name === "xmlns" || String(a.name).startsWith("xmlns:")) continue;
    try {
      if (a.namespaceURI) target.removeAttributeNS(a.namespaceURI, a.localName || a.name);
      else target.removeAttribute(a.name);
    } catch (_) {}
  }
  copyAttributes(source, target);
}

function transformError(message, code, details = {}, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, details);
  return error;
}

export function normalizeFootnoteRevisionAction(action) {
  const value = String(action || "").trim().toLowerCase();
  if (value === "accept" || value === "reject") return value;
  throw transformError(
    "יש לבחור אם לקבל או לדחות את השינויים בהערות.",
    "INVALID_REVISION_ACTION",
    { action: value },
    400
  );
}

export function footnoteRevisionOutputName(name, action) {
  const raw = String(name || "document.docx");
  const suffix = action === "reject"
    ? "_שינויי_הערות_נדחו.docx"
    : "_שינויי_הערות_התקבלו.docx";
  return /\.docx$/i.test(raw) ? raw.replace(/\.docx$/i, suffix) : raw + suffix;
}

function positiveFootnotes(footnotesDoc) {
  const nodes = Array.from(footnotesDoc.getElementsByTagNameNS?.(W_NS, "footnote") || []);
  const fallback = nodes.length
    ? nodes
    : Array.from(footnotesDoc.getElementsByTagName("w:footnote") || []);
  return fallback.filter(note => {
    const id = Number(wAttr(note, "id"));
    return Number.isInteger(id) && id > 0;
  });
}

function inPropertyContext(node) {
  let cur = node?.parentNode || null;
  while (cur) {
    if (cur.nodeType === 1) {
      const ln = localName(cur);
      if (PROPERTY_CONTAINERS.has(ln)) return ln;
      if (ln === "footnote") return "";
    }
    cur = cur.parentNode;
  }
  return "";
}

function nestedContentRevision(node) {
  return descendants(node).find(child => CONTENT_REVISIONS.has(localName(child))) || null;
}

function validateRevisionMarkup(notes) {
  const supportedPropertyChanges = [];
  const contentRevisions = [];
  const rangeMarkers = [];
  const unsupported = [];

  for (const note of notes) {
    const noteId = String(wAttr(note, "id"));
    const nodes = descendants(note);

    for (const node of nodes) {
      const ln = localName(node);

      if (CONTENT_REVISIONS.has(ln)) {
        const propertyContext = inPropertyContext(node);
        if (propertyContext) {
          unsupported.push({
            noteId,
            kind: ln,
            context: propertyContext,
            reason: "paragraph/run/table structural revision",
          });
          continue;
        }
        const nested = nestedContentRevision(node);
        if (nested) {
          unsupported.push({
            noteId,
            kind: ln,
            nestedKind: localName(nested),
            reason: "nested revision",
          });
          continue;
        }
        contentRevisions.push({ noteId, node, kind: ln });
        continue;
      }

      if (MOVE_RANGE_MARKERS.has(ln)) {
        rangeMarkers.push({ noteId, node, kind: ln });
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(PROPERTY_CHANGE_TARGETS, ln)) {
        const expectedParent = PROPERTY_CHANGE_TARGETS[ln];
        const parent = node.parentNode;
        if (!parent || localName(parent) !== expectedParent) {
          unsupported.push({
            noteId,
            kind: ln,
            context: localName(parent),
            reason: "property change outside matching property container",
          });
          continue;
        }
        const snapshots = elements(node).filter(el => localName(el) === expectedParent);
        if (snapshots.length !== 1) {
          unsupported.push({
            noteId,
            kind: ln,
            reason: "property change does not contain exactly one prior snapshot",
          });
          continue;
        }
        if (descendants(snapshots[0]).some(el =>
          CONTENT_REVISIONS.has(localName(el))
          || Object.prototype.hasOwnProperty.call(PROPERTY_CHANGE_TARGETS, localName(el))
        )) {
          unsupported.push({
            noteId,
            kind: ln,
            reason: "nested revision inside property snapshot",
          });
          continue;
        }
        supportedPropertyChanges.push({
          noteId,
          node,
          kind: ln,
          parent,
          snapshot: snapshots[0],
        });
        continue;
      }

      if (UNSUPPORTED_REVISION_MARKUP.has(ln)) {
        unsupported.push({ noteId, kind: ln, reason: "unsupported structural revision" });
      }
    }
  }

  if (unsupported.length) {
    throw transformError(
      "נמצאו בהערות שינויי Word מבניים שלא ניתן לקבל/לדחות אוטומטית בלי סיכון לשינוי מבנה. המסמך לא שונה.",
      "UNSUPPORTED_FOOTNOTE_REVISIONS",
      { items: unsupported }
    );
  }

  return { contentRevisions, rangeMarkers, propertyChanges: supportedPropertyChanges };
}

function convertDeletedTextNodes(doc, root) {
  const targets = descendants(root).filter(node =>
    localName(node) === "delText" || localName(node) === "delInstrText"
  );

  for (const old of targets) {
    const newName = localName(old) === "delText" ? "t" : "instrText";
    const replacement = createW(doc, newName);
    copyAttributes(old, replacement);
    while (old.firstChild) replacement.appendChild(old.firstChild.cloneNode(true));
    old.parentNode?.replaceChild(replacement, old);
  }
}

function unwrap(node) {
  const parent = node?.parentNode;
  if (!parent) return false;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
  return true;
}

function removeNode(node) {
  if (!node?.parentNode) return false;
  node.parentNode.removeChild(node);
  return true;
}

function applyPropertyChange(doc, item, action) {
  if (!item?.node?.parentNode || !item.parent) return false;

  if (action === "accept") {
    return removeNode(item.node);
  }

  // Reject: restore the previous property snapshot in-place. The outer property
  // element stays where Word expects it; only its current property children and
  // revision metadata are replaced by the prior snapshot.
  const parent = item.parent;
  const snapshot = item.snapshot;
  replaceAttributes(parent, snapshot);

  while (parent.firstChild) parent.removeChild(parent.firstChild);
  for (const child of elements(snapshot)) {
    parent.appendChild(imported(doc, child));
  }
  return true;
}

function applyContentRevision(doc, item, action) {
  const { node, kind } = item;
  if (!node?.parentNode) return false;

  const keep = action === "accept"
    ? (kind === "ins" || kind === "moveTo")
    : (kind === "del" || kind === "moveFrom");

  if (!keep) return removeNode(node);

  if (action === "reject" && kind === "del") {
    convertDeletedTextNodes(doc, node);
  }
  return unwrap(node);
}

function countRevisionLikeNodes(xml) {
  if (!xml) return 0;
  const doc = parser.parseFromString(xml, "application/xml");
  return descendants(doc.documentElement).filter(node => {
    const ln = localName(node);
    return CONTENT_REVISIONS.has(ln)
      || MOVE_RANGE_MARKERS.has(ln)
      || Object.prototype.hasOwnProperty.call(PROPERTY_CHANGE_TARGETS, ln)
      || UNSUPPORTED_REVISION_MARKUP.has(ln);
  }).length;
}

export async function transformFootnoteTrackedChangesCore(arrayBuffer, {
  filename = "",
  action = "",
} = {}) {
  if (!arrayBuffer || !arrayBuffer.byteLength) {
    throw transformError("לא התקבל קובץ DOCX.", "EMPTY_DOCX", {}, 400);
  }

  const normalizedAction = normalizeFootnoteRevisionAction(action);
  const zip = await JSZip.loadAsync(arrayBuffer);
  const footFile = zip.file("word/footnotes.xml");
  const docFile = zip.file("word/document.xml");

  if (!footFile) {
    throw transformError("לא נמצאו הערות שוליים בקובץ Word.", "NO_FOOTNOTES");
  }
  if (!docFile) {
    throw transformError("לא נמצא word/document.xml בקובץ.", "MISSING_DOCUMENT_XML", {}, 400);
  }

  const [footXml, documentXml] = await Promise.all([
    footFile.async("string"),
    docFile.async("string"),
  ]);

  const footnotesDoc = parser.parseFromString(footXml, "application/xml");
  const notes = positiveFootnotes(footnotesDoc);
  if (!notes.length) {
    throw transformError("לא נמצאו הערות שוליים רגילות בקובץ.", "NO_POSITIVE_FOOTNOTES");
  }

  const validation = validateRevisionMarkup(notes);
  const totalRevisionItems =
    validation.contentRevisions.length
    + validation.propertyChanges.length
    + validation.rangeMarkers.length;

  if (!totalRevisionItems) {
    throw transformError(
      "לא נמצאו שינויי מעקב בתוך הערות השוליים. גוף המסמך לא שונה.",
      "NO_FOOTNOTE_REVISIONS"
    );
  }

  const report = {
    action: normalizedAction,
    footnotesScanned: notes.length,
    contentRevisionsFound: validation.contentRevisions.length,
    propertyChangesFound: validation.propertyChanges.length,
    moveRangeMarkersFound: validation.rangeMarkers.length,
    insertionsAccepted: 0,
    insertionsRejected: 0,
    deletionsAccepted: 0,
    deletionsRejected: 0,
    movesFromAccepted: 0,
    movesFromRejected: 0,
    movesToAccepted: 0,
    movesToRejected: 0,
    propertyChangesAccepted: 0,
    propertyChangesRejected: 0,
    moveRangeMarkersRemoved: 0,
    bodyRevisionNodesUntouched: countRevisionLikeNodes(documentXml),
  };

  // Property metadata is independent of run-content wrappers and can be
  // resolved first. Validation above guarantees snapshots are self-contained.
  for (const item of validation.propertyChanges) {
    if (!applyPropertyChange(footnotesDoc, item, normalizedAction)) {
      throw transformError(
        "לא ניתן היה להחיל שינוי עיצוב בהערה. המסמך לא נשמר.",
        "PROPERTY_CHANGE_APPLY_FAILED",
        { noteId: item.noteId, kind: item.kind }
      );
    }
    if (normalizedAction === "accept") report.propertyChangesAccepted++;
    else report.propertyChangesRejected++;
  }

  for (const item of validation.contentRevisions) {
    if (!applyContentRevision(footnotesDoc, item, normalizedAction)) {
      throw transformError(
        "לא ניתן היה להחיל שינוי טקסט בהערה. המסמך לא נשמר.",
        "CONTENT_REVISION_APPLY_FAILED",
        { noteId: item.noteId, kind: item.kind }
      );
    }

    if (item.kind === "ins") {
      if (normalizedAction === "accept") report.insertionsAccepted++;
      else report.insertionsRejected++;
    } else if (item.kind === "del") {
      if (normalizedAction === "accept") report.deletionsAccepted++;
      else report.deletionsRejected++;
    } else if (item.kind === "moveFrom") {
      if (normalizedAction === "accept") report.movesFromAccepted++;
      else report.movesFromRejected++;
    } else if (item.kind === "moveTo") {
      if (normalizedAction === "accept") report.movesToAccepted++;
      else report.movesToRejected++;
    }
  }

  for (const marker of validation.rangeMarkers) {
    if (removeNode(marker.node)) report.moveRangeMarkersRemoved++;
  }

  const remaining = validateRevisionMarkup(notes);
  const remainingCount =
    remaining.contentRevisions.length
    + remaining.propertyChanges.length
    + remaining.rangeMarkers.length;
  if (remainingCount) {
    throw transformError(
      "נותרו שינויי מעקב בהערות לאחר העיבוד. המסמך לא נשמר כדי למנוע תוצאה חלקית.",
      "FOOTNOTE_REVISIONS_REMAIN",
      { remainingCount }
    );
  }

  zip.file("word/footnotes.xml", serializer.serializeToString(footnotesDoc));

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    bytes,
    filename: footnoteRevisionOutputName(filename || "document.docx", normalizedAction),
    report,
  };
}
