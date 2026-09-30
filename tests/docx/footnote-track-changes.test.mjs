import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { JSDOM } from "jsdom";
import {
  transformFootnoteTrackedChangesCore,
  footnoteRevisionOutputName,
} from "../../cloudflare/docx_footnote_track_changes.js";
import {
  handleDocxApi,
  isDocxFootnoteTrackChangesPath,
} from "../../cloudflare/docx_worker_entry.js";
import { wireFootnoteTrackChangesTool } from "../../src/docx_tools/footnote_track_changes.js";

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
  const documentXml = docXml(body);
  zip.file("[Content_Types].xml", contentTypesXml());
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"></Relationships>`);
  zip.file("word/document.xml", documentXml);
  zip.file("word/footnotes.xml", footnotesXml(notes));
  zip.file("word/_rels/document.xml.rels", documentRelsXml());
  return {
    arrayBuffer: await zip.generateAsync({ type: "arraybuffer" }),
    documentXml,
  };
}

function byLocalName(doc, name) {
  const all = doc.getElementsByTagNameNS?.(W, name);
  if (all?.length) return Array.from(all);
  return Array.from(doc.getElementsByTagName(`w:${name}`) || []);
}

function positiveFootnote(doc, id = 1) {
  return byLocalName(doc, "footnote").find(n =>
    Number(n.getAttributeNS?.(W, "id") || n.getAttribute("w:id") || n.getAttribute("id")) === id
  );
}

function visibleText(node) {
  return byLocalName(node, "t").map(n => n.textContent || "").join("");
}

async function unpack(result) {
  const zip = await JSZip.loadAsync(result.bytes);
  const documentXml = await zip.file("word/document.xml").async("string");
  const footXml = await zip.file("word/footnotes.xml").async("string");
  return {
    zip,
    documentXml,
    footDoc: parser.parseFromString(footXml, "application/xml"),
  };
}

const BODY_WITH_REVISIONS = `
  <w:p>
    <w:r><w:t>גוף-לפני </w:t></w:r>
    <w:ins w:id="91" w:author="Body"><w:r><w:t>תוספת-בגוף</w:t></w:r></w:ins>
    <w:del w:id="92" w:author="Body"><w:r><w:delText>מחיקה-בגוף</w:delText></w:r></w:del>
    <w:r><w:footnoteReference w:id="1"/></w:r>
  </w:p>`;

test("accept resolves only footnote revisions and leaves document.xml byte-identical", async () => {
  const source = await makeDocx({
    body: BODY_WITH_REVISIONS,
    notes: `
      <w:footnote w:id="1">
        <w:p>
          <w:r><w:footnoteRef/></w:r>
          <w:r><w:t>A</w:t></w:r>
          <w:del w:id="1" w:author="N"><w:r><w:delText>OLD</w:delText></w:r></w:del>
          <w:ins w:id="2" w:author="N"><w:r><w:t>NEW</w:t></w:r></w:ins>
          <w:r><w:t>B</w:t></w:r>
        </w:p>
      </w:footnote>`,
  });

  const result = await transformFootnoteTrackedChangesCore(source.arrayBuffer, {
    filename: "tracked.docx",
    action: "accept",
  });

  assert.equal(result.filename, "tracked_שינויי_הערות_התקבלו.docx");
  assert.equal(result.report.insertionsAccepted, 1);
  assert.equal(result.report.deletionsAccepted, 1);
  assert.equal(result.report.bodyRevisionNodesUntouched, 2);

  const out = await unpack(result);
  assert.equal(out.documentXml, source.documentXml, "main document XML was modified");
  const note = positiveFootnote(out.footDoc);
  assert.equal(visibleText(note), "ANEWB");
  assert.equal(byLocalName(note, "ins").length, 0);
  assert.equal(byLocalName(note, "del").length, 0);
  assert.equal(byLocalName(note, "delText").length, 0);
});

test("reject restores deleted footnote text and discards inserted text only in footnotes", async () => {
  const source = await makeDocx({
    body: BODY_WITH_REVISIONS,
    notes: `
      <w:footnote w:id="1">
        <w:p>
          <w:r><w:footnoteRef/></w:r>
          <w:r><w:t>A</w:t></w:r>
          <w:del w:id="1"><w:r><w:delText xml:space="preserve"> OLD </w:delText></w:r></w:del>
          <w:ins w:id="2"><w:r><w:t>NEW</w:t></w:r></w:ins>
          <w:r><w:t>B</w:t></w:r>
        </w:p>
      </w:footnote>`,
  });

  const result = await transformFootnoteTrackedChangesCore(source.arrayBuffer, {
    filename: "tracked.docx",
    action: "reject",
  });

  assert.equal(result.filename, "tracked_שינויי_הערות_נדחו.docx");
  assert.equal(result.report.insertionsRejected, 1);
  assert.equal(result.report.deletionsRejected, 1);

  const out = await unpack(result);
  assert.equal(out.documentXml, source.documentXml);
  const note = positiveFootnote(out.footDoc);
  assert.equal(visibleText(note), "A OLD B");
  assert.equal(byLocalName(note, "ins").length, 0);
  assert.equal(byLocalName(note, "del").length, 0);
  assert.equal(byLocalName(note, "delText").length, 0);
  const restored = byLocalName(note, "t").find(n => (n.textContent || "").includes("OLD"));
  assert.equal(restored?.getAttribute("xml:space"), "preserve");
});

test("accept/reject resolves moveFrom + moveTo and removes move range markers", async () => {
  const notes = `
    <w:footnote w:id="1">
      <w:p>
        <w:r><w:footnoteRef/></w:r>
        <w:r><w:t>A</w:t></w:r>
        <w:moveFromRangeStart w:id="4"/>
        <w:moveFrom w:id="4"><w:r><w:t>OLD</w:t></w:r></w:moveFrom>
        <w:moveFromRangeEnd w:id="4"/>
        <w:moveToRangeStart w:id="5"/>
        <w:moveTo w:id="5"><w:r><w:t>NEW</w:t></w:r></w:moveTo>
        <w:moveToRangeEnd w:id="5"/>
        <w:r><w:t>B</w:t></w:r>
      </w:p>
    </w:footnote>`;

  for (const [action, expected] of [["accept", "ANEWB"], ["reject", "AOLDB"]]) {
    const source = await makeDocx({
      body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      notes,
    });
    const result = await transformFootnoteTrackedChangesCore(source.arrayBuffer, {
      filename: "move.docx",
      action,
    });
    const out = await unpack(result);
    const note = positiveFootnote(out.footDoc);
    assert.equal(visibleText(note), expected, action);
    for (const name of ["moveFrom", "moveTo", "moveFromRangeStart", "moveFromRangeEnd", "moveToRangeStart", "moveToRangeEnd"]) {
      assert.equal(byLocalName(note, name).length, 0, `${action}: ${name} survived`);
    }
    assert.equal(result.report.moveRangeMarkersRemoved, 4);
  }
});

test("property changes keep current formatting on accept and restore previous snapshot on reject", async () => {
  const notes = `
    <w:footnote w:id="1">
      <w:p>
        <w:r><w:footnoteRef/></w:r>
        <w:r>
          <w:rPr>
            <w:b/>
            <w:rPrChange w:id="7" w:author="N">
              <w:rPr><w:i/></w:rPr>
            </w:rPrChange>
          </w:rPr>
          <w:t>X</w:t>
        </w:r>
      </w:p>
    </w:footnote>`;

  const acceptSource = await makeDocx({
    body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
    notes,
  });
  const accepted = await transformFootnoteTrackedChangesCore(acceptSource.arrayBuffer, {
    action: "accept",
  });
  const acceptNote = positiveFootnote((await unpack(accepted)).footDoc);
  assert.equal(byLocalName(acceptNote, "rPrChange").length, 0);
  assert.equal(byLocalName(acceptNote, "b").length, 1);
  assert.equal(byLocalName(acceptNote, "i").length, 0);
  assert.equal(accepted.report.propertyChangesAccepted, 1);

  const rejectSource = await makeDocx({
    body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
    notes,
  });
  const rejected = await transformFootnoteTrackedChangesCore(rejectSource.arrayBuffer, {
    action: "reject",
  });
  const rejectNote = positiveFootnote((await unpack(rejected)).footDoc);
  assert.equal(byLocalName(rejectNote, "rPrChange").length, 0);
  assert.equal(byLocalName(rejectNote, "b").length, 0);
  assert.equal(byLocalName(rejectNote, "i").length, 1);
  assert.equal(rejected.report.propertyChangesRejected, 1);
});

test("paragraph-mark or structural table revisions fail closed", async () => {
  const unsafeNotes = [
    `
      <w:footnote w:id="1">
        <w:p>
          <w:pPr><w:rPr><w:del w:id="3"/></w:rPr></w:pPr>
          <w:r><w:footnoteRef/></w:r><w:r><w:t>text</w:t></w:r>
        </w:p>
      </w:footnote>`,
    `
      <w:footnote w:id="1">
        <w:tbl>
          <w:tr>
            <w:tc>
              <w:tcPr><w:cellIns w:id="3"/></w:tcPr>
              <w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>text</w:t></w:r></w:p>
            </w:tc>
          </w:tr>
        </w:tbl>
      </w:footnote>`,
  ];

  for (const notes of unsafeNotes) {
    const source = await makeDocx({
      body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      notes,
    });
    await assert.rejects(
      () => transformFootnoteTrackedChangesCore(source.arrayBuffer, { action: "accept" }),
      err => err?.code === "UNSUPPORTED_FOOTNOTE_REVISIONS"
    );
  }
});

test("no footnote revisions produces no output instead of silently rewriting the DOCX", async () => {
  const source = await makeDocx({
    body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
    notes: `
      <w:footnote w:id="1">
        <w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>plain</w:t></w:r></w:p>
      </w:footnote>`,
  });

  await assert.rejects(
    () => transformFootnoteTrackedChangesCore(source.arrayBuffer, { action: "accept" }),
    err => err?.code === "NO_FOOTNOTE_REVISIONS"
  );
});

test("shared Worker route accepts footnote changes and reports untouched body revisions", async () => {
  assert.equal(isDocxFootnoteTrackChangesPath("/api/word-footnote-track-changes"), true);

  const source = await makeDocx({
    body: BODY_WITH_REVISIONS,
    notes: `
      <w:footnote w:id="1">
        <w:p>
          <w:r><w:footnoteRef/></w:r>
          <w:del w:id="1"><w:r><w:delText>OLD</w:delText></w:r></w:del>
          <w:ins w:id="2"><w:r><w:t>NEW</w:t></w:r></w:ins>
        </w:p>
      </w:footnote>`,
  });

  const request = new Request("https://app.ravtext.com/api/word-footnote-track-changes", {
    method: "POST",
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "x-file-name": encodeURIComponent("route.docx"),
      "x-footnote-track-action": "accept",
    },
    body: source.arrayBuffer,
  });

  const response = await handleDocxApi(request, {}, {});
  assert.equal(response.status, 200);
  assert.equal(
    decodeURIComponent(response.headers.get("x-docx-filename") || ""),
    "route_שינויי_הערות_התקבלו.docx"
  );
  const report = JSON.parse(decodeURIComponent(response.headers.get("x-docx-report") || "%7B%7D"));
  assert.equal(report.bodyRevisionNodesUntouched, 2);
  assert.equal(report.insertionsAccepted, 1);
  assert.equal(report.deletionsAccepted, 1);

  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const documentXml = await zip.file("word/document.xml").async("string");
  assert.equal(documentXml, source.documentXml);
});

test("wires exactly one accept and one reject button into Review", () => {
  const dom = new JSDOM("<!doctype html><body><div class=\"review-toolbar\"></div></body>");
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;

  globalThis.document = dom.window.document;
  globalThis.window = dom.window;

  try {
    wireFootnoteTrackChangesTool();
    wireFootnoteTrackChangesTool();
    assert.equal(dom.window.document.querySelectorAll("#footnote-changes-accept-btn").length, 1);
    assert.equal(dom.window.document.querySelectorAll("#footnote-changes-reject-btn").length, 1);
    assert.equal(dom.window.document.querySelector("#footnote-changes-accept-btn").textContent, "✓ קבל שינויי הערות");
    assert.equal(dom.window.document.querySelector("#footnote-changes-reject-btn").textContent, "✗ דחה שינויי הערות");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    dom.window.close();
  }
});

test("output naming is deterministic", () => {
  assert.equal(
    footnoteRevisionOutputName("a.docx", "accept"),
    "a_שינויי_הערות_התקבלו.docx"
  );
  assert.equal(
    footnoteRevisionOutputName("a.docx", "reject"),
    "a_שינויי_הערות_נדחו.docx"
  );
});
