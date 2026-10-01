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

for(const source of [
  "אבג '(דהו זח טי כל מנ) סוף",
  "אבג ’(דהו זח טי כל מנ) סוף",
  "אבג ׳(דהו זח טי כל מנ) סוף",
  "אבג \u200f'(דהו זח טי כל מנ) סוף",
  "אבג '\u200f(דהו זח טי כל מנ) סוף",
]){
  test(`DOCX extractor preserves bracket/apostrophe code points: ${JSON.stringify(source)}`,async()=>{
    const out=await docx_extract_simple(await makeDocx(source),[]);
    assert.equal(out.main,source);
    assert.deepEqual([...out.main].map(ch=>ch.codePointAt(0)),[...source].map(ch=>ch.codePointAt(0)));
  });
}

test("synthetic stream marker does not keep horizontal Word gap before it",async()=>{
  const out=await docx_extract_simple(
    await makeDocx("גוף   ","@01 טקסט '@01(סוף)"),
    [{source:"footnote",marker:"01",symbol:"@01"}]
  );
  assert.equal(out.main,"גוף@01");
  assert.equal(out.streams.length,1);
  const stream=out.streams[0][1];
  assert(stream.includes("'@'0'1'("),stream);
  assert(stream.endsWith("(סוף)"),stream);
});

test("synthetic stream marker preserves a real hard line break before it",async()=>{
  const out=await docx_extract_simple(
    await makeDocx("גוף\n   ","@01 טקסט"),
    [{source:"footnote",marker:"01",symbol:"@01"}]
  );
  assert.equal(out.main,"גוף\n@01");
});
