import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { JSDOM } from "jsdom";
import { transformFootnotesToCurlyCore } from "../../cloudflare/docx_footnotes_to_curly.js";
import {
  handleDocxApi,
  isDocxFootnotesToCurlyPath,
} from "../../cloudflare/docx_worker_entry.js";
import { wireFootnotesToCurlyTool } from "../../src/docx_tools/footnotes_to_curly.js";

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

async function unpackResult(result) {
  const zip = await JSZip.loadAsync(result.bytes);
  const xml = await zip.file("word/document.xml").async("string");
  return { zip, xml, doc: parser.parseFromString(xml, "application/xml") };
}

test("converts a mixed main run and preserves rich footnote formatting", async () => {
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
          <w:r><w:footnoteRef/></w:r>
          <w:r>
            <w:rPr><w:b/><w:i/><w:color w:val="AA0000"/></w:rPr>
            <w:t>הערה</w:t>
          </w:r>
        </w:p>
      </w:footnote>`,
  });

  const result = await transformFootnotesToCurlyCore(input, { filename: "source.docx" });
  assert.equal(result.filename, "source_מסולסלות.docx");
  assert.equal(result.report.referencesConverted, 1);
  assert.equal(result.report.uniqueFootnotesConverted, 1);

  const { zip, doc } = await unpackResult(result);
  assert.equal(zip.file("word/footnotes.xml"), null, "footnotes part survived");
  assert.equal(zip.file("word/_rels/footnotes.xml.rels"), null);

  const text = byLocalName(doc, "t").map(n => n.textContent || "").join("");
  assert.equal(text, "לפני{הערה}אחרי");
  assert.equal(byLocalName(doc, "footnoteReference").length, 0);

  const noteText = byLocalName(doc, "t").find(n => n.textContent === "הערה");
  assert(noteText, "converted note text missing");
  const noteRun = noteText.parentNode;
  assert.equal(byLocalName(noteRun, "b").length, 1, "bold mark was lost");
  assert.equal(byLocalName(noteRun, "i").length, 1, "italic mark was lost");

  const relXml = await zip.file("word/_rels/document.xml.rels").async("string");
  assert(!/relationships\/footnotes|Target="footnotes\.xml"/i.test(relXml), "footnotes relationship survived");

  const ctXml = await zip.file("[Content_Types].xml").async("string");
  assert(!/PartName="\/word\/footnotes\.xml"/i.test(ctXml), "footnotes content type survived");
});

test("multi-paragraph footnote becomes one curly block with explicit line break", async () => {
  const input = await makeDocx({
    body: `<w:p><w:r><w:t>A</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>B</w:t></w:r></w:p>`,
    notes: `
      <w:footnote w:id="1">
        <w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>ראשון</w:t></w:r></w:p>
        <w:p><w:r><w:t>שני</w:t></w:r></w:p>
      </w:footnote>`,
  });

  const result = await transformFootnotesToCurlyCore(input, { filename: "multi.docx" });
  const { doc } = await unpackResult(result);
  assert.equal(byLocalName(doc, "t").map(n => n.textContent || "").join(""), "A{ראשוןשני}B");
  assert.equal(byLocalName(doc, "br").length, 1, "paragraph boundary was not preserved as a line break");
});

test("converts repeated references deterministically without losing body order", async () => {
  const input = await makeDocx({
    body: `
      <w:p><w:r><w:t>א</w:t><w:footnoteReference w:id="1"/><w:t>ב</w:t></w:r></w:p>
      <w:p><w:r><w:t>ג</w:t><w:footnoteReference w:id="2"/><w:t>ד</w:t></w:r></w:p>`,
    notes: `
      <w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>אחת</w:t></w:r></w:p></w:footnote>
      <w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>שתים</w:t></w:r></w:p></w:footnote>`,
  });

  const result = await transformFootnotesToCurlyCore(input, { filename: "two.docx" });
  const { doc } = await unpackResult(result);
  assert.equal(byLocalName(doc, "t").map(n => n.textContent || "").join(""), "א{אחת}בג{שתים}ד");
  assert.equal(result.report.referencesConverted, 2);
  assert.equal(result.report.uniqueFootnotesConverted, 2);
});

test("missing referenced footnote aborts instead of deleting note infrastructure", async () => {
  const input = await makeDocx({
    body: `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="2"/></w:r></w:p>`,
    notes: `<w:footnote w:id="1"><w:p><w:r><w:t>only one</w:t></w:r></w:p></w:footnote>`,
  });

  await assert.rejects(
    () => transformFootnotesToCurlyCore(input, { filename: "missing.docx" }),
    err => err?.code === "MISSING_FOOTNOTES" && err.missingIds?.includes("2")
  );
});

test("unreferenced positive footnote aborts instead of being silently deleted", async () => {
  const input = await makeDocx({
    body: `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`,
    notes: `
      <w:footnote w:id="1"><w:p><w:r><w:t>used</w:t></w:r></w:p></w:footnote>
      <w:footnote w:id="2"><w:p><w:r><w:t>orphan</w:t></w:r></w:p></w:footnote>`,
  });

  await assert.rejects(
    () => transformFootnotesToCurlyCore(input, { filename: "orphan.docx" }),
    err => err?.code === "UNREFERENCED_FOOTNOTES" && err.orphanIds?.includes("2")
  );
});

test("image/table/object/hyperlink content aborts before any output is produced", async () => {
  for (const unsafe of ["drawing", "tbl", "object", "hyperlink", "fldChar", "sym"]) {
    const unsafeXml = unsafe === "tbl"
      ? `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
      : unsafe === "hyperlink"
        ? `<w:hyperlink><w:r><w:t>link text</w:t></w:r></w:hyperlink>`
        : `<w:r><w:${unsafe}/></w:r>`;

    const input = await makeDocx({
      body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      notes: `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r></w:p>${unsafeXml}</w:footnote>`,
    });

    await assert.rejects(
      () => transformFootnotesToCurlyCore(input, { filename: `unsafe-${unsafe}.docx` }),
      err => err?.code === "UNSUPPORTED_FOOTNOTE_CONTENT"
        && err.items?.some(item => item.kind === unsafe)
    );
  }
});




test("serves the converter through the shared DOCX Worker route", async () => {
  assert.equal(isDocxFootnotesToCurlyPath("/api/word-footnotes-to-curly"), true);

  const input = await makeDocx({
    body: `<w:p><w:r><w:t>X</w:t><w:footnoteReference w:id="1"/><w:t>Y</w:t></w:r></w:p>`,
    notes: `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>note</w:t></w:r></w:p></w:footnote>`,
  });

  const request = new Request("https://app.ravtext.com/api/word-footnotes-to-curly", {
    method: "POST",
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "x-file-name": encodeURIComponent("route.docx"),
    },
    body: input,
  });

  const response = await handleDocxApi(request, {}, {});
  assert.equal(response.status, 200);
  assert.equal(
    decodeURIComponent(response.headers.get("x-docx-filename") || ""),
    "route_מסולסלות.docx"
  );

  const report = JSON.parse(decodeURIComponent(response.headers.get("x-docx-report") || "%7B%7D"));
  assert.equal(report.referencesConverted, 1);

  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  assert.equal(zip.file("word/footnotes.xml"), null);
  const xml = await zip.file("word/document.xml").async("string");
  const doc = parser.parseFromString(xml, "application/xml");
  assert.equal(byLocalName(doc, "t").map(n => n.textContent || "").join(""), "X{note}Y");
});

test("wires exactly one converter button into the Review toolbar", () => {
  const dom = new JSDOM("<!doctype html><body><div class=\"review-toolbar\"></div></body>");
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    wireFootnotesToCurlyTool();
    wireFootnotesToCurlyTool();
    const buttons = dom.window.document.querySelectorAll("#footnotes-to-curly-btn");
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, "הערות → {מסולסלות}");
    assert.equal(buttons[0].closest(".review-toolbar") !== null, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    dom.window.close();
  }
});
