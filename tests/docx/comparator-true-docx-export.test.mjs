import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import {
  buildComparatorDocxBytes,
  comparatorDocxFilename,
  validateComparatorFootnoteMerge,
} from "../../src/comparator_tool/comparator_docx_export.js";
import {
  docx_find_streams,
  docx_extract,
} from "../../src/comparator_tool/comparator_engine.js";
import { JSDOM } from "jsdom";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const parser = new DOMParser();

function byLocalName(doc, name) {
  const nodes = doc.getElementsByTagNameNS?.(W, name);
  if (nodes?.length) return Array.from(nodes);
  return Array.from(doc.getElementsByTagName(`w:${name}`) || []);
}

function wAttr(node, name) {
  return node?.getAttributeNS?.(W, name)
    || node?.getAttribute?.(`w:${name}`)
    || node?.getAttribute?.(name)
    || "";
}

function textOf(node) {
  return byLocalName(node, "t").map(n => n.textContent || "").join("");
}

async function unpack(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml").async("string");
  const footnotesXml = await zip.file("word/footnotes.xml").async("string");
  return {
    zip,
    documentDoc: parser.parseFromString(documentXml, "application/xml"),
    footnotesDoc: parser.parseFromString(footnotesXml, "application/xml"),
  };
}

test("validates exact marker/note counts across streams and split Quill ops", () => {
  const mainDelta = {
    ops: [
      { insert: "פתיחה " },
      { insert: "@", attributes: { bold: true } },
      { insert: "01", attributes: { italic: true } },
      { insert: " אמצע @02 סוף\n" },
    ],
  };
  const streams = [
    {
      marker: "@01",
      delta: { ops: [
        { insert: "@", attributes: { bold: true } },
        { insert: "01", attributes: { bold: true } },
        { insert: " הערה ראשונה\n" },
      ] },
    },
    {
      marker: "@02",
      delta: { ops: [{ insert: "@02 הערה שנייה\n" }] },
    },
  ];

  const v = validateComparatorFootnoteMerge(mainDelta, streams);
  assert.equal(v.references, 2);
  assert.equal(v.footnotes, 2);
  assert.deepEqual(v.streams, [
    { marker: "@01", notes: 1 },
    { marker: "@02", notes: 1 },
  ]);
});

test("builds true DOCX footnotes in main-reference order and preserves basic formatting", async () => {
  const mainDelta = {
    ops: [
      { insert: "לפני ", attributes: { bold: true } },
      { insert: "@", attributes: { color: "#123456" } },
      { insert: "01" },
      { insert: " בין " },
      { insert: "@02" },
      { insert: " אחרי", attributes: { underline: true } },
      { insert: "\n", attributes: { align: "right", direction: "rtl" } },
    ],
  };
  const streams = [
    {
      marker: "@01",
      delta: { ops: [
        { insert: "@01 ", attributes: { bold: true } },
        { insert: "הערה ", attributes: { italic: true } },
        { insert: "אחת\n" },
      ] },
    },
    {
      marker: "@02",
      delta: { ops: [
        { insert: "@02 " },
        { insert: "הערה שתיים", attributes: { underline: true } },
        { insert: "\n" },
      ] },
    },
  ];

  const built = buildComparatorDocxBytes({
    mainDelta,
    streams,
    title: "בדיקת מיזוג",
  });

  assert.equal(built.report.references, 2);
  assert.equal(built.report.footnotes, 2);
  assert.equal(comparatorDocxFilename("מקור.docx"), "מקור (ממוזג).docx");

  const { zip, documentDoc, footnotesDoc } = await unpack(built.bytes);
  assert(zip.file("[Content_Types].xml"));
  assert(zip.file("word/styles.xml"));
  assert(zip.file("word/settings.xml"));

  const refs = byLocalName(documentDoc, "footnoteReference");
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(n => Number(wAttr(n, "id"))), [1, 2]);

  const mainText = textOf(documentDoc);
  assert.equal(mainText, "לפני  בין  אחרי");
  assert.equal(mainText.includes("@01"), false);
  assert.equal(mainText.includes("@02"), false);

  const positiveNotes = byLocalName(footnotesDoc, "footnote")
    .filter(n => Number(wAttr(n, "id")) > 0)
    .sort((a, b) => Number(wAttr(a, "id")) - Number(wAttr(b, "id")));

  assert.equal(positiveNotes.length, 2);
  assert.equal(textOf(positiveNotes[0]), "@01 הערה אחת");
  assert.equal(textOf(positiveNotes[1]), "@02 הערה שתיים");

  const firstNoteBoldMarker = byLocalName(positiveNotes[0], "t")
    .find(n => (n.textContent || "").includes("@01"));
  assert(firstNoteBoldMarker);
  assert.equal(byLocalName(firstNoteBoldMarker.parentNode, "b").length, 1);

  const firstNoteItalic = byLocalName(positiveNotes[0], "t")
    .find(n => (n.textContent || "").includes("הערה"));
  assert(firstNoteItalic);
  assert.equal(byLocalName(firstNoteItalic.parentNode, "i").length, 1);

  const secondNoteUnder = byLocalName(positiveNotes[1], "t")
    .find(n => (n.textContent || "").includes("הערה שתיים"));
  assert(secondNoteUnder);
  assert.equal(byLocalName(secondNoteUnder.parentNode, "u").length, 1);

  assert.equal(byLocalName(documentDoc, "p").length, 1, "Quill terminal newline created a phantom paragraph");
});

test("uses order of main references, not stream declaration order, for Word footnote numbering", async () => {
  const built = buildComparatorDocxBytes({
    mainDelta: { ops: [{ insert: "A @02 B @01 C @02\n" }] },
    streams: [
      { marker: "@01", delta: { ops: [{ insert: "@01 one\n" }] } },
      { marker: "@02", delta: { ops: [{ insert: "@02 two-a\n@02 two-b\n" }] } },
    ],
  });

  const { documentDoc, footnotesDoc } = await unpack(built.bytes);
  assert.deepEqual(
    byLocalName(documentDoc, "footnoteReference").map(n => Number(wAttr(n, "id"))),
    [1, 2, 3]
  );

  const positiveNotes = byLocalName(footnotesDoc, "footnote")
    .filter(n => Number(wAttr(n, "id")) > 0)
    .sort((a, b) => Number(wAttr(a, "id")) - Number(wAttr(b, "id")));
  assert.deepEqual(positiveNotes.map(textOf), [
    "@02 two-a",
    "@01 one",
    "@02 two-b",
  ]);
});

test("round-trips through Comparator Word import with stream identities intact", async () => {
  const built = buildComparatorDocxBytes({
    mainDelta: { ops: [{ insert: "ראשי @01 אמצע @02 סוף\\n" }] },
    streams: [
      { marker: "@01", delta: { ops: [{ insert: "@01 הערה א\\n" }] } },
      { marker: "@02", delta: { ops: [{ insert: "@02 הערה ב\\n" }] } },
    ],
    title: "roundtrip",
  });

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    DOMParser: globalThis.DOMParser,
    NodeFilter: globalThis.NodeFilter,
    Node: globalThis.Node,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.Node = dom.window.Node;
  dom.window.JSZip = JSZip;

  try {
    const ab = built.bytes.buffer.slice(
      built.bytes.byteOffset,
      built.bytes.byteOffset + built.bytes.byteLength
    );
    const found = await docx_find_streams(ab);
    const footnoteStreams = found.filter(s => s.source === "footnote");
    assert.equal(footnoteStreams.length, 2);
    assert.deepEqual(
      footnoteStreams.map(s => s.marker).sort(),
      ["01", "02"]
    );

    const selected = footnoteStreams
      .sort((a, b) => String(a.marker).localeCompare(String(b.marker)))
      .map(s => [s, "@" + s.marker]);
    const extracted = await docx_extract(ab, selected);

    assert.equal(extracted.main.trimEnd(), "ראשי @01 אמצע @02 סוף");
    assert.deepEqual(
      extracted.streams.map(([marker, text]) => [marker, text.trim()]),
      [
        ["@01", "@01הערה א"],
        ["@02", "@02הערה ב"],
      ]
    );
  } finally {
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
    if (previous.DOMParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = previous.DOMParser;
    if (previous.NodeFilter === undefined) delete globalThis.NodeFilter; else globalThis.NodeFilter = previous.NodeFilter;
    if (previous.Node === undefined) delete globalThis.Node; else globalThis.Node = previous.Node;
    dom.window.close();
  }
});

test("fails closed when main marker count and stream note count differ", () => {
  assert.throws(
    () => buildComparatorDocxBytes({
      mainDelta: { ops: [{ insert: "A @01 B @01\n" }] },
      streams: [{ marker: "@01", delta: { ops: [{ insert: "@01 only-one\n" }] } }],
    }),
    err => err?.code === "STREAM_REFERENCE_COUNT_MISMATCH"
      && err.references === 2
      && err.notes === 1
  );
});

test("fails closed on stream text before its first marker", () => {
  assert.throws(
    () => validateComparatorFootnoteMerge(
      { ops: [{ insert: "A @01\n" }] },
      [{ marker: "@01", delta: { ops: [{ insert: "orphan text @01 note\n" }] } }]
    ),
    err => err?.code === "AMBIGUOUS_STREAM_PREFIX"
  );
});

test("fails closed on duplicate stream markers and embeds", () => {
  assert.throws(
    () => validateComparatorFootnoteMerge(
      { ops: [{ insert: "A @01\n" }] },
      [
        { marker: "@01", delta: { ops: [{ insert: "@01 a\n" }] } },
        { marker: "@01", delta: { ops: [{ insert: "@01 b\n" }] } },
      ]
    ),
    err => err?.code === "DUPLICATE_STREAM_MARKER"
  );

  assert.throws(
    () => validateComparatorFootnoteMerge(
      { ops: [{ insert: { image: "data:image/png;base64,x" } }] },
      []
    ),
    err => err?.code === "UNSUPPORTED_COMPARATOR_EMBED"
  );
});

test("preserves multiple paragraphs inside one footnote", async () => {
  const built = buildComparatorDocxBytes({
    mainDelta: { ops: [{ insert: "X @01 Y\n" }] },
    streams: [{
      marker: "@01",
      delta: { ops: [
        { insert: "@01 שורה ראשונה\n" },
        { insert: "שורה שנייה", attributes: { bold: true } },
        { insert: "\n" },
      ] },
    }],
  });

  const { footnotesDoc } = await unpack(built.bytes);
  const note = byLocalName(footnotesDoc, "footnote").find(n => Number(wAttr(n, "id")) === 1);
  assert(note);
  const paras = byLocalName(note, "p");
  assert.equal(paras.length, 2);
  assert.equal(textOf(paras[0]), "@01 שורה ראשונה");
  assert.equal(textOf(paras[1]), "שורה שנייה");
});
