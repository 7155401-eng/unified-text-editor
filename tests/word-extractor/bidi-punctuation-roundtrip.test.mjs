import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { docx_extract_simple, ensureDOMParser } from "../../src/word_extractor/word_extractor_engine.js";

const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
await ensureDOMParser();

async function makeDocx(mainText, footnoteText=""){
  const zip=new JSZip();
  const body=`<w:p><w:r><w:t xml:space="preserve">${mainText}</w:t></w:r>${footnoteText?'<w:r><w:footnoteReference w:id="1"/></w:r>':''}</w:p>`;
  zip.file("word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  if(footnoteText){
    zip.file("word/footnotes.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="${W}">
        <w:footnote w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
        <w:footnote w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
        <w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve">${footnoteText}</w:t></w:r></w:p></w:footnote>
      </w:footnotes>`);
  }
  return zip.generateAsync({type:"arraybuffer"});
}

const cases=[
  "אבג '(דהו זח טי כל מנ) סוף",
  "אבג ’(דהו זח טי כל מנ) סוף",
  "אבג ׳(דהו זח טי כל מנ) סוף",
  "אבג \u200e'(דהו זח טי כל מנ) סוף",
  "אבג '\u200e(דהו זח טי כל מנ) סוף",
  "אבג \u200f'(דהו זח טי כל מנ) סוף",
  "אבג '\u200f(דהו זח טי כל מנ) סוף",
  "אבג \u061c'(דהו זח טי כל מנ) סוף",
  "אבג '\u061c(דהו זח טי כל מנ) סוף",
  "אבג \u2060'(דהו זח טי כל מנ) סוף",
  "אבג '\u2060(דהו זח טי כל מנ) סוף",
];

for(const source of cases){
  test(`DOCX simple extractor preserves bracket/apostrophe code points: ${JSON.stringify(source)}`,async()=>{
    const buf=await makeDocx(source);
    const out=await docx_extract_simple(buf,[]);
    assert.equal(out.main,source);
    assert.deepEqual([...out.main].map(ch=>ch.codePointAt(0)),[...source].map(ch=>ch.codePointAt(0)));
  });
}

test("nested stream-marker neutralization adds apostrophes without mutating adjacent parentheses",async()=>{
  const main="גוף ";
  const note="@01 טקסט '@01(סוף)";
  const buf=await makeDocx(main,note);
  const out=await docx_extract_simple(buf,[{source:"footnote",marker:"01",symbol:"@01"}]);
  assert.equal(out.main,main.trim()+"@01");
  assert.equal(out.streams.length,1);
  const stream=out.streams[0][1];
  assert(stream.includes("'@'0'1'("),`nested marker was not neutralized next to the original opening parenthesis: ${stream}`);
  assert(stream.endsWith("(סוף)"),`parentheses changed during marker neutralization: ${stream}`);
  assert.equal(out.neutralizedStreamMarks,1);
});
