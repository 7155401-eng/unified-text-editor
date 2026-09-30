import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { JSDOM } from "jsdom";
import {
  normalizeFootnoteSplitTags,
  transformSplitFootnotesByTagCore,
} from "../../cloudflare/docx_split_footnotes_by_tag.js";
import {
  handleDocxApi,
  isDocxSplitFootnotesByTagPath,
} from "../../cloudflare/docx_worker_entry.js";
import { wireSplitFootnotesByTagTool } from "../../src/docx_tools/split_footnotes_by_tag.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const parser = new DOMParser();

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`;
}

function documentRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL}">
  <Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`;
}

function docXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`;
}

function footnotesXml(notes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}">
  <w:footnote w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  ${notes}
</w:footnotes>`;
}

async function makeDocx({ body, notes }) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml());
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"></Relationships>`);
  zip.file("word/document.xml", docXml(body));
  zip.file("word/footnotes.xml", footnotesXml(notes));
  zip.file("word/_rels/document.xml.rels", documentRelsXml());
  return zip.generateAsync({ type: "arraybuffer" });
}

function byLocalName(doc, name) {
  const all = doc.getElementsByTagNameNS?.(W, name);
  if (all?.length) return Array.from(all);
  return Array.from(doc.getElementsByTagName(`w:${name}`) || []);
}

function wAttr(node, name) {
  return node?.getAttributeNS?.(W, name)
    || node?.getAttribute?.(`w:${name}`)
    || node?.getAttribute?.(name)
    || "";
}

function positiveFootnotes(doc) {
  return byLocalName(doc, "footnote")
    .filter(n => Number(wAttr(n, "id")) > 0)
    .sort((a, b) => Number(wAttr(a, "id")) - Number(wAttr(b, "id")));
}

function visibleText(node) {
  return byLocalName(node, "t").map(n => n.textContent || "").join("");
}

async function unpackResult(result) {
  const zip = await JSZip.loadAsync(result.bytes);
  const documentXml = await zip.file("word/document.xml").async("string");
  const footnotesXmlText = await zip.file("word/footnotes.xml").async("string");
  return {
    zip,
    documentDoc: parser.parseFromString(documentXml, "application/xml"),
    footnotesDoc: parser.parseFromString(footnotesXmlText, "application/xml"),
  };
}

test("normalizes literal tags without duplicates and prefers longer collisions", () => {
  assert.deepEqual(
    normalizeFootnoteSplitTags("@01, @010; @01\n@02"),
    ["@010", "@01", "@02"]
  );
});

test("splits a rich footnote at tags even when a tag crosses Word runs", async () => {
  const input = await makeDocx({
    body: `
      <w:p>
        <w:r>
          <w:rPr><w:color w:val="112233"/></w:rPr>
          <w:t>לפני</w:t>
          <w:footnoteReference w:id="1"/>
          <w:t>אחרי</w:t>
        </w:r>
      </w:p>`,
    notes: `
      <w:footnote w:id="1">
        <w:p>
          <w:pPr><w:jc w:val="right"/></w:pPr>
          <w:r><w:footnoteRef/></w:r>
          <w:r><w:t>@01 </w:t></w:r>
          <w:r><w:rPr><w:b/></w:rPr><w:t>ראשון </w:t></w:r>
          <w:r><w:rPr><w:i/></w:rPr><w:t>@</w:t></w:r>
          <w:r><w:rPr><w:i/></w:rPr><w:t>02 שני</w:t></w:r>
        </w:p>
      </w:footnote>`,
  });

  const result = await transformSplitFootnotesByTagCore(input, {
    filename: "source.docx",
    tags: ["@01", "@02"],
  });

  assert.equal(result.filename, "source_מפוצל_לפי_תג.docx");
  assert.equal(result.report.footnotesSplit, 1);
  assert.equal(result.report.newFootnotesCreated, 1);
  assert.equal(result.report.referencesExpanded, 1);
  assert.equal(result.report.matchesByTag["@01"], 1);
  assert.equal(result.report.matchesByTag["@02"], 1);

  const { documentDoc, footnotesDoc } = await unpackResult(result);

  const refs = byLocalName(documentDoc, "footnoteReference");
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(r => Number(wAttr(r, "id"))), [1, 2]);
  assert.equal(visibleText(documentDoc), "לפניאחרי");

  const notes = positiveFootnotes(footnotesDoc);
  assert.equal(notes.length, 2);
  assert.equal(Number(wAttr(notes[0], "id")), 1);
  assert.equal(Number(wAttr(notes[1], "id")), 2);
  assert.equal(visibleText(notes[0]), "@01 ראשון ");
  assert.equal(visibleText(notes[1]), "@02 שני");

  // No text loss: concatenating the split payload reconstructs the source.
  assert.equal(visibleText(notes[0]) + visibleText(notes[1]), "@01 ראשון @02 שני");

  const firstBoldText = byLocalName(notes[0], "t").find(n => (n.textContent || "").includes("ראשון"));
  assert(firstBoldText, "bold segment text missing");
  assert.equal(byLocalName(firstBoldText.parentNode, "b").length, 1);

  const secondItalicText = byLocalName(notes[1], "t").find(n => (n.textContent || "").includes("@"));
  assert(secondItalicText, "italic tag text missing");
  assert.equal(byLocalName(secondItalicText.parentNode, "i").length, 1);

  assert.equal(byLocalName(notes[0], "jc").length, 1, "paragraph properties lost");
  assert.equal(byLocalName(notes[1], "jc").length, 1, "paragraph properties lost on new note");
});

test("allocates new IDs above every existing positive footnote and leaves unsplit notes untouched", async () => {
  const input = await makeDocx({
    body: `
      <w:p><w:r><w:t>A</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
      <w:p><w:r><w:t>B</w:t></w:r><w:r><w:footnoteReference w:id="5"/></w:r></w:p>`,
    notes: `
      <w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>@A one @B two</w:t></w:r></w:p></w:footnote>
      <w:footnote w:id="5"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>untouched</w:t></w:r></w:p></w:footnote>`,
  });

  const result = await transformSplitFootnotesByTagCore(input, {
    filename: "ids.docx",
    tags: ["@A", "@B"],
  });
  const { documentDoc, footnotesDoc } = await unpackResult(result);

  assert.deepEqual(
    byLocalName(documentDoc, "footnoteReference").map(r => Number(wAttr(r, "id"))),
    [1, 6, 5]
  );

  const notes = positiveFootnotes(footnotesDoc);
  assert.deepEqual(notes.map(n => Number(wAttr(n, "id"))), [1, 5, 6]);
  assert.equal(visibleText(notes.find(n => Number(wAttr(n, "id")) === 5)), "untouched");
  assert.equal(result.report.resultingPositiveFootnotes, 3);
});

test("a single occurrence that does not create multiple meaningful segments leaves the file unchanged and fails closed", async () => {
  const input = await makeDocx({
    body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
    notes: `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>@01 only</w:t></w:r></w:p></w:footnote>`,
  });

  await assert.rejects(
    () => transformSplitFootnotesByTagCore(input, { filename: "one.docx", tags: ["@01"] }),
    err => err?.code === "NO_SPLIT_TAG_MATCHES"
  );
});

test("unsafe rich structures in a footnote that needs splitting abort before output", async () => {
  for (const unsafe of [
    `<w:hyperlink><w:r><w:t>@02 link</w:t></w:r></w:hyperlink>`,
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:t>@02 field</w:t></w:r>`,
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>@02 table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
  ]) {
    const input = await makeDocx({
      body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      notes: `
        <w:footnote w:id="1">
          <w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>@01 first </w:t></w:r></w:p>
          ${unsafe}
        </w:footnote>`,
    });

    await assert.rejects(
      () => transformSplitFootnotesByTagCore(input, { filename: "unsafe.docx", tags: ["@01", "@02"] }),
      err => err?.code === "UNSUPPORTED_FOOTNOTE_CONTENT"
    );
  }
});

test("missing referenced footnote aborts before mutation", async () => {
  const input = await makeDocx({
    body: `<w:p><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`,
    notes: `<w:footnote w:id="1"><w:p><w:r><w:t>@01 a @02 b</w:t></w:r></w:p></w:footnote>`,
  });

  await assert.rejects(
    () => transformSplitFootnotesByTagCore(input, { filename: "missing.docx", tags: ["@01", "@02"] }),
    err => err?.code === "MISSING_FOOTNOTES" && err.missingIds?.includes("2")
  );
});

test("serves tag splitting through the shared DOCX Worker route", async () => {
  assert.equal(isDocxSplitFootnotesByTagPath("/api/word-split-footnotes-by-tag"), true);

  const input = await makeDocx({
    body: `<w:p><w:r><w:t>X</w:t><w:footnoteReference w:id="1"/><w:t>Y</w:t></w:r></w:p>`,
    notes: `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>@01 one @02 two</w:t></w:r></w:p></w:footnote>`,
  });

  const request = new Request("https://app.ravtext.com/api/word-split-footnotes-by-tag", {
    method: "POST",
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "x-file-name": encodeURIComponent("route.docx"),
      "x-footnote-split-tags": encodeURIComponent(JSON.stringify(["@01", "@02"])),
    },
    body: input,
  });

  const response = await handleDocxApi(request, {}, {});
  assert.equal(response.status, 200);
  assert.equal(
    decodeURIComponent(response.headers.get("x-docx-filename") || ""),
    "route_מפוצל_לפי_תג.docx"
  );

  const report = JSON.parse(decodeURIComponent(response.headers.get("x-docx-report") || "%7B%7D"));
  assert.equal(report.footnotesSplit, 1);
  assert.equal(report.newFootnotesCreated, 1);

  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const footXml = await zip.file("word/footnotes.xml").async("string");
  const footDoc = parser.parseFromString(footXml, "application/xml");
  assert.equal(positiveFootnotes(footDoc).length, 2);
});

test("wires exactly one tag-split button into the Review toolbar", () => {
  const dom = new JSDOM("<!doctype html><body><div class=\"review-toolbar\"></div></body>");
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousAlert = globalThis.alert;

  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.alert = () => {};

  try {
    wireSplitFootnotesByTagTool();
    wireSplitFootnotesByTagTool();
    const buttons = dom.window.document.querySelectorAll("#split-footnotes-by-tag-btn");
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, "✂ פצל הערות לפי תג");
    assert.equal(buttons[0].closest(".review-toolbar") !== null, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousAlert === undefined) delete globalThis.alert;
    else globalThis.alert = previousAlert;
    dom.window.close();
  }
});
